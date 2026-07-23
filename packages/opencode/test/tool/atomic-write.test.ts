import { beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import * as fs from "node:fs/promises"
import { Effect, Exit } from "effect"
import { AtomicWrite } from "../../src/tool/atomic-write"
import { RuntimeLease } from "../../src/runtime/lease"
import { RuntimeLeaseTable } from "../../src/runtime/lease.sql"
import { Database } from "../../src/storage"
import { tmpdir } from "../fixture/fixture"

beforeEach(() => {
  Database.use((db) => db.delete(RuntimeLeaseTable).run())
})

describe("AtomicWrite", () => {
  test("atomically replaces a file and removes the temporary file", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "checkpoint.md")
    await Bun.write(target, "old")
    const handle = await Effect.runPromise(
      RuntimeLease.acquire({ resourceType: "checkpoint", resourceID: "atomic-write" }),
    )
    await Effect.runPromise(
      AtomicWrite.atomic(target, "new").pipe(Effect.provideService(RuntimeLease.Current, [handle!])),
    )
    expect(await Bun.file(target).text()).toBe("new")
    expect((await fs.readdir(tmp.path)).filter((name) => name.endsWith(".tmp"))).toHaveLength(0)
    await Effect.runPromise(RuntimeLease.release(handle!))
  })

  test("a stale fence cannot replace the current file", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "MEMORY.md")
    await Bun.write(target, "current")
    const key = { resourceType: "checkpoint" as const, resourceID: "atomic-stale" }
    const stale = await Effect.runPromise(RuntimeLease.acquire(key))
    Database.use((db) => db.update(RuntimeLeaseTable).set({ expires_at: Date.now() - 1 }).run())
    const current = await Effect.runPromise(RuntimeLease.acquire(key))
    const exit = await Effect.runPromiseExit(
      AtomicWrite.atomic(target, "stale").pipe(Effect.provideService(RuntimeLease.Current, [stale!])),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(await Bun.file(target).text()).toBe("current")
    expect((await fs.readdir(tmp.path)).filter((name) => name.endsWith(".tmp"))).toHaveLength(0)
    await Effect.runPromise(RuntimeLease.release(current!))
  })
})
