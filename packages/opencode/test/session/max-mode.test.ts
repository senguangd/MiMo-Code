import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { parseJudgeIndex, runMaxStep, toSchemaOnlyTools, type MaxStepInput } from "../../src/session/max-mode"
import type { LLM } from "../../src/session/llm"
import type { SessionProcessor } from "../../src/session/processor"

describe("max-mode toSchemaOnlyTools", () => {
  test("strips execute closures but keeps schema fields", () => {
    const tools = {
      read: { description: "Read a file", inputSchema: { type: "object" }, execute: async () => ({}) },
      bash: { description: "Run a command", inputSchema: { type: "object" }, execute: async () => ({}) },
    } as any

    const out = toSchemaOnlyTools(tools)

    expect(Object.keys(out).sort()).toEqual(["bash", "read"])
    for (const key of Object.keys(out)) {
      expect((out[key] as any).execute).toBeUndefined()
      expect((out[key] as any).description).toBe((tools[key] as any).description)
      expect((out[key] as any).inputSchema).toBe((tools[key] as any).inputSchema)
    }
  })

  test("does not mutate the input tools", () => {
    const tools = {
      read: { description: "Read", inputSchema: {}, execute: async () => ({}) },
    } as any
    toSchemaOnlyTools(tools)
    expect(typeof (tools.read as any).execute).toBe("function")
  })
})

describe("max-mode parseJudgeIndex", () => {
  test("parses a bare integer", () => {
    expect(parseJudgeIndex("2", 5)).toBe(2)
  })

  test("extracts the first integer from prose", () => {
    expect(parseJudgeIndex("I pick candidate 3 because it is best.", 5)).toBe(3)
  })

  test("defaults to 0 when no integer present", () => {
    expect(parseJudgeIndex("none of them", 5)).toBe(0)
  })

  test("defaults to 0 when index out of range", () => {
    expect(parseJudgeIndex("9", 5)).toBe(0)
  })

  test("accepts boundary index 0", () => {
    expect(parseJudgeIndex("0", 5)).toBe(0)
  })

  test("accepts last valid index", () => {
    expect(parseJudgeIndex("4", 5)).toBe(4)
  })
})

describe("max-mode provider usage", () => {
  test("propagates the winning provider usage into replay", async () => {
    let replayed: SessionProcessor.ReplayInput | undefined
    const usage = { inputTokens: 54_321, outputTokens: 5, totalTokens: 54_326 }
    const llm = {
      stream() {
        return Stream.fromIterable([
          { type: "text-delta", text: "winner" } as LLM.Event,
          { type: "finish-step", finishReason: "stop", usage } as LLM.Event,
        ])
      },
    }
    const input = {
      handle: {
        replay(value: SessionProcessor.ReplayInput) {
          replayed = value
          return Effect.succeed("continue" as const)
        },
      },
      llm,
      user: {},
      agent: {},
      model: {},
      sessionID: "ses_test",
      system: [],
      messages: [],
      tools: {},
      candidates: 1,
    } as unknown as MaxStepInput

    expect(await Effect.runPromise(runMaxStep(input))).toBe("continue")
    expect(replayed?.usage).toEqual(usage)
  })
})
