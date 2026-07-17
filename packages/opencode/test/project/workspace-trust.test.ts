import { describe, expect, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { createWorkspaceTrustStore, WorkspaceTrustLimits } from "../../src/project/workspace-trust"
import { tmpdir } from "../fixture/fixture"

async function expectRejects(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toMatch(pattern)
    return
  }
  throw new Error("Expected promise to reject")
}

describe("workspace trust store", () => {
  test("fails closed when the store is malformed or has the wrong schema", async () => {
    await using tmp = await tmpdir()
    const project = path.join(tmp.path, "project")
    const file = path.join(tmp.path, "state", "trusted-workspaces.json")
    await mkdir(project)
    const store = createWorkspaceTrustStore(file)

    await Bun.write(file, "{")
    expect(await store.checkTrust(project)).toBe("untrusted")

    await Bun.write(file, JSON.stringify({ version: 2, trustedPaths: [project] }))
    expect(await store.checkTrust(project)).toBe("untrusted")

    await Bun.write(file, JSON.stringify({ version: 1, trustedPaths: "not-an-array" }))
    expect(await store.checkTrust(project)).toBe("untrusted")

    await Bun.write(file, JSON.stringify({ version: 1, trustedPaths: ["relative/path"] }))
    expect(await store.checkTrust(project)).toBe("untrusted")
  })

  test("fails closed when the store exceeds its byte limit", async () => {
    await using tmp = await tmpdir()
    const project = path.join(tmp.path, "project")
    const file = path.join(tmp.path, "state", "trusted-workspaces.json")
    await mkdir(project)
    await Bun.write(file, "x".repeat(WorkspaceTrustLimits.fileBytes + 1))

    expect(await createWorkspaceTrustStore(file).checkTrust(project)).toBe("untrusted")
  })

  test("refuses to grow beyond the entry limit without corrupting the existing store", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "state", "trusted-workspaces.json")
    const trustedPaths = Array.from({ length: WorkspaceTrustLimits.entries }, (_, index) =>
      path.join(tmp.path, `trusted-${index}`),
    )
    await Bun.write(file, JSON.stringify({ version: 1, trustedPaths }))
    const store = createWorkspaceTrustStore(file)

    await expectRejects(store.markTrusted(path.join(tmp.path, "overflow")), /entry limit/)
    expect(await store.listTrusted()).toHaveLength(WorkspaceTrustLimits.entries)
  })

  test("persists canonical paths, inherits trust to children, and revokes exactly", async () => {
    await using tmp = await tmpdir()
    const project = path.join(tmp.path, "project")
    const child = path.join(project, "child")
    const file = path.join(tmp.path, "state", "trusted-workspaces.json")
    await mkdir(child, { recursive: true })
    const store = createWorkspaceTrustStore(file)

    await store.markTrusted(project)
    await store.markTrusted(path.join(project, "."))
    expect(await store.listTrusted()).toEqual([project])
    expect(await store.checkTrust(child)).toBe("trusted")

    await store.revokeTrust(project)
    expect(await store.listTrusted()).toEqual([])
    expect(await store.checkTrust(child)).toBe("untrusted")
  })

  test("serializes concurrent updates without losing entries", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "state", "trusted-workspaces.json")
    const projects = Array.from({ length: 8 }, (_, index) => path.join(tmp.path, `project-${index}`))
    await Promise.all(projects.map((project) => mkdir(project)))
    const store = createWorkspaceTrustStore(file)

    await Promise.all(projects.map((project) => store.markTrusted(project)))
    expect(await store.listTrusted()).toEqual(projects.toSorted())
  })
})
