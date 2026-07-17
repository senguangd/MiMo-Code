import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, UserMessage } from "@mimo-ai/sdk/v2"
import { resolveContextUsage } from "../../../src/cli/cmd/tui/util/context-usage"

const sessionID = "ses_test"

function user(id: string): UserMessage {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: Number(id.slice(1)) },
    agent: "build",
    model: { providerID: "test", modelID: "main" },
  }
}

function assistant(
  id: string,
  input: number,
  options: Partial<AssistantMessage> & {
    cacheRead?: number
    cacheWrite?: number
    output?: number
    reasoning?: number
    context?: number
  } = {},
): AssistantMessage {
  return {
    id,
    sessionID,
    role: "assistant",
    parentID: "u1",
    providerID: options.providerID ?? "test",
    modelID: options.modelID ?? "main",
    mode: options.mode ?? "build",
    agent: options.agent ?? "build",
    path: { cwd: "/tmp", root: "/tmp" },
    summary: options.summary,
    cost: 0,
    tokens: {
      context: options.context,
      input,
      output: options.output ?? 0,
      reasoning: options.reasoning ?? 0,
      cache: { read: options.cacheRead ?? 0, write: options.cacheWrite ?? 0 },
    },
    time: { created: Number(id.slice(1)), completed: Number(id.slice(1)) + 1 },
    finish: "stop",
  }
}

function part(messageID: string, type: "checkpoint" | "compaction"): Part {
  if (type === "checkpoint") {
    return {
      id: `p-${messageID}`,
      sessionID,
      messageID,
      type,
      checkpointDir: "/tmp/checkpoint",
      checkpointNumber: 1,
      coveredUpTo: "u0",
    }
  }
  return { id: `p-${messageID}`, sessionID, messageID, type, auto: false }
}

function resolve(
  messages: Message[],
  parts: Record<string, Part[]> = {},
  live?: { input: number; output: number; limit: number; inputLimit: number },
) {
  return resolveContextUsage({
    messages,
    parts: (messageID) => parts[messageID] ?? [],
    live,
    contextLimit: (providerID, modelID) => (providerID === "test" && modelID === "main" ? 100_000 : 200_000),
  })
}

describe("TUI context usage", () => {
  test("uses exact live request input and reserved output", () => {
    expect(
      resolve([user("u1")], {}, { input: 12_000, output: 8_000, limit: 100_000, inputLimit: 92_000 }),
    ).toEqual({
      kind: "live",
      input: 12_000,
      reserved: 8_000,
      limit: 100_000,
      inputLimit: 92_000,
    })
  })

  test("last request counts input and cache but excludes output and reasoning", () => {
    expect(
      resolve([
        user("u1"),
        assistant("a2", 40_000, { cacheRead: 5_000, cacheWrite: 2_000, output: 9_000, reasoning: 4_000 }),
      ]),
    ).toEqual({ kind: "last", input: 47_000, reserved: null, limit: 100_000 })
  })

  test("uses persisted exact request context after streaming ends", () => {
    expect(
      resolve([
        user("u1"),
        assistant("a2", 40_000, { context: 52_000, cacheRead: 5_000, output: 9_000, reasoning: 4_000 }),
      ]),
    ).toEqual({ kind: "last", input: 52_000, reserved: null, limit: 100_000 })
  })

  test("compaction summary invalidates the pre-compaction request instead of exposing its usage", () => {
    expect(
      resolve([user("u1"), assistant("a2", 60_000), user("u3"), assistant("a4", 150_000, { summary: true })], {
        u3: [part("u3", "compaction")],
      }),
    ).toEqual({ kind: "invalidated" })
  })

  test("checkpoint and compaction boundaries invalidate stale requests before a summary exists", () => {
    for (const type of ["checkpoint", "compaction"] as const) {
      expect(resolve([user("u1"), assistant("a2", 60_000), user("u3")], { u3: [part("u3", type)] })).toEqual({
        kind: "invalidated",
      })
    }
  })

  test("a normal request after the boundary restores an exact reading", () => {
    expect(
      resolve(
        [
          user("u1"),
          assistant("a2", 60_000),
          user("u3"),
          assistant("a4", 150_000, { summary: true }),
          user("u5"),
          assistant("a6", 20_000, { cacheRead: 1_000 }),
        ],
        { u3: [part("u3", "compaction")] },
      ),
    ).toEqual({ kind: "last", input: 21_000, reserved: null, limit: 100_000 })
  })

  test("uses the model limit of the last valid main request", () => {
    expect(resolve([user("u1"), assistant("a2", 25_000, { modelID: "other" })])).toEqual({
      kind: "last",
      input: 25_000,
      reserved: null,
      limit: 200_000,
    })
  })
})
