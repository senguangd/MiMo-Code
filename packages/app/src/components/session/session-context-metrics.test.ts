import { describe, expect, test } from "bun:test"
import type { Message } from "@mimo-ai/sdk/v2/client"
import { getSessionContextMetrics } from "./session-context-metrics"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number; total?: number; context?: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
) => {
  const message = {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      total: tokens.total,
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time: { created: 1 },
  }
  if (tokens.context !== undefined) (message.tokens as unknown as { context: number }).context = tokens.context
  return message as unknown as Message
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

describe("getSessionContextMetrics", () => {
  test("computes totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0.5),
      assistant("a2", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1000 },
          },
        },
      },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.totalCost).toBe(1.75)
    expect(metrics.context?.message?.id).toBe("a2")
    expect(metrics.context?.total).toBe(500)
    expect(metrics.context?.usage).toBe(50)
    expect(metrics.context?.providerLabel).toBe("OpenAI")
    expect(metrics.context?.modelLabel).toBe("GPT-4.1")
  })

  test("uses provider total and ignores a legacy estimated context", () => {
    const messages = [
      assistant(
        "a1",
        { input: 300, output: 100, reasoning: 50, read: 25, write: 25, total: 520, context: 420 },
        1,
      ),
    ]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.total).toBe(520)
    expect(metrics.context?.usage).toBe(52)
  })

  test("uses a pending request estimate before measured usage is available", () => {
    const messages = [assistant("a1", { input: 300, output: 100, reasoning: 0, read: 0, write: 0 }, 1)]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]
    const metrics = getSessionContextMetrics(messages, providers, {
      status: {
        type: "busy",
        contextEstimate: {
          tokens: 275,
          basis: "pending-request",
          providerID: "openai",
          modelID: "gpt-4.1",
          calculatedAt: 10,
        },
      },
    })

    expect(metrics.context).toMatchObject({
      kind: "estimated",
      basis: "pending-request",
      total: 275,
      usage: 28,
      input: undefined,
      output: undefined,
    })
    expect(metrics.context?.message).toBeUndefined()
  })

  test("uses a persisted compaction estimate instead of stale pre-compaction usage", () => {
    const summary = assistant("a3", { input: 900, output: 50, reasoning: 0, read: 0, write: 0 }, 0)
    if (summary.role === "assistant") summary.summary = true
    const messages = [
      assistant("a1", { input: 800, output: 100, reasoning: 0, read: 0, write: 0 }, 1),
      user("u2"),
      summary,
    ]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]
    const metrics = getSessionContextMetrics(messages, providers, {
      parts: {
        u2: [
          {
            id: "p2",
            sessionID: "s1",
            messageID: "u2",
            type: "compaction",
            auto: false,
            context_estimate: {
              tokens: 220,
              basis: "post-compaction",
              providerID: "openai",
              modelID: "gpt-4.1",
              calculatedAt: 11,
            },
          },
        ],
      },
    })

    expect(metrics.context).toMatchObject({
      kind: "estimated",
      basis: "post-compaction",
      total: 220,
      usage: 22,
    })
  })

  test("uses a persisted checkpoint estimate after a rebuild boundary", () => {
    const messages = [
      assistant("a1", { input: 800, output: 100, reasoning: 0, read: 0, write: 0 }, 1),
      user("u2"),
    ]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]
    const metrics = getSessionContextMetrics(messages, providers, {
      parts: {
        u2: [
          {
            id: "p2",
            sessionID: "s1",
            messageID: "u2",
            type: "checkpoint",
            checkpointDir: "",
            checkpointNumber: 0,
            coveredUpTo: "u1",
            context_estimate: {
              tokens: 180,
              basis: "post-rebuild",
              providerID: "openai",
              modelID: "gpt-4.1",
              calculatedAt: 12,
            },
          },
        ],
      },
    })

    expect(metrics.context).toMatchObject({
      kind: "estimated",
      basis: "post-rebuild",
      total: 180,
      usage: 18,
    })
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.providerLabel).toBe("p-1")
    expect(metrics.context?.modelLabel).toBe("m-1")
    expect(metrics.context?.limit).toBeUndefined()
    expect(metrics.context?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContextMetrics(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContextMetrics(messages, providers)

    expect(one.context?.message?.id).toBe("a1")
    expect(two.context?.message?.id).toBe("a2")
    expect(two.totalCost).toBe(1)
  })

  test("returns empty metrics when inputs are undefined", () => {
    const metrics = getSessionContextMetrics(undefined, undefined)

    expect(metrics.totalCost).toBe(0)
    expect(metrics.context).toBeUndefined()
  })
})
