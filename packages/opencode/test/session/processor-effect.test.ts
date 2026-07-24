import { NodeFileSystem } from "@effect/platform-node"
import { beforeEach, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { Log } from "../../src/util"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { raw, reply, TestLLMServer } from "../lib/llm-server"
import { MockLLM, type MockEvent, textReply } from "../lib/mock-llm"
import { resetAllMonitors } from "../../src/session/try-best-detector"

void Log.init({ print: false })

const retryMock = new MockLLM()

beforeEach(() => {
  resetAllMonitors()
  retryMock.reset()
})

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  status,
).pipe(Layer.provideMerge(infra))
const processorEnv = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
const env = Layer.mergeAll(TestLLMServer.layer, processorEnv)
const retryDeps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  retryMock.layer(),
  Provider.defaultLayer,
  status,
).pipe(Layer.provideMerge(infra))
const retryProcessorEnv = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(retryDeps))

const it = testEffect(env)
const processorIt = testEffect(processorEnv)
const retryProcessorIt = testEffect(retryProcessorEnv)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

it.live("session.processor persists provider usage from the completed model call", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.text("hello", { usage: { input: 54_321, output: 5 } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const input = {
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        } satisfies LLM.StreamInput

        const value = yield* handle.process(input)
        const parts = MessageV2.parts(msg.id)
        const stored = MessageV2.get({ sessionID: chat.id, messageID: msg.id })
        const calls = yield* llm.calls

        expect(value).toBe("continue")
        expect(calls).toBe(1)
        expect(parts.some((part) => part.type === "text" && part.text === "hello")).toBe(true)
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.tokens.input).toBe(54_321)
          expect(stored.info.tokens.output).toBe(5)
        }
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests preserve text start time", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const gate = defer<void>()
        const { processors, session, provider } = yield* boot()

        yield* llm.push(
          raw({
            head: [
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { role: "assistant" } }],
              },
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { content: "hello" } }],
              },
            ],
            wait: gate.promise,
            tail: [
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: {}, finish_reason: "stop" }],
              },
            ],
          }),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "hi" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* Effect.promise(async () => {
          const stop = Date.now() + 500
          while (Date.now() < stop) {
            const text = MessageV2.parts(msg.id).find((part): part is MessageV2.TextPart => part.type === "text")
            if (text?.time?.start) return
            await Bun.sleep(10)
          }
          throw new Error("timed out waiting for text part")
        })
        yield* Effect.sleep("20 millis")
        gate.resolve()

        const exit = yield* Fiber.await(run)
        const text = MessageV2.parts(msg.id).find((part): part is MessageV2.TextPart => part.type === "text")

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(text?.text).toBe("hello")
        expect(text?.time?.start).toBeDefined()
        expect(text?.time?.end).toBeDefined()
        if (!text?.time?.start || !text.time.end) return
        expect(text.time.start).toBeLessThan(text.time.end)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests stop after token overflow requests compaction", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.text("after", { usage: { input: 100, output: 0 } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const base = yield* provider.getModel(ref.providerID, ref.modelID)
        const mdl = { ...base, limit: { context: 20, output: 10 } }
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "compact" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("overflow")
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(parts.some((part) => part.type === "step-finish")).toBe(true)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests capture reasoning from http mock", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(reply().reason("think").text("done").stop())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)
        const reasoning = parts.find((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
        const text = parts.find((part): part is MessageV2.TextPart => part.type === "text")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(1)
        expect(reasoning?.text).toBe("think")
        expect(text?.text).toBe("done")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests reset reasoning state across retries", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(reply().reason("one").reset(), reply().reason("two").stop())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)
        const reasoning = parts.filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(reasoning.some((part) => part.text === "two")).toBe(true)
        expect(reasoning.some((part) => part.text === "onetwo")).toBe(false)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests do not retry unknown json errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(400, { error: { message: "no_kv_space" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "json" }],
          tools: {},
        })

        expect(value).toBe("stop")
        expect(yield* llm.calls).toBe(1)
        expect(handle.message.error?.name).toBe("APIError")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests retry recognized structured json errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(429, { type: "error", error: { type: "too_many_requests" } })
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry json" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

retryProcessorIt.live(
  "session.processor retries a socket reset during pending tool input and removes the stale tool card",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const { processors, session, provider } = yield* boot()
          const callID = "call_pending_write"
          const reset = Object.assign(new Error("The socket connection was closed unexpectedly"), {
            code: "ECONNRESET",
          })
          retryMock.enqueue(
            [
              { type: "start-step" },
              { type: "tool-input-start", id: callID, toolName: "write" },
              { type: "error", error: reset },
            ] satisfies MockEvent[],
            textReply("recovered"),
          )

          const chat = yield* session.create({})
          const parent = yield* user(chat.id, "write the design")
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

          const value = yield* handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "write the design" }],
            tools: {},
          })

          const parts = MessageV2.parts(msg.id)
          expect(value).toBe("continue")
          expect(retryMock.calls).toBe(2)
          expect(parts.some((part) => part.type === "tool")).toBe(false)
          expect(parts.some((part) => part.type === "text" && part.text === "recovered")).toBe(true)
          expect(handle.message.error).toBeUndefined()
        }),
      { git: true, config: cfg },
    ),
)

retryProcessorIt.live(
  "session.processor does not replay a transient failure after a tool result may have side effects",
  () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const { processors, session, provider } = yield* boot()
          const callID = "call_completed_write"
          const reset = Object.assign(new Error("The socket connection was closed unexpectedly"), {
            code: "ECONNRESET",
          })
          retryMock.enqueue(
            [
              { type: "start-step" },
              { type: "tool-input-start", id: callID, toolName: "write" },
              { type: "tool-call", toolCallId: callID, toolName: "write", input: { file_path: "DES-001.md" } },
              {
                type: "tool-result",
                toolCallId: callID,
                output: { title: "DES-001.md", metadata: {}, output: "written" },
              },
              { type: "error", error: reset },
            ] satisfies MockEvent[],
            textReply("must not run"),
          )

          const chat = yield* session.create({})
          const parent = yield* user(chat.id, "write once")
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

          const value = yield* handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "write once" }],
            tools: {},
          })

          const tool = MessageV2.parts(msg.id).find((part): part is MessageV2.ToolPart => part.type === "tool")
          expect(value).toBe("stop")
          expect(retryMock.calls).toBe(1)
          expect(tool?.state.status).toBe("completed")
          expect(handle.message.error?.name).toBe("APIError")
        }),
      { git: true, config: cfg },
    ),
)

it.live(
  "session.processor enforces the total retry wall-clock budget during a hanging attempt",
  () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          const { processors, session, provider } = yield* boot()
          yield* llm.hang

          const chat = yield* session.create({})
          const parent = yield* user(chat.id, "wait forever")
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const handle = yield* processors.create({
            assistantMessage: msg,
            sessionID: chat.id,
            model: mdl,
            retryBudget: { maxRetries: 2, maxElapsedMs: 150, maxDelayMs: 25 },
          })

          const started = Date.now()
          const value = yield* handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "wait forever" }],
            tools: {},
          })

          expect(value).toBe("stop")
          expect(Date.now() - started).toBeLessThan(2_000)
          expect(yield* llm.calls).toBe(1)
          expect(handle.message.error?.name).toBe("RetryExhaustedError")
          if (handle.message.error?.name === "RetryExhaustedError") {
            expect(handle.message.error.data.reason).toBe("elapsed_exhausted")
            expect(handle.message.error.data.attempts).toBe(1)
          }
        }),
      { git: true, config: (url) => providerCfg(url) },
    ),
  10_000,
)

retryProcessorIt.live("session.processor cancellation interrupts retry backoff before another request starts", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service
        const retrySeen = defer<void>()
        const reset = Object.assign(new Error("The socket connection was closed unexpectedly"), {
          code: "ECONNRESET",
        })
        retryMock.enqueue([{ type: "error", error: reset }] satisfies MockEvent[], textReply("must not run"))

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "cancel retry")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID === chat.id && evt.properties.status.type === "retry") retrySeen.resolve()
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          retryBudget: { maxRetries: 2, maxElapsedMs: 10_000, maxDelayMs: 5_000 },
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "cancel retry" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* Effect.promise(() => retrySeen.promise)
        yield* Fiber.interrupt(run)
        const exit = yield* Fiber.await(run)
        off()

        expect(Exit.isFailure(exit)).toBe(true)
        expect(retryMock.calls).toBe(1)
        expect(handle.message.error?.name).toBe("MessageAbortedError")
      }),
    { git: true, config: cfg },
  ),
)

it.live("session.processor effect tests publish retry status updates", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.error(503, { error: "boom" })
        yield* llm.text("")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry" }],
          tools: {},
        })

        off()

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests compact on structured context overflow", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "compact json" }],
          tools: {},
        })

        expect(value).toBe("overflow")
        expect(yield* llm.calls).toBe(1)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor exposes partial write input while tool arguments stream", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const content = Array.from(
          { length: 40 },
          (_, index) => "line " + (index + 1) + ": streaming write preview",
        ).join("\n")

        const filepath = path.join(dir, "preview.txt")

        yield* llm.toolHang("write", {
          content,
          file_path: filepath,
        })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "write a large file")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "write a large file" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        const preview = yield* Effect.promise(async () => {
          const end = Date.now() + 1_000
          while (Date.now() < end) {
            const part = MessageV2.parts(msg.id).find((item): item is MessageV2.ToolPart => item.type === "tool")
            if (part) return structuredClone(part)
            await Bun.sleep(10)
          }
          throw new Error("timed out waiting for pending write tool input")
        })

        yield* Fiber.interrupt(run)
        yield* Fiber.await(run)

        expect(preview.state.status).toBe("pending")
        if (preview.state.status !== "pending") return
        expect(preview.state.raw.length).toBeGreaterThan(0)
        expect(typeof preview.state.input.content).toBe("string")
        expect(preview.state.input.content.length).toBeGreaterThan(0)
        expect(content.startsWith(preview.state.input.content)).toBe(true)
        expect(preview.state.input.content.length).toBeLessThan(content.length)
        expect(yield* Effect.promise(() => Bun.file(filepath).exists())).toBe(false)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests discard incomplete pending tools on cleanup", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.toolHang("bash", { cmd: "pwd" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "tool abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "tool abort" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Effect.promise(async () => {
          const end = Date.now() + 500
          while (Date.now() < end) {
            const parts = await MessageV2.parts(msg.id)
            if (parts.some((part) => part.type === "tool")) return
            await Bun.sleep(10)
          }
        })
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        const parts = MessageV2.parts(msg.id)
        const call = parts.find((part): part is MessageV2.ToolPart => part.type === "tool")

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        }
        expect(yield* llm.calls).toBe(1)
        expect(call).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests record aborted errors and publish the error event", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const seen = defer<void>()
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.hang

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const errs: string[] = []
        const off = yield* bus.subscribeCallback(Session.Event.Error, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (!evt.properties.error) return
          errs.push(evt.properties.error.name)
          seen.resolve()
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "abort" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        yield* Effect.promise(() => seen.promise)
        const stored = MessageV2.get({ sessionID: chat.id, messageID: msg.id })
        off()

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        }
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
        expect(errs).toContain("MessageAbortedError")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests mark interruptions aborted without manual abort", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.hang

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "interrupt")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "interrupt" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        const stored = MessageV2.get({ sessionID: chat.id, messageID: msg.id })

        expect(Exit.isFailure(exit)).toBe(true)
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live.skip("session.processor pauses after three repeated failed bash commands", () =>
  provideTmpdirServer(
    ({ dir }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "fix the failing tests")
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const tools = {
          bash: {
            execute: async () => ({
              title: "Run tests",
              metadata: { exit: 1 },
              output: "1 test failed",
            }),
          },
        }
        const call = (id: string) => ({
          reasoning: "run tests",
          toolCalls: [{ toolCallId: id, toolName: "bash", input: { command: "bun test" } }],
          finishReason: "tool-calls",
          tools,
          messages: [],
        })

        const first = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const firstHandle = yield* processors.create({ assistantMessage: first, sessionID: chat.id, model: mdl })
        expect(yield* firstHandle.replay(call("call_first"))).toBe("continue")

        const second = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const secondHandle = yield* processors.create({ assistantMessage: second, sessionID: chat.id, model: mdl })
        expect(yield* secondHandle.replay(call("call_second"))).toBe("continue")

        const third = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const thirdHandle = yield* processors.create({ assistantMessage: third, sessionID: chat.id, model: mdl })
        expect(yield* thirdHandle.replay(call("call_third"))).toBe("stop")
        expect(
          MessageV2.parts(third.id).some(
            (part) => part.type === "text" && part.synthetic && part.metadata?.origin?.kind === "try_best",
          ),
        ).toBe(true)
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live.skip("session.processor preserves try-best blocking when denied tools may continue", () =>
  provideTmpdirServer(
    ({ dir }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "run the tests")
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const tools = {
          bash: {
            execute: async () => {
              throw new Permission.RejectedError()
            },
          },
        }
        const call = (id: string) => ({
          reasoning: "run tests",
          toolCalls: [{ toolCallId: id, toolName: "bash", input: { command: "bun test" } }],
          finishReason: "tool-calls",
          tools,
          messages: [],
        })

        const first = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const firstHandle = yield* processors.create({ assistantMessage: first, sessionID: chat.id, model: mdl })
        expect(yield* firstHandle.replay(call("call_first"))).toBe("continue")

        const second = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const secondHandle = yield* processors.create({ assistantMessage: second, sessionID: chat.id, model: mdl })
        expect(yield* secondHandle.replay(call("call_second"))).toBe("continue")

        const third = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const thirdHandle = yield* processors.create({ assistantMessage: third, sessionID: chat.id, model: mdl })
        expect(yield* thirdHandle.replay(call("call_third"))).toBe("stop")
      }),
    {
      git: true,
      config: (url) => ({
        ...providerCfg(url),
        experimental: { continue_loop_on_deny: true },
      }),
    },
  ),
)

processorIt.live("session.processor keeps a turn running across distinct successful edits", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "apply the planned changes")
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const runs = yield* Effect.forEach(
          ["a.ts", "b.ts", "c.ts", "d.ts"],
          (file) =>
            Effect.gen(function* () {
              const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
              const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
              const result = yield* handle.replay({
                reasoning: "apply edit",
                toolCalls: [{ toolCallId: `call_${file}`, toolName: "edit", input: { file_path: file } }],
                finishReason: "tool-calls",
                tools: {
                  edit: {
                    execute: async () => ({
                      title: file,
                      metadata: { diff: `-${file} old\n+${file} new` },
                      output: "Edit applied successfully.",
                    }),
                  },
                },
                messages: [],
              })
              return { msg, result }
            }),
          { concurrency: 1 },
        )

        expect(runs.map((run) => run.result)).toEqual(["continue", "continue", "continue", "continue"])
        expect(
          MessageV2.parts(runs.at(-1)!.msg.id).some(
            (part) => part.type === "text" && part.synthetic && part.metadata?.origin?.kind === "try_best",
          ),
        ).toBe(false)
      }),
    { git: true, config: cfg },
  ),
)

it.live("session.processor does not carry try-best evidence into a new user turn", () =>
  provideTmpdirServer(
    ({ dir }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const tools = {
          bash: {
            execute: async () => ({
              title: "Run tests",
              metadata: { exit: 1 },
              output: "1 test failed",
            }),
          },
        }
        const call = (id: string) => ({
          reasoning: "run tests",
          toolCalls: [{ toolCallId: id, toolName: "bash", input: { command: "bun test" } }],
          finishReason: "tool-calls",
          tools,
          messages: [],
        })

        const firstTurn = yield* user(chat.id, "fix the first issue")
        const first = yield* assistant(chat.id, firstTurn.id, path.resolve(dir))
        const firstHandle = yield* processors.create({ assistantMessage: first, sessionID: chat.id, model: mdl })
        expect(yield* firstHandle.replay(call("call_first"))).toBe("continue")

        const second = yield* assistant(chat.id, firstTurn.id, path.resolve(dir))
        const secondHandle = yield* processors.create({ assistantMessage: second, sessionID: chat.id, model: mdl })
        expect(yield* secondHandle.replay(call("call_second"))).toBe("continue")

        const secondTurn = yield* user(chat.id, "now fix a different issue")
        const third = yield* assistant(chat.id, secondTurn.id, path.resolve(dir))
        const thirdHandle = yield* processors.create({ assistantMessage: third, sessionID: chat.id, model: mdl })
        expect(yield* thirdHandle.replay(call("call_third"))).toBe("continue")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)
