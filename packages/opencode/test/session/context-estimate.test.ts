import { describe, expect, test } from "bun:test"
import { jsonSchema, tool } from "ai"
import { estimateContext, shouldPropagateEstimateCause } from "../../src/session/context-estimate"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Cause } from "effect"

const base = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
  basis: "pending-request" as const,
  system: ["system prompt"],
  messages: [{ role: "user" as const, content: "hello" }],
}

describe("context estimate", () => {
  test("includes system, messages, and complete tool schemas", async () => {
    const withoutTools = await estimateContext({ ...base, tools: {} })
    const withTools = await estimateContext({
      ...base,
      tools: {
        search: tool({
          description: "Search a repository",
          inputSchema: jsonSchema({
            type: "object",
            properties: { query: { type: "string", description: "A long search query" } },
            required: ["query"],
          }),
        }),
      },
    })

    expect(withTools.tokens).toBeGreaterThan(withoutTools.tokens)
    expect(withTools.tokens - withoutTools.tokens).toBeGreaterThan(20)
  })

  test("propagates interruption even when combined with another failure", () => {
    const mixed = Cause.combine(Cause.interrupt(1), Cause.fail("dependency failed"))

    expect(shouldPropagateEstimateCause(Cause.interrupt(1))).toBe(true)
    expect(shouldPropagateEstimateCause(mixed)).toBe(true)
    expect(shouldPropagateEstimateCause(Cause.fail("dependency failed"))).toBe(false)
  })

  test("is deterministic and marks the estimate basis", async () => {
    const first = await estimateContext({ ...base, tools: {} })
    const second = await estimateContext({ ...base, tools: {} })

    expect(first.tokens).toBe(second.tokens)
    expect(first.basis).toBe("pending-request")
    expect(first.providerID).toBe(ProviderID.make("test"))
    expect(first.modelID).toBe(ModelID.make("test-model"))
  })
})
