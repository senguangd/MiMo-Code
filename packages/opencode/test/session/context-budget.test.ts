import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider"
import { contextBudget, isOverflow, rebuildTarget, usable } from "../../src/session/overflow"

function model(input: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: input,
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai-compatible" },
    options: {},
  } as Provider.Model
}

const cfg = { compaction: {} } as any

describe("context budget", () => {
  test("uses one physical input limit and keeps rebuild headroom separate", () => {
    const value = contextBudget({ cfg, model: model({ context: 128_000, output: 32_000 }) })
    expect(value).toEqual({
      context: 128_000,
      output: 32_000,
      input: 96_000,
      target: 76_000,
    })
    expect(usable({ cfg, model: model({ context: 128_000, output: 32_000 }) })).toBe(96_000)
    expect(rebuildTarget({ cfg, model: model({ context: 128_000, output: 32_000 }) })).toBe(76_000)
  })

  test("honors the smaller explicit input limit", () => {
    expect(
      contextBudget({
        cfg,
        model: model({ context: 400_000, input: 250_000, output: 128_000 }),
      }).input,
    ).toBe(250_000)
  })

  test("uses the actual per-call output reservation", () => {
    expect(
      contextBudget({
        cfg,
        model: model({ context: 128_000, output: 32_000 }),
        output: 8_000,
      }).input,
    ).toBe(120_000)
  })

  test("legacy estimated context cannot override provider-reported usage", () => {
    const mdl = model({ context: 100_000, output: 20_000 })
    const tokens = {
      total: 95_000,
      context: 12_000,
      input: 90_000,
      output: 3_000,
      reasoning: 2_000,
      cache: { read: 0, write: 0 },
    } as any

    expect(isOverflow({ cfg, model: mdl, tokens })).toBe(true)
  })

  test("overflow fallback includes reasoning when provider total is unavailable", () => {
    const mdl = model({ context: 100_000, output: 20_000 })
    expect(
      isOverflow({
        cfg,
        model: mdl,
        tokens: {
          total: 0,
          input: 70_000,
          output: 0,
          reasoning: 15_000,
          cache: { read: 0, write: 0 },
        },
      }),
    ).toBe(true)
    expect(
      isOverflow({
        cfg,
        model: mdl,
        tokens: {
          input: 70_000,
          output: 0,
          reasoning: 15_000,
          cache: { read: 0, write: 0 },
        },
      }),
    ).toBe(true)
  })
})
