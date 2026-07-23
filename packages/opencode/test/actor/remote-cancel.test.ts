import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRunState } from "../../src/session/run-state"
import { ActorRegistry } from "../../src/actor/registry"
import { RuntimeLease } from "../../src/runtime/lease"
import { RuntimeLeaseTable } from "../../src/runtime/lease.sql"
import { Database, and, eq } from "../../src/storage"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("remote actor cancellation", () => {
  test("requests cancellation without publishing a false idle terminal state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create()))
        const actorID = "general-remote"
        await AppRuntime.runPromise(
          ActorRegistry.Service.use((svc) =>
            svc.register({
              sessionID: session.id,
              actorID,
              mode: "subagent",
              agent: "general",
              description: "remote actor",
              contextMode: "none",
              background: true,
              lifecycle: "ephemeral",
            }),
          ),
        )
        const handle = await AppRuntime.runPromise(
          RuntimeLease.acquire({ resourceType: "session-run", resourceID: session.id, subresourceID: actorID }),
        )
        expect(handle).toBeDefined()
        const result = await AppRuntime.runPromise(
          SessionRunState.Service.use((svc) => svc.cancelActor(session.id, actorID)),
        )
        expect(result).toBe("remote")
        const actor = await AppRuntime.runPromise(ActorRegistry.Service.use((svc) => svc.get(session.id, actorID)))
        expect(actor?.status).toBe("running")
        expect(actor?.lastOutcome).toBeUndefined()
        const lease = Database.use((db) =>
          db
            .select()
            .from(RuntimeLeaseTable)
            .where(
              and(
                eq(RuntimeLeaseTable.resource_type, "session-run"),
                eq(RuntimeLeaseTable.resource_id, session.id),
                eq(RuntimeLeaseTable.subresource_id, actorID),
              ),
            )
            .get(),
        )
        expect(lease?.cancel_requested_at).toBeNumber()
        await AppRuntime.runPromise(RuntimeLease.release(handle!))
      },
    })
  })
})
