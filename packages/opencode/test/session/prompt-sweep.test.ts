import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, CrossSpawnSpawner.defaultLayer))

const makeAssistant = (
  sessionID: MessageV2.Assistant["sessionID"],
  parentID: MessageV2.Assistant["parentID"],
  dir: string,
  time: MessageV2.Assistant["time"],
): MessageV2.Assistant => ({
  id: MessageID.ascending(),
  role: "assistant",
  sessionID,
  mode: "default",
  agent: "default",
  path: { cwd: path.resolve(dir), root: path.resolve(dir) },
  cost: 0,
  tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  modelID: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  parentID,
  time,
})

describe("sweepOrphanAssistants", () => {
  it.live("marks an assistant message older than 60s as completed with AbortedError", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 7_300_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 7_200_000 })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.role).toBe("assistant")
        expect(info.time.completed).toBeDefined()
        expect(info.time.completed!).toBeGreaterThanOrEqual(now)
        expect(info.error).toBeDefined()
        expect(JSON.stringify(info.error)).toContain("Abandoned")
      }),
    ),
  )

  it.live("leaves a recent (under 60s) incomplete assistant message untouched when not immediate", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 1_900_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 1_800_000 })
        yield* sessions.updateMessage(assistant)

        // immediate defaults to false → the age guard protects an in-flight
        // (busy) turn's still-progressing assistant.
        yield* svc.sweepOrphanAssistants(session.id)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBeUndefined()
        expect(info.error).toBeUndefined()
      }),
    ),
  )

  it.live("sweeps a recent (under 60s) incomplete assistant when immediate (idle session)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 5_000 },
        })

        // A fresh orphan (well under ORPHAN_AGE_MS) — the exact shape a hard
        // interruption leaves behind. On an idle session this must be swept so
        // the next user message is not rendered as stuck QUEUED behind it.
        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 3_000 })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id, true)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBeDefined()
        expect(info.time.completed!).toBeGreaterThanOrEqual(now)
        expect(info.error).toBeDefined()
        expect(JSON.stringify(info.error)).toContain("Abandoned")
      }),
    ),
  )

  it.live("reconciles orphaned stream parts before completing the assistant", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 5_000 },
        })

        const now = Date.now()
        const assistant = makeAssistant(session.id, userMsg.id, dir, { created: now - 3_000 })
        yield* sessions.updateMessage(assistant)

        const emptyTextID = PartID.ascending()
        yield* sessions.updatePart({
          id: emptyTextID,
          messageID: assistant.id,
          sessionID: session.id,
          type: "text",
          text: "",
          time: { start: now - 2_500 },
        } satisfies MessageV2.TextPart)

        const partialTextID = PartID.ascending()
        const partialTextStartedAt = now - 2_400
        yield* sessions.updatePart({
          id: partialTextID,
          messageID: assistant.id,
          sessionID: session.id,
          type: "text",
          text: "partial answer",
          time: { start: partialTextStartedAt },
        } satisfies MessageV2.TextPart)

        const reasoningID = PartID.ascending()
        const reasoningStartedAt = now - 2_300
        yield* sessions.updatePart({
          id: reasoningID,
          messageID: assistant.id,
          sessionID: session.id,
          type: "reasoning",
          text: "thinking",
          time: { start: reasoningStartedAt },
        } satisfies MessageV2.ReasoningPart)

        const pendingID = PartID.ascending()
        yield* sessions.updatePart({
          id: pendingID,
          messageID: assistant.id,
          sessionID: session.id,
          type: "tool",
          tool: "write",
          callID: "call-pending",
          state: { status: "pending", input: {}, raw: '{"file_path":' },
        } satisfies MessageV2.ToolPart)

        const runningID = PartID.ascending()
        const runningStartedAt = now - 2_000
        yield* sessions.updatePart({
          id: runningID,
          messageID: assistant.id,
          sessionID: session.id,
          type: "tool",
          tool: "bash",
          callID: "call-running",
          state: {
            status: "running",
            input: { command: "echo test" },
            metadata: { output: "partial" },
            time: { start: runningStartedAt },
          },
        } satisfies MessageV2.ToolPart)

        const completedID = PartID.ascending()
        yield* sessions.updatePart({
          id: completedID,
          messageID: assistant.id,
          sessionID: session.id,
          type: "tool",
          tool: "read",
          callID: "call-completed",
          state: {
            status: "completed",
            input: { file_path: "done" },
            output: "ok",
            title: "done",
            metadata: {},
            time: { start: now - 2_000, end: now - 1_000 },
          },
        } satisfies MessageV2.ToolPart)

        yield* svc.sweepOrphanAssistants(session.id, true)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        if (!updated || updated.info.role !== "assistant") throw new Error("expected assistant message")
        expect(updated.info.time.completed).toBeDefined()
        expect(updated.info.error).toBeDefined()

        expect(updated.parts.some((part) => part.id === emptyTextID)).toBe(false)
        const partialText = updated.parts.find((part) => part.id === partialTextID)
        expect(partialText?.type).toBe("text")
        if (partialText?.type === "text") {
          expect(partialText.time?.start).toBe(partialTextStartedAt)
          expect(partialText.time?.end).toBeGreaterThanOrEqual(now)
        }
        const reasoning = updated.parts.find((part) => part.id === reasoningID)
        expect(reasoning?.type).toBe("reasoning")
        if (reasoning?.type === "reasoning") {
          expect(reasoning.time.start).toBe(reasoningStartedAt)
          expect(reasoning.time.end).toBeGreaterThanOrEqual(now)
        }

        expect(updated.parts.some((part) => part.id === pendingID)).toBe(false)

        const running = updated.parts.find((part) => part.id === runningID)
        expect(running?.type).toBe("tool")
        if (running?.type === "tool") {
          expect(running.state.status).toBe("error")
          if (running.state.status === "error") {
            expect(running.state.error).toBe("Tool execution interrupted")
            expect(running.state.metadata).toEqual({ output: "partial", interrupted: true })
            expect(running.state.time.start).toBe(runningStartedAt)
            expect(running.state.time.end).toBeGreaterThanOrEqual(now)
          }
        }

        const completed = updated.parts.find((part) => part.id === completedID)
        expect(completed?.type).toBe("tool")
        if (completed?.type === "tool") {
          expect(completed.state.status).toBe("completed")
          if (completed.state.status === "completed") expect(completed.state.output).toBe("ok")
        }
      }),
    ),
  )

  it.live("leaves an already-completed assistant message untouched", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const svc = yield* SessionPrompt.Service
        const session = yield* sessions.create({})

        const userMsg = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 7_300_000 },
        })

        const now = Date.now()
        const originalCompleted = now - 7_200_000
        const assistant = makeAssistant(session.id, userMsg.id, dir, {
          created: now - 7_200_000,
          completed: originalCompleted,
        })
        yield* sessions.updateMessage(assistant)

        yield* svc.sweepOrphanAssistants(session.id)

        const after = yield* sessions.messages({ sessionID: session.id })
        const updated = after.find((m) => m.info.id === assistant.id)
        expect(updated).toBeDefined()
        const info = updated!.info as MessageV2.Assistant
        expect(info.time.completed).toBe(originalCompleted)
        expect(info.error).toBeUndefined()
      }),
    ),
  )
})
