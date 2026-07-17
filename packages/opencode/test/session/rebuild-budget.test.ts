import { describe, expect, test } from "bun:test"
import { fitTokenBudget } from "../../src/session/checkpoint"
import { Token } from "../../src/util"

describe("rebuild context budget", () => {
  test("keeps output within the total token budget while preserving both ends", () => {
    const text = "HEAD\\n" + "x".repeat(20_000) + "\\nTAIL"
    const fitted = fitTokenBudget(text, 1_000)
    expect(Token.estimate(fitted)).toBeLessThanOrEqual(1_000)
    expect(fitted).toStartWith("HEAD")
    expect(fitted).toEndWith("TAIL")
    expect(fitted).toContain("additional memory omitted")
  })

  test("does not modify content already inside the budget", () => {
    expect(fitTokenBudget("small", 100)).toBe("small")
  })
})
