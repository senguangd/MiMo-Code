import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPromptState } from "../../src/session/prompt-state"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("SessionPromptState", () => {
  test("claims recall once per user message and pressure once per checkpoint episode", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create()))
        expect(await AppRuntime.runPromise(SessionPromptState.claimRecall(session.id, "msg-1"))).toBe(true)
        expect(await AppRuntime.runPromise(SessionPromptState.claimRecall(session.id, "msg-1"))).toBe(false)
        expect(await AppRuntime.runPromise(SessionPromptState.claimRecall(session.id, "msg-2"))).toBe(true)
        expect(await AppRuntime.runPromise(SessionPromptState.claimPressure(session.id, "root"))).toBe(true)
        expect(await AppRuntime.runPromise(SessionPromptState.claimPressure(session.id, "root"))).toBe(false)
        expect(await AppRuntime.runPromise(SessionPromptState.claimPressure(session.id, "checkpoint-2"))).toBe(true)
      },
    })
  })
})
