import { describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SessionStatus } from "../../src/session/status"
import { tmpdir } from "../fixture/fixture"

const estimate = {
  tokens: 22_100,
  basis: "pending-request" as const,
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("main"),
  calculatedAt: 11,
}

describe("session status context estimate", () => {
  test("preserves an estimate across same-message busy and retry updates", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_estimate")
        const messageID = MessageID.make("msg_estimate")
        const status = (value: SessionStatus.Info) =>
          AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.set(sessionID, value)))

        await status({ type: "busy", messageID, contextEstimate: estimate })
        await status({ type: "busy", messageID })
        expect(await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID)))).toMatchObject({
          type: "busy",
          contextEstimate: estimate,
        })

        await status({ type: "retry", messageID, attempt: 1, message: "retry", next: 1 })
        expect(await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID)))).toMatchObject({
          type: "retry",
          contextEstimate: estimate,
        })
      },
    })
  })

  test("does not carry an estimate into a different message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_estimate_new")
        await AppRuntime.runPromise(
          SessionStatus.Service.use((svc) =>
            svc.set(sessionID, { type: "busy", messageID: MessageID.make("msg_old"), contextEstimate: estimate }),
          ),
        )
        await AppRuntime.runPromise(
          SessionStatus.Service.use((svc) => svc.set(sessionID, { type: "busy", messageID: MessageID.make("msg_new") })),
        )

        expect(await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID)))).toEqual({
          type: "busy",
          messageID: MessageID.make("msg_new"),
        })
      },
    })
  })
})
