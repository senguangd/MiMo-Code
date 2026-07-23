import { beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { Database } from "../../src/storage"
import { RuntimeLeaseTable } from "../../src/runtime/lease.sql"
import { RuntimeLease } from "../../src/runtime/lease"

beforeEach(() => {
  Database.use((db) => db.delete(RuntimeLeaseTable).run())
})

describe("RuntimeLease", () => {
  test("serializes ownership and preserves a monotonically increasing fence", async () => {
    const key = { resourceType: "checkpoint" as const, resourceID: "lease-test" }
    const first = await Effect.runPromise(RuntimeLease.acquire(key))
    expect(first).toBeDefined()
    expect(await Effect.runPromise(RuntimeLease.acquire(key))).toBeUndefined()

    await Effect.runPromise(RuntimeLease.release(first!))
    const second = await Effect.runPromise(RuntimeLease.acquire(key))
    expect(second).toBeDefined()
    expect(second!.fencingToken).toBe(first!.fencingToken + 1)
    expect(second!.leaseID).not.toBe(first!.leaseID)

    const stale = await Effect.runPromiseExit(RuntimeLease.assertHandle(first!))
    expect(Exit.isFailure(stale)).toBe(true)
    await Effect.runPromise(RuntimeLease.assertHandle(second!))

    // A delayed release from the first owner must not clear the second owner.
    await Effect.runPromise(RuntimeLease.release(first!))
    expect(await Effect.runPromise(RuntimeLease.isHeld(key))).toBe(true)
    await Effect.runPromise(RuntimeLease.release(second!))
    expect(await Effect.runPromise(RuntimeLease.isHeld(key))).toBe(false)
  })

  test("records cancellation only for an active lease", async () => {
    const key = { resourceType: "checkpoint" as const, resourceID: "cancel-test" }
    expect(await Effect.runPromise(RuntimeLease.requestCancel(key))).toBe(false)
    const handle = await Effect.runPromise(RuntimeLease.acquire(key))
    expect(handle).toBeDefined()
    expect(await Effect.runPromise(RuntimeLease.requestCancel({ ...key, reason: "stop" }))).toBe(true)
    const row = Database.use((db) => db.select().from(RuntimeLeaseTable).get())
    expect(row?.cancel_requested_at).toBeNumber()
    expect(row?.cancel_reason).toBe("stop")
    await Effect.runPromise(RuntimeLease.release(handle!))
    expect(await Effect.runPromise(RuntimeLease.requestCancel(key))).toBe(false)
  })
  test("an expired lease can be fenced even while the old process is still alive", async () => {
    const key = { resourceType: "checkpoint" as const, resourceID: "expired-live-owner" }
    const first = await Effect.runPromise(RuntimeLease.acquire(key))
    expect(first).toBeDefined()
    Database.use((db) =>
      db
        .update(RuntimeLeaseTable)
        .set({ expires_at: Date.now() - 1 })
        .run(),
    )
    const second = await Effect.runPromise(RuntimeLease.acquire(key))
    expect(second).toBeDefined()
    expect(second!.fencingToken).toBe(first!.fencingToken + 1)
    expect(Exit.isFailure(await Effect.runPromiseExit(RuntimeLease.assertHandle(first!)))).toBe(true)
    await Effect.runPromise(RuntimeLease.release(second!))
  })

  test("session admin ownership excludes actor and checkpoint leases in both directions", async () => {
    const sessionID = "session-admin-conflict"
    const actor = await Effect.runPromise(
      RuntimeLease.acquire({ resourceType: "session-run", resourceID: sessionID, subresourceID: "general-1" }),
    )
    expect(actor).toBeDefined()
    expect(
      await Effect.runPromise(RuntimeLease.acquire({ resourceType: "session-admin", resourceID: sessionID })),
    ).toBeUndefined()

    await Effect.runPromise(RuntimeLease.release(actor!))
    const checkpoint = await Effect.runPromise(
      RuntimeLease.acquire({ resourceType: "checkpoint", resourceID: sessionID }),
    )
    expect(checkpoint).toBeDefined()
    expect(
      await Effect.runPromise(RuntimeLease.acquire({ resourceType: "session-admin", resourceID: sessionID })),
    ).toBeUndefined()
    await Effect.runPromise(RuntimeLease.release(checkpoint!))

    const admin = await Effect.runPromise(
      RuntimeLease.acquire({ resourceType: "session-admin", resourceID: sessionID }),
    )
    expect(admin).toBeDefined()
    expect(
      await Effect.runPromise(
        RuntimeLease.acquire({ resourceType: "session-run", resourceID: sessionID, subresourceID: "main" }),
      ),
    ).toBeUndefined()
    expect(
      await Effect.runPromise(
        RuntimeLease.acquire({ resourceType: "session-run", resourceID: sessionID, subresourceID: "explore-1" }),
      ),
    ).toBeUndefined()
    expect(
      await Effect.runPromise(RuntimeLease.acquire({ resourceType: "checkpoint", resourceID: sessionID })),
    ).toBeUndefined()

    await Effect.runPromise(RuntimeLease.release(admin!))
    const next = await Effect.runPromise(
      RuntimeLease.acquire({ resourceType: "session-run", resourceID: sessionID, subresourceID: "main" }),
    )
    expect(next).toBeDefined()
    await Effect.runPromise(RuntimeLease.release(next!))
  })
})
