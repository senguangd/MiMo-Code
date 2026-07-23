import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { RuntimeLeaseTable } from "../../src/runtime/lease.sql"
import { Database } from "../../src/storage"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("SessionStatus lease projection", () => {
  test("shows a remote active owner instead of idle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create()))
        const now = Date.now()
        Database.use((db) =>
          db.insert(RuntimeLeaseTable).values({
            resource_type: "session-run",
            resource_id: session.id,
            subresource_id: "main",
            owner_instance_id: "remote-instance",
            owner_pid: 999999,
            lease_id: "remote-lease",
            fencing_token: 7,
            heartbeat_at: now,
            expires_at: now + 30_000,
            cancel_requested_at: null,
            cancel_reason: null,
            time_created: now,
            time_updated: now,
          }).run(),
        )
        expect(await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(session.id)))).toEqual({
          type: "busy",
          message: "Running in another client.",
        })
        const listed = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.list()))
        expect(listed.get(session.id)).toEqual({ type: "busy", message: "Running in another client." })
        Database.use((db) => db.delete(RuntimeLeaseTable).run())
      },
    })
  })
})
