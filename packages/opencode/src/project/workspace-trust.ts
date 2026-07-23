import path from "path"
import os from "os"
import { mkdir, open, rename, rm, writeFile } from "fs/promises"
import { z } from "zod"
import { Filesystem, Log } from "@/util"
import { Path as GlobalPath } from "@/global"
import { Flock } from "@adp-ai/shared/util/flock"

export type TrustLevel = "trusted" | "untrusted" | "dangerous"

export const WorkspaceTrustLimits = {
  fileBytes: 1024 * 1024,
  pathBytes: 32 * 1024,
  entries: 4096,
} as const

const log = Log.create({ service: "workspace-trust" })

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
const Store = z
  .object({
    version: z.literal(1),
    trustedPaths: z
      .array(
        z
          .string()
          .refine((value) => Buffer.byteLength(value) <= WorkspaceTrustLimits.pathBytes, "trusted path is too long")
          .refine((value) => path.isAbsolute(value), "trusted paths must be absolute"),
      )
      .max(WorkspaceTrustLimits.entries),
  })
  .strict()

function canonical(directory: string) {
  return Filesystem.resolve(directory)
}

function normalizeStored(directory: string) {
  return path.normalize(path.resolve(directory))
}

async function readBounded(filePath: string) {
  const file = await open(filePath, "r")
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error("workspace trust store is not a regular file")
    if (info.size > WorkspaceTrustLimits.fileBytes) throw new Error("workspace trust store exceeds its byte limit")

    const buffer = Buffer.allocUnsafe(WorkspaceTrustLimits.fileBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > WorkspaceTrustLimits.fileBytes) throw new Error("workspace trust store exceeds its byte limit")
    return buffer.toString("utf8", 0, offset)
  } finally {
    await file.close()
  }
}

export function createWorkspaceTrustStore(storeFile: string) {
  const lock = `workspace-trust:${storeFile}`
  const lockDir = path.join(path.dirname(storeFile), ".locks")

  async function readStore(): Promise<string[]> {
    try {
      const parsed = Store.safeParse(JSON.parse(await readBounded(storeFile)))
      if (!parsed.success) {
        log.warn("ignoring invalid workspace trust store", { path: storeFile, error: parsed.error })
        return []
      }
      return [...new Set(parsed.data.trustedPaths.map(normalizeStored))]
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        log.warn("ignoring unreadable workspace trust store", { path: storeFile, error })
      }
      return []
    }
  }

  async function writeStore(trustedPaths: string[]) {
    const normalized = [...new Set(trustedPaths.map(normalizeStored))].sort()
    if (normalized.length > WorkspaceTrustLimits.entries) {
      throw new Error(`workspace trust store exceeds the ${WorkspaceTrustLimits.entries}-entry limit`)
    }
    const payload = Store.safeParse({ version: 1, trustedPaths: normalized })
    if (!payload.success) throw new Error(`invalid workspace trust store: ${payload.error.message}`)
    const content = JSON.stringify(payload.data, null, 2)
    if (Buffer.byteLength(content) > WorkspaceTrustLimits.fileBytes) {
      throw new Error(`workspace trust store exceeds the ${WorkspaceTrustLimits.fileBytes}-byte limit`)
    }

    await mkdir(path.dirname(storeFile), { recursive: true, mode: 0o700 })
    const temp = `${storeFile}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 })
      await rename(temp, storeFile)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  async function checkTrust(directory: string): Promise<TrustLevel> {
    const normalized = canonical(directory)
    const homeCandidates = [
      process.env.HOME,
      process.env.USERPROFILE,
      process.env.HOMEDRIVE && process.env.HOMEPATH
        ? path.join(process.env.HOMEDRIVE, process.env.HOMEPATH)
        : undefined,
      os.homedir(),
    ]
      .filter((value): value is string => Boolean(value))
      .map(canonical)

    if (homeCandidates.includes(normalized) || path.parse(normalized).root === normalized) return "dangerous"
    return (await readStore()).some((trusted) => Filesystem.contains(trusted, normalized)) ? "trusted" : "untrusted"
  }

  async function markTrusted(directory: string) {
    const normalized = canonical(directory)
    await Flock.withLock(
      lock,
      async () => {
        const trustedPaths = await readStore()
        if (trustedPaths.includes(normalized)) return
        await writeStore([...trustedPaths, normalized])
      },
      { dir: lockDir },
    )
  }

  async function listTrusted() {
    return readStore()
  }

  async function revokeTrust(directory: string) {
    const normalized = canonical(directory)
    await Flock.withLock(
      lock,
      async () => writeStore((await readStore()).filter((trusted) => trusted !== normalized)),
      { dir: lockDir },
    )
  }

  return { checkTrust, markTrusted, listTrusted, revokeTrust }
}

const store = createWorkspaceTrustStore(path.join(GlobalPath.data, "trusted-workspaces.json"))

export const checkTrust = store.checkTrust
export const markTrusted = store.markTrusted
export const listTrusted = store.listTrusted
export const revokeTrust = store.revokeTrust
