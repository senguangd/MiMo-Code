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
    total?: number
    cacheRead?: number
    cacheWrite?: number
    output?: number
    reasoning?: number
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
      total: options.total,
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

function resolve(messages: Message[], parts: Record<string, Part[]> = {}) {
  return resolveContextUsage({
    messages,
    parts: (messageID) => parts[messageID] ?? [],
    contextLimit: (providerID, modelID) => (providerID === "test" && modelID === "main" ? 100_000 : 200_000),
  })
}

describe("TUI context usage", () => {
  test("completed response includes prompt, output, reasoning, and cache in current context", () => {
    expect(
      resolve([
        user("u1"),
        assistant("a2", 40_000, { cacheRead: 5_000, cacheWrite: 2_000, output: 9_000, reasoning: 4_000 }),
      ]),
    ).toEqual({ kind: "current", tokens: 60_000, limit: 100_000 })
  })

  test("prefers provider-reported total", () => {
    expect(
      resolve([
        user("u1"),
        assistant("a2", 58_893, { total: 63_450, output: 4_490, reasoning: 67 }),
      ]),
    ).toEqual({ kind: "current", tokens: 63_450, limit: 100_000 })
  })

  test("ignores a legacy estimated context field", () => {
    const message = assistant("a2", 40_000, { cacheRead: 5_000, output: 9_000, reasoning: 4_000 })
    ;(message.tokens as unknown as { context: number }).context = 52_000
    expect(resolve([user("u1"), message])).toEqual({ kind: "current", tokens: 58_000, limit: 100_000 })
  })


  test("shows a persisted post-compaction estimate instead of an empty invalidated state", () => {
    const boundary = part("u3", "compaction")
    Object.assign(boundary, {
      context_estimate: {
        tokens: 21_400,
        basis: "post-compaction",
        providerID: "test",
        modelID: "main",
        calculatedAt: 10,
      },
    })

    expect(
      resolve([user("u1"), assistant("a2", 60_000), user("u3"), assistant("a4", 150_000, { summary: true })], {
        u3: [boundary],
      }),
    ).toEqual({ kind: "estimated", tokens: 21_400, basis: "post-compaction", limit: 100_000 })
  })

  test("shows a persisted post-rebuild estimate after a checkpoint boundary", () => {
    const boundary = part("u3", "checkpoint")
    Object.assign(boundary, {
      context_estimate: {
        tokens: 18_750,
        basis: "post-rebuild",
        providerID: "test",
        modelID: "main",
        calculatedAt: 10,
      },
    })

    expect(
      resolve([user("u1"), assistant("a2", 60_000), user("u3")], {
        u3: [boundary],
      }),
    ).toEqual({ kind: "estimated", tokens: 18_750, basis: "post-rebuild", limit: 100_000 })
  })

  test("pending request estimate takes precedence until provider usage arrives", () => {
    const pending = {
      tokens: 22_100,
      basis: "pending-request" as const,
      providerID: "test",
      modelID: "main",
      calculatedAt: 11,
    }
    expect(
      resolveContextUsage({
        messages: [user("u1"), assistant("a2", 60_000)],
        parts: () => [],
        estimate: pending,
        contextLimit: () => 100_000,
      }),
    ).toEqual({ kind: "estimated", tokens: 22_100, basis: "pending-request", limit: 100_000 })
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

  test("a normal request after the boundary restores a provider reading", () => {
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
    ).toEqual({ kind: "current", tokens: 21_000, limit: 100_000 })
  })

  test("uses the model limit of the last valid main request", () => {
    expect(resolve([user("u1"), assistant("a2", 25_000, { modelID: "other" })])).toEqual({
      kind: "current",
      tokens: 25_000,
      limit: 200_000,
    })
  })
})
