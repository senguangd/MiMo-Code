import { describe, expect, test } from "bun:test"
import path from "node:path"
import { normalizePermissionPath } from "../../../../src/cli/cmd/tui/routes/session/permission-path"

describe("permission path display", () => {
  const root = path.join(path.parse(process.cwd()).root, "repo")
  const home = path.join(path.parse(process.cwd()).root, "Users", "Alice")

  test("keeps dot-prefixed child directories relative", () => {
    expect(normalizePermissionPath(path.join(root, "..cache", "file.ts"), root, home)).toBe(
      path.join("..cache", "file.ts"),
    )
  })

  test("keeps outside paths absolute and shortens true home descendants", () => {
    const sibling = path.join(`${root}-copy`, "file.ts")
    expect(normalizePermissionPath(sibling, root, home)).toBe(sibling)
    expect(normalizePermissionPath(path.join(home, ".config", "file.ts"), root, home)).toBe(
      path.join("~", ".config", "file.ts"),
    )
  })
})