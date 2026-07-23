import { describe, expect, test } from "bun:test"
import { detectActionCycle } from "../../src/session/prompt"

describe("action cycle detection", () => {
  test("detects period one", () => {
    expect(detectActionCycle(["A", "A", "A"])).toBe(1)
  })

  test("detects period two", () => {
    expect(detectActionCycle(["A", "B", "A", "B", "A", "B"])).toBe(2)
  })

  test("detects period three", () => {
    expect(detectActionCycle(["A", "B", "C", "A", "B", "C", "A", "B", "C"])).toBe(3)
  })

  test("does not flag changing results", () => {
    expect(detectActionCycle(["A:1", "A:2", "A:3", "A:4"])).toBeUndefined()
  })
})
