import { describe, expect, test } from "bun:test"
import { renderFailure } from "../../src/tool/invalid"

describe("tool.invalid", () => {
  test("reports unavailable tools without misclassifying them as invalid arguments", () => {
    const result = renderFailure({
      kind: "tool_unavailable",
      tool: "websearch",
      error: "No tool with that ID is runtime-usable in the current request.",
      alternatives: ["duckduckgo_search"],
    })

    expect(result.title).toBe("Tool unavailable")
    expect(result.output).toBe(
      "Tool unavailable: websearch. No tool with that ID is runtime-usable in the current request. Available tools with the same declared capability: duckduckgo_search.",
    )
    expect(result.output).not.toContain("arguments provided")
  })

  test("keeps schema validation failures distinct", () => {
    expect(
      renderFailure({
        kind: "invalid_arguments",
        tool: "read",
        error: 'Required field "file_path" is missing.',
      }),
    ).toEqual({
      title: "Invalid tool arguments",
      output: 'Invalid arguments for tool read: Required field "file_path" is missing.',
    })
  })
})
