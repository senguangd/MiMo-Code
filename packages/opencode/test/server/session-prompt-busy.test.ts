import { afterEach, describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { Hono } from "hono"
import { ErrorMiddleware } from "../../src/server/middleware"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRunState } from "../../src/session/run-state"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { RuntimeLease } from "../../src/runtime/lease"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("ErrorMiddleware → BusyError mapping", () => {
  test("BusyError maps to HTTP 409 Conflict", async () => {
    const app = new Hono()
    app.get("/throw-busy", () => {
      throw new Session.BusyError("ses_test_busy")
    })
    app.onError(ErrorMiddleware)

    const res = await app.request("/throw-busy")
    expect(res.status).toBe(409)
    const body = (await res.json()) as { name: string; data: { message: string } }
    expect(body.data.message).toContain("ses_test_busy")
  })
})

describe("POST /session/:sessionID/message busy-runner behavior", () => {
  test("returns 409 when session main runner is already busy", async () => {
    await using tmp = await tmpdir({})

    const status = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sess = yield* sessions.create({ title: "busy-runner test" })
            const state = yield* SessionRunState.Service

            // Occupy the main runner with an Effect that never resolves.
            // Forked so we can continue and issue the conflicting POST.
            yield* state
              .startShell(sess.id, Effect.succeed({ info: {}, parts: [] } as never), Effect.never as never)
              .pipe(Effect.forkChild)

            // Give the scheduler a tick so the occupant marks the runner busy.
            yield* Effect.sleep("50 millis")

            // Pass ?directory= so InstanceMiddleware resolves to the same instance
            // the test created. Without this, the route handler would land in a
            // different Instance (process.cwd()) whose SessionRunState has no busy
            // runner, defeating the test.
            const app = Server.Default().app
            const res = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/message?directory=${encodeURIComponent(tmp.path)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  parts: [{ type: "text", text: "should be rejected" }],
                }),
              }),
            )

            // Best-effort: stop the occupant so afterEach disposal is clean.
            yield* state.cancel(sess.id)

            return res.status
          }),
        ),
    })

    expect(status).toBe(409)
  })

  test("POST /:sessionID/abort releases the ownership gate for the next prompt", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sess = yield* sessions.create({ title: "busy-recover test" })
            const state = yield* SessionRunState.Service

            const shell = yield* state
              .startShell(sess.id, Effect.succeed({ info: {}, parts: [] } as never), Effect.never as never)
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const app = Server.Default().app
            const dirQuery = `?directory=${encodeURIComponent(tmp.path)}`

            // Confirm the HTTP route's ownership preflight reports 409.
            const first = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/message${dirQuery}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parts: [{ type: "text", text: "first" }] }),
              }),
            )

            // Abort acknowledges immediately; the owner releases its lease during cleanup.
            const abort = yield* Effect.promise(async () =>
              app.request(`/session/${sess.id}/abort${dirQuery}`, { method: "POST" }),
            )
            yield* Fiber.await(shell)

            // Exercise the exact preflight used by POST /message, then persist a
            // noReply user turn without involving a real provider or response stream.
            yield* state.assertNotBusy(sess.id)
            const prompt = yield* SessionPrompt.Service
            const second = yield* prompt.prompt({
              sessionID: sess.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "second" }],
            })
            return { firstStatus: first.status, abortStatus: abort.status, secondRole: second.info.role }
          }),
        ),
    })

    expect(result.firstStatus).toBe(409)
    expect(result.abortStatus).toBe(200)
    expect(result.secondRole).toBe("user")
  })

  test("PATCH part is rejected while the session owner is active and leaves storage unchanged", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const state = yield* SessionRunState.Service
            const prompt = yield* SessionPrompt.Service
            const sess = yield* sessions.create({ title: "part-update ownership test" })
            const seeded = yield* prompt.prompt({
              sessionID: sess.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "original" }],
            })
            const part = seeded.parts.find((candidate) => candidate.type === "text")
            if (!part || part.type !== "text") throw new Error("seed text part missing")

            const shell = yield* state
              .startShell(sess.id, Effect.succeed({ info: {}, parts: [] } as never), Effect.never as never)
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const app = Server.Default().app
            const response = yield* Effect.promise(() =>
              Promise.resolve(
                app.request(
                  `/session/${sess.id}/message/${seeded.info.id}/part/${part.id}?directory=${encodeURIComponent(tmp.path)}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...part, text: "mutated" }),
                  },
                ),
              ),
            )
            const stored = (yield* sessions.messages({ sessionID: sess.id }))
              .flatMap((message) => message.parts)
              .find((candidate) => candidate.id === part.id)

            yield* state.cancel(sess.id)
            yield* Fiber.await(shell)
            return { status: response.status, text: stored?.type === "text" ? stored.text : undefined }
          }),
        ),
    })

    expect(result.status).toBe(409)
    expect(result.text).toBe("original")
  })

  test("PATCH part is rejected while a background actor owns the session", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const sess = yield* sessions.create({ title: "background ownership test" })
            const seeded = yield* prompt.prompt({
              sessionID: sess.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: "original" }],
            })
            const part = seeded.parts.find((candidate) => candidate.type === "text")
            if (!part || part.type !== "text") throw new Error("seed text part missing")

            const handle = yield* RuntimeLease.acquire({
              resourceType: "session-run",
              resourceID: sess.id,
              subresourceID: "general-1",
            })
            if (!handle) throw new Error("background lease missing")

            const app = Server.Default().app
            const response = yield* Effect.promise(() =>
              Promise.resolve(
                app.request(
                  `/session/${sess.id}/message/${seeded.info.id}/part/${part.id}?directory=${encodeURIComponent(tmp.path)}`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...part, text: "mutated" }),
                  },
                ),
              ),
            )
            const stored = (yield* sessions.messages({ sessionID: sess.id }))
              .flatMap((message) => message.parts)
              .find((candidate) => candidate.id === part.id)
            yield* RuntimeLease.release(handle)
            return { status: response.status, text: stored?.type === "text" ? stored.text : undefined }
          }),
        ),
    })

    expect(result.status).toBe(409)
    expect(result.text).toBe("original")
  })

  test("DELETE session is rejected while its main owner is active", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const state = yield* SessionRunState.Service
            const sess = yield* sessions.create({ title: "session delete ownership test" })
            const shell = yield* state
              .startShell(sess.id, Effect.succeed({ info: {}, parts: [] } as never), Effect.never as never)
              .pipe(Effect.forkChild)
            yield* Effect.sleep("50 millis")

            const app = Server.Default().app
            const response = yield* Effect.promise(() =>
              Promise.resolve(
                app.request(`/session/${sess.id}?directory=${encodeURIComponent(tmp.path)}`, { method: "DELETE" }),
              ),
            )
            const exists = Exit.isSuccess(yield* sessions.get(sess.id).pipe(Effect.exit))
            yield* state.cancel(sess.id)
            yield* Fiber.await(shell)
            return { status: response.status, exists }
          }),
        ),
    })

    expect(result.status).toBe(409)
    expect(result.exists).toBe(true)
  })

  test("DELETE session is rejected while its checkpoint writer lease is active", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sess = yield* sessions.create({ title: "checkpoint delete ownership test" })
            const checkpoint = yield* RuntimeLease.acquire({
              resourceType: "checkpoint",
              resourceID: sess.id,
            })
            if (!checkpoint) throw new Error("checkpoint lease missing")

            const app = Server.Default().app
            const response = yield* Effect.promise(() =>
              Promise.resolve(
                app.request(`/session/${sess.id}?directory=${encodeURIComponent(tmp.path)}`, { method: "DELETE" }),
              ),
            )
            const exists = Exit.isSuccess(yield* sessions.get(sess.id).pipe(Effect.exit))
            yield* RuntimeLease.release(checkpoint)
            return { status: response.status, exists }
          }),
        ),
    })

    expect(result.status).toBe(409)
    expect(result.exists).toBe(true)
  })

  test("POST /:sessionID/abort acknowledges before interrupted cleanup completes", async () => {
    await using tmp = await tmpdir({})

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const sess = yield* sessions.create({ title: "abort-cleanup test" })
            const state = yield* SessionRunState.Service
            const status = yield* SessionStatus.Service
            const cleanup = yield* Deferred.make<void>()
            const interrupted = yield* Deferred.make<void>()

            return yield* Effect.gen(function* () {
              const shell = yield* state
                .startShell(
                  sess.id,
                  Effect.succeed({ info: {}, parts: [] } as never),
                  Effect.never.pipe(
                    Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
                    Effect.ensuring(Deferred.await(cleanup)),
                  ) as never,
                )
                .pipe(Effect.forkChild)
              yield* Effect.sleep("50 millis")

              const app = Server.Default().app
              const dirQuery = `?directory=${encodeURIComponent(tmp.path)}`
              const abort = yield* Effect.promise(async () =>
                app.request(`/session/${sess.id}/abort${dirQuery}`, { method: "POST" }),
              ).pipe(Effect.forkChild)
              const abortExit = yield* Fiber.await(abort).pipe(Effect.timeout("1 second"))
              const duringCleanup = yield* status.get(sess.id)
              const interruptionDelivered = yield* Deferred.isDone(interrupted)

              const repeated = yield* Effect.promise(async () =>
                app.request(`/session/${sess.id}/abort${dirQuery}`, { method: "POST" }),
              )

              yield* Deferred.succeed(cleanup, undefined)
              yield* Fiber.await(shell)
              const afterCleanup = yield* status.get(sess.id)

              return {
                abortStatus: abortExit && Exit.isSuccess(abortExit) ? abortExit.value.status : undefined,
                repeatedStatus: repeated.status,
                duringCleanupStatus: duringCleanup.type,
                afterCleanupStatus: afterCleanup.type,
                interruptionDelivered,
              }
            }).pipe(Effect.ensuring(Deferred.succeed(cleanup, undefined).pipe(Effect.ignore)))
          }),
        ),
    })

    expect(result.abortStatus).toBe(200)
    expect(result.repeatedStatus).toBe(200)
    expect(result.duringCleanupStatus).toBe("busy")
    expect(result.afterCleanupStatus).toBe("idle")
    expect(result.interruptionDelivered).toBe(true)
  })
})
