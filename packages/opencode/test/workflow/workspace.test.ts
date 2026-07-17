import { describe, expect, test } from "bun:test"
import { resolveInWorkspace, makeFileHooks, WorkspaceLimits } from "../../src/workflow/workspace"
import { tmpdir } from "os"
import path from "path"
import { mkdtempSync, symlinkSync, writeFileSync } from "fs"

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function expectRejects(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toMatch(pattern)
    return
  }
  throw new Error("Expected promise to reject")
}

describe("resolveInWorkspace", () => {
  test("resolves a relative path inside the root", () => {
    expect(resolveInWorkspace("/ws", "a/b.txt")).toBe(path.resolve("/ws", "a/b.txt"))
  })

  test("rejects a parent-traversal escape", () => {
    expect(() => resolveInWorkspace("/ws", "../escape")).toThrow(/workspace/)
  })

  test("rejects an absolute path that escapes the root", () => {
    expect(() => resolveInWorkspace("/ws", "/etc/passwd")).toThrow(/workspace/)
  })

  test("allows the root itself and nested dirs", () => {
    expect(resolveInWorkspace("/ws", ".")).toBe(path.resolve("/ws"))
    expect(resolveInWorkspace("/ws", "deep/nested/x")).toBe(path.resolve("/ws", "deep/nested/x"))
  })
})

describe("makeFileHooks read/write/exists", () => {
  test("writeFile then readFile round-trips inside the workspace", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    await hooks.writeFile("out/data.tsv", "a\tb\n")
    expect(await hooks.readFile("out/data.tsv")).toBe("a\tb\n")
  })

  test("readFile of a missing file returns null (not throw)", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    expect(await hooks.readFile("nope.txt")).toBe(null)
  })

  test("exists reflects presence", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    expect(await hooks.exists("x")).toBe(false)
    await hooks.writeFile("x", "1")
    expect(await hooks.exists("x")).toBe(true)
  })

  test("writeFile escaping the workspace throws", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    await expectRejects(hooks.writeFile("../escape", "x"), /workspace/)
  })

  test("rejects reads and writes through an escaping symlink or junction", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const outside = mkdtempSync(`${tmpdir()}/wf-outside-`)
    writeFileSync(path.join(outside, "secret.txt"), "secret")
    try {
      symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      if (errorCode(error) === "EPERM") return
      throw error
    }

    const hooks = makeFileHooks(root)
    await expectRejects(hooks.readFile("escape/secret.txt"), /escapes/)
    await expectRejects(hooks.writeFile("escape/new.txt", "x"), /escapes/)
    await expectRejects(hooks.exists("escape/secret.txt"), /escapes/)
    expect(await hooks.glob("escape/**")).toEqual([])
  })

  test("enforces host-side read and write byte limits", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    const oversized = "x".repeat(WorkspaceLimits.fileBytes + 1)

    await expectRejects(hooks.writeFile("too-large.txt", oversized), /write limit/)
    writeFileSync(path.join(root, "too-large.txt"), oversized)
    await expectRejects(hooks.readFile("too-large.txt"), /read limit/)
  })

  test("rejects path inputs above the boundary limit", async () => {
    const hooks = makeFileHooks(mkdtempSync(`${tmpdir()}/wf-ws-`))
    await expectRejects(hooks.exists("x".repeat(WorkspaceLimits.pathBytes + 1)), /path.*limit/)
  })

  test("rejects null bytes before filesystem access", async () => {
    const hooks = makeFileHooks(mkdtempSync(`${tmpdir()}/wf-ws-`))
    await expectRejects(hooks.readFile("bad\0path"), /null byte/)
    await expectRejects(hooks.writeFile("bad\0path", "x"), /null byte/)
    await expectRejects(hooks.glob("bad\0pattern"), /null byte/)
  })
})

describe("makeFileHooks glob", () => {
  test("returns workspace-relative matches, lexicographically sorted", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    await hooks.writeFile("src/c.zig", "")
    await hooks.writeFile("src/a.zig", "")
    await hooks.writeFile("src/b.zig", "")
    const r = await hooks.glob("src/*.zig")
    expect(r).toEqual([path.join("src", "a.zig"), path.join("src", "b.zig"), path.join("src", "c.zig")]) // sorted, relative
  })

  test("empty match set returns []", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    expect(await hooks.glob("nothing/*.x")).toEqual([])
  })

  test("glob cannot escape the workspace via .. or absolute patterns", async () => {
    const root = mkdtempSync(`${tmpdir()}/wf-ws-`)
    const hooks = makeFileHooks(root)
    // Create a sibling file OUTSIDE the workspace root.
    const outside = mkdtempSync(`${tmpdir()}/wf-outside-`)
    const { writeFileSync } = await import("fs")
    const pathMod = await import("path")
    writeFileSync(pathMod.join(outside, "secret.txt"), "x")
    // A file INSIDE the workspace (the legitimate match).
    await hooks.writeFile("inside.txt", "y")
    // Parent-traversal and absolute patterns fail before the glob engine can scan outside the root.
    await expectRejects(hooks.glob("../wf-outside-*/*"), /escapes/)
    await expectRejects(hooks.glob(`${outside}/*`), /escapes/)
    await expectRejects(hooks.glob("../*"), /escapes/)
    // A normal in-workspace glob still works.
    expect(await hooks.glob("*.txt")).toEqual(["inside.txt"])
  })
})
