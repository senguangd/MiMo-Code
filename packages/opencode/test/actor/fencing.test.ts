import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ActorRegistry } from "../../src/actor/registry"
import { ActorRegistryTable } from "../../src/actor/actor.sql"
import { RuntimeLease } from "../../src/runtime/lease"
import { RuntimeLeaseTable } from "../../src/runtime/lease.sql"
import { Database, and, eq } from "../../src/storage"
import { tmpdir } from "../fixture/fixture"

beforeEach(() => {
  Database.use((db) => db.delete(RuntimeLeaseTable).run())
})

afterEach(async () => {
  await Instance.disposeAll()
})

describe("actor fencing", () => {
  test("an old lease cannot reclaim or terminate an actor after takeover", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create()))
        const actorID = "general-fenced"
        await AppRuntime.runPromise(
          ActorRegistry.Service.use((svc) =>
            svc.register({
              sessionID: session.id, actorID, mode: "subagent", agent: "general",
              description: "fenced actor", contextMode: "none", background: true, lifecycle: "ephemeral",
            }),
          ),
        )
        const key = { resourceType: "session-run" as const, resourceID: session.id, subresourceID: actorID }
        const first = await AppRuntime.runPromise(RuntimeLease.acquire(key))
        await AppRuntime.runPromise(
          ActorRegistry.Service.use((svc) => svc.updateStatus(session.id, actorID, { status: "running" })).pipe(
            Effect.provideService(RuntimeLease.Current, [first!]),
          ),
        )
        Database.use((db) =>
          db
            .update(RuntimeLeaseTable)
            .set({ expires_at: Date.now() - 1 })
            .where(eq(RuntimeLeaseTable.resource_id, session.id))
            .run(),
        )
        const second = await AppRuntime.runPromise(RuntimeLease.acquire(key))
        const stale = await AppRuntime.runPromiseExit(
          ActorRegistry.Service.use((svc) => svc.updateStatus(session.id, actorID, { status: "idle", lastOutcome: "cancelled" })).pipe(
            Effect.provideService(RuntimeLease.Current, [first!]),
          ),
        )
        expect(Exit.isFailure(stale)).toBe(true)
        const row = Database.use((db) =>
          db
            .select()
            .from(ActorRegistryTable)
            .where(and(eq(ActorRegistryTable.session_id, session.id), eq(ActorRegistryTable.actor_id, actorID)))
            .get(),
        )
        expect(row?.status).toBe("running")
        expect(row?.lease_fence).toBe(second!.fencingToken)
        await AppRuntime.runPromise(RuntimeLease.release(second!))
      },
    })
  })
})
