import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRunState } from "../../src/session/run-state"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("SessionPrompt execution ownership", () => {
  test("rejects the wrong directory before persisting a user message", async () => {
    await using owner = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    const sessionID = await Instance.provide({
      directory: owner.path,
      fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.create())).then((session) => session.id),
    })

    const exit = await Instance.provide({
      directory: other.path,
      fn: () =>
        AppRuntime.runPromiseExit(
          SessionPrompt.Service.use((svc) =>
            svc.prompt({
              sessionID,
              agent: "main",
              parts: [{ type: "text", text: "must not persist" }],
              noReply: true,
            }),
          ),
        ),
    })
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("belongs to")

    const messages = await Instance.provide({
      directory: owner.path,
      fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.messages({ sessionID }))),
    })
    expect(messages).toHaveLength(0)
  })

  test("busy ownership is rejected before persisting a second user message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create()))
        AppRuntime.runFork(
          SessionRunState.Service.use((state) =>
            state.startShell(
              session.id,
              Effect.succeed({ info: { role: "assistant" }, parts: [] } as never),
              Effect.never as never,
            ),
          ),
        )
        await Bun.sleep(100)
        const exit = await AppRuntime.runPromiseExit(
          SessionPrompt.Service.use((svc) =>
            svc.prompt({
              sessionID: session.id,
              agent: "main",
              parts: [{ type: "text", text: "must remain unpersisted" }],
              noReply: true,
            }),
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        const messages = await AppRuntime.runPromise(
          Session.Service.use((svc) => svc.messages({ sessionID: session.id })),
        )
        expect(messages).toHaveLength(0)
        await AppRuntime.runPromise(SessionRunState.Service.use((state) => state.cancel(session.id)))
      },
    })
  })
})
