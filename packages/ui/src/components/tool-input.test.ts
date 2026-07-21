import { describe, expect, test } from "bun:test"
import { editNewString, editOldString, toolFileLabel, toolFilePath } from "./tool-input"

describe("tool input compatibility", () => {
  test("prefers current snake_case file paths", () => {
    expect(toolFilePath({ file_path: "/current.ts", filePath: "/legacy.ts" })).toBe("/current.ts")
  })

  test("reads legacy camelCase file paths", () => {
    expect(toolFilePath({ filePath: "/legacy.ts" })).toBe("/legacy.ts")
  })

  test("shows project-relative labels for current and legacy paths", () => {
    expect(
      toolFileLabel(
        { file_path: String.raw`D:\Work\Project\serverSrc\index.ts` },
        String.raw`d:\work\project`,
      ),
    ).toBe("serverSrc/index.ts")
    expect(toolFileLabel({ filePath: "/work/project/src/index.ts" }, "/work/project")).toBe("src/index.ts")
    expect(toolFileLabel({ file_path: "/outside/index.ts" }, "/work/project")).toBe("/outside/index.ts")
  })

  test("reads current and legacy edit strings, including empty old strings", () => {
    expect(editOldString({ old_string: "", oldString: "legacy" })).toBe("")
    expect(editNewString({ new_string: "current", newString: "legacy" })).toBe("current")
    expect(editOldString({ oldString: "legacy" })).toBe("legacy")
    expect(editNewString({ newString: "legacy" })).toBe("legacy")
  })
})
