import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "../util"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util"
import { NamedError } from "@mimo-ai/shared/util/error"
import z from "zod"
import path from "path"
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { Flag } from "../flag/flag"
import { InstallationChannel } from "../installation/version"
import { InstanceState } from "@/effect"
import { iife } from "@/util/iife"
import { init } from "#db"
import { randomUUID } from "node:crypto"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.MIMOCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "mimocode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `mimocode-${safe}.db`)
}

export const Path = iife(() => {
  if (Flag.MIMOCODE_DB) {
    if (Flag.MIMOCODE_DB === ":memory:" || path.isAbsolute(Flag.MIMOCODE_DB)) return Flag.MIMOCODE_DB
    return path.join(Global.Path.data, Flag.MIMOCODE_DB)
  }
  return getChannelPath()
})

export type Transaction = SQLiteTransaction<"sync", void>

type MigrationLockInfo = {
  pid: number
  startedAt: number
  nonce: string
}

const PROCESS_STARTED_AT = Date.now() - Math.floor(process.uptime() * 1000)
const MIGRATION_LOCK_TIMEOUT_MS = 120_000
const MIGRATION_LOCK_POLL_MS = 25
const MIGRATION_LOCK_INCOMPLETE_GRACE_MS = 5_000
const sleepCell = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms: number) {
  Atomics.wait(sleepCell, 0, 0, ms)
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function readMigrationLock(file: string): MigrationLockInfo | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<MigrationLockInfo>
    if (typeof value.pid !== "number" || typeof value.startedAt !== "number" || typeof value.nonce !== "string") return
    return { pid: value.pid, startedAt: value.startedAt, nonce: value.nonce }
  } catch {
    return
  }
}

function createMigrationLock(file: string, info: MigrationLockInfo) {
  let descriptor: number | undefined
  try {
    descriptor = openSync(file, "wx", 0o600)
    writeFileSync(descriptor, JSON.stringify(info), "utf8")
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    if (descriptor !== undefined) {
      try {
        unlinkSync(file)
      } catch {}
    }
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function releaseMigrationLock(file: string, info: MigrationLockInfo) {
  const current = readMigrationLock(file)
  if (!current || current.nonce !== info.nonce) return
  try {
    unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

const STARTUP_PRAGMA_RETRY_MS = 5_000
const TRANSIENT_STARTUP_CODES = new Set(["SQLITE_IOERR_TRUNCATE", "SQLITE_BUSY", "SQLITE_LOCKED"])

function sqliteErrorCode(error: unknown) {
  let current = error
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== "object") return
    const value = current as { code?: unknown; cause?: unknown }
    if (typeof value.code === "string") return value.code
    current = value.cause
  }
}

function runStartupPragma(db: ReturnType<typeof init>, statement: string) {
  const deadline = Date.now() + STARTUP_PRAGMA_RETRY_MS
  while (true) {
    try {
      db.run(statement)
      return
    } catch (error) {
      const code = sqliteErrorCode(error)
      if (!code || !TRANSIENT_STARTUP_CODES.has(code) || Date.now() >= deadline) throw error
      sleepSync(MIGRATION_LOCK_POLL_MS)
    }
  }
}

function databaseUsesWal(file: string) {
  if (file === ":memory:") return false
  let descriptor: number | undefined
  try {
    descriptor = openSync(file, "r")
    const header = Buffer.allocUnsafe(20)
    const bytesRead = readSync(descriptor, header, 0, header.length, 0)
    // SQLite database header bytes 18/19 are the write/read format versions.
    // Both are 2 when persistent WAL mode is enabled. Read only the fixed-size
    // header so startup memory remains constant as the database grows.
    return bytesRead === header.length && header[18] === 2 && header[19] === 2
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function withMigrationLock<T>(run: () => T): T {
  if (Path === ":memory:") return run()
  const file = `${Path}.migrate.lock`
  const self: MigrationLockInfo = {
    pid: process.pid,
    startedAt: PROCESS_STARTED_AT,
    nonce: randomUUID(),
  }
  const deadline = Date.now() + MIGRATION_LOCK_TIMEOUT_MS

  while (!createMigrationLock(file, self)) {
    const current = readMigrationLock(file)
    let stale = current ? !processIsAlive(current.pid) : false
    if (!current) {
      try {
        stale = Date.now() - statSync(file).mtimeMs > MIGRATION_LOCK_INCOMPLETE_GRACE_MS
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw error
      }
    }
    if (stale) {
      try {
        unlinkSync(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      continue
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for database migration lock: ${file}`)
    }
    sleepSync(MIGRATION_LOCK_POLL_MS)
  }

  try {
    return run()
  } finally {
    releaseMigrationLock(file, self)
  }
}

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const entries =
    typeof OPENCODE_MIGRATIONS !== "undefined"
      ? OPENCODE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0 && Flag.MIMOCODE_SKIP_MIGRATIONS) {
    for (const item of entries) {
      item.sql = "select 1;"
    }
  }

  // Acquire the process-wide startup lock before opening SQLite. Connections
  // opened before another process switches the database to WAL can retain stale
  // journal state on Windows and later fail with SQLITE_IOERR_TRUNCATE.
  let db!: ReturnType<typeof init>
  withMigrationLock(() => {
    db = init(Path)
    runStartupPragma(db, "PRAGMA busy_timeout = 5000")
    const enableWal = !databaseUsesWal(Path)
    if (enableWal) runStartupPragma(db, "PRAGMA journal_mode = WAL")
    runStartupPragma(db, "PRAGMA synchronous = NORMAL")
    runStartupPragma(db, "PRAGMA cache_size = -64000")
    runStartupPragma(db, "PRAGMA foreign_keys = ON")
    if (enableWal) runStartupPragma(db, "PRAGMA wal_checkpoint(PASSIVE)")

    if (entries.length === 0) return
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    migrate(db, entries)
  })

  return db
})

export function close() {
  Client().$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}
