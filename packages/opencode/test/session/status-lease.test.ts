import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect } from "effect"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { SessionRunState } from "../../src/session/run-state"
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
          db
            .insert(RuntimeLeaseTable)
            .values({
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
            })
            .run(),
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
  test("remote cancellation does not publish idle before the owner releases its lease", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const status = yield* SessionStatus.Service
            const state = yield* SessionRunState.Service
            const bus = yield* Bus.Service
            const session = yield* sessions.create()
            const now = Date.now()
            Database.use((db) =>
              db
                .insert(RuntimeLeaseTable)
                .values({
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
                })
                .run(),
            )

            const observed: string[] = []
            let releaseFlush!: () => void
            const flushed = new Promise<void>((resolve) => {
              releaseFlush = resolve
            })
            const off = yield* bus.subscribeAllCallback((event) => {
              if (event.properties?.sessionID !== session.id) return
              if (event.type === SessionStatus.Event.Status.type) {
                const value = event.properties.status
                if (value.type === "idle") observed.push("status:idle")
                if (value.type === "busy" && value.message === "flush") releaseFlush()
                return
              }
              if (event.type === SessionStatus.Event.Idle.type) observed.push("event:idle")
            })

            yield* state.cancel(session.id)
            yield* bus.publish(SessionStatus.Event.Status, {
              sessionID: session.id,
              status: { type: "busy", message: "flush" },
            })
            yield* Effect.promise(() => flushed)
            off()

            const row = Database.use((db) => db.select().from(RuntimeLeaseTable).get())
            expect(row?.cancel_requested_at).not.toBeNull()
            expect(yield* status.get(session.id)).toEqual({
              type: "busy",
              message: "Running in another client.",
            })
            expect(observed).toEqual([])
            Database.use((db) => db.delete(RuntimeLeaseTable).run())
          }),
        ),
    })
  })
})
