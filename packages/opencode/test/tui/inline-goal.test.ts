import { describe, expect, test } from "bun:test"
import { parseInlineGoalCommand } from "../../src/cli/cmd/tui/component/prompt/inline-goal"

describe("parseInlineGoalCommand", () => {
  test("returns undefined when /goal is absent", () => {
    expect(parseInlineGoalCommand("fix the bug")).toBeUndefined()
  })

  test("detects /goal at start of input", () => {
    expect(parseInlineGoalCommand("/goal make tests pass")).toEqual({
      command: "goal",
      arguments: "make tests pass",
    })
  })

  test("detects inline /goal and joins both sides into the condition", () => {
    expect(parseInlineGoalCommand("fix the bug /goal make tests pass")).toEqual({
      command: "goal",
      arguments: "fix the bug make tests pass",
    })
  })

  test("detects /goal at end of input", () => {
    expect(parseInlineGoalCommand("fix the bug /goal")).toEqual({
      command: "goal",
      arguments: "fix the bug",
    })
  })

  test("does not match /goals (trailing word chars)", () => {
    expect(parseInlineGoalCommand("/goals for next quarter")).toBeUndefined()
  })

  test("does not match /goal buried in a URL/path (no preceding whitespace)", () => {
    expect(parseInlineGoalCommand("see https://example.com/goal/list")).toBeUndefined()
    expect(parseInlineGoalCommand("cat /home/user/goals.md")).toBeUndefined()
  })

  test("does not match /goal immediately followed by punctuation", () => {
    expect(parseInlineGoalCommand("how do I use /goal?")).toBeUndefined()
    expect(parseInlineGoalCommand("see /goal.")).toBeUndefined()
  })

  // Inherent ambiguity: when `/goal` is a standalone token mid-sentence, token
  // matching cannot tell "set a goal" apart from "mentioning /goal". This is the
  // residual cost of inline support; substring matches (/goals, URLs, paths) are
  // already rejected above.
  test("treats a standalone /goal token mid-sentence as inline", () => {
    expect(parseInlineGoalCommand("what does /goal do here")).toEqual({
      command: "goal",
      arguments: "what does do here",
    })
  })

  test("tab-separated inline /goal is detected", () => {
    expect(parseInlineGoalCommand("fix the bug\t/goal\tmake tests pass")).toEqual({
      command: "goal",
      arguments: "fix the bug make tests pass",
    })
  })
})
