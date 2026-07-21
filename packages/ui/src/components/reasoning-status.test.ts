import { describe, expect, test } from "bun:test"
import { reasoningDisplayState } from "./reasoning-status"

describe("reasoning display state", () => {
  test("distinguishes visible and hidden summaries", () => {
    expect(reasoningDisplayState({ showSummaries: true, hasSummary: true, reasoningTokens: 10 })).toBe("visible")
    expect(reasoningDisplayState({ showSummaries: false, hasSummary: true, reasoningTokens: 10 })).toBe("hidden")
  })

  test("reports reasoning without a provider summary", () => {
    expect(reasoningDisplayState({ showSummaries: false, hasSummary: false, reasoningTokens: 10 })).toBe(
      "unavailable",
    )
  })

  test("does not claim reasoning when no evidence exists", () => {
    expect(reasoningDisplayState({ showSummaries: false, hasSummary: false, reasoningTokens: 0 })).toBe("none")
  })
})
