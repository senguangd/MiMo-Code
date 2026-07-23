import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolvePlaygroundCssFile } from "./playground-css-plugin"

describe("playground CSS file boundary", () => {
  test("accepts component stylesheet basenames", () => {
    const file = resolvePlaygroundCssFile("session-turn.css")
    expect(file).toBeDefined()
    expect(path.basename(file!)).toBe("session-turn.css")
  })

  test("rejects sibling, nested, and absolute paths", () => {
    expect(resolvePlaygroundCssFile(path.join("..", "components-copy", "session-turn.css"))).toBeUndefined()
    expect(resolvePlaygroundCssFile(path.join("nested", "session-turn.css"))).toBeUndefined()
    expect(resolvePlaygroundCssFile(path.resolve("session-turn.css"))).toBeUndefined()
  })
})