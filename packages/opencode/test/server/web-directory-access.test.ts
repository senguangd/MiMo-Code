import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import type { DirectoryAccessPolicy } from "../../src/server/directory-access"
import { tmpdir } from "../fixture/fixture"

const previous = {
  password: Flag.MIMOCODE_SERVER_PASSWORD,
  experimentalHttpApi: Flag.MIMOCODE_EXPERIMENTAL_HTTPAPI,
  workspaceID: Flag.MIMOCODE_WORKSPACE_ID,
}

beforeAll(() => {
  ;(Flag as any).MIMOCODE_SERVER_PASSWORD = undefined
  ;(Flag as any).MIMOCODE_EXPERIMENTAL_HTTPAPI = false
  ;(Flag as any).MIMOCODE_WORKSPACE_ID = undefined
})

afterAll(async () => {
  await Instance.disposeAll()
  ;(Flag as any).MIMOCODE_SERVER_PASSWORD = previous.password
  ;(Flag as any).MIMOCODE_EXPERIMENTAL_HTTPAPI = previous.experimentalHttpApi
  ;(Flag as any).MIMOCODE_WORKSPACE_ID = previous.workspaceID
})

async function withServer(directoryAccess: DirectoryAccessPolicy | undefined, fn: (url: URL) => Promise<void>) {
  const server = await Server.listen({
    port: 0,
    hostname: "127.0.0.1",
    directoryAccess,
  })
  try {
    await fn(server.url)
  } finally {
    await server.stop(true)
    await Instance.disposeAll()
    await Bun.sleep(300)
  }
}

function url(base: URL, pathname: string, query: Record<string, string>) {
  const target = new URL(pathname, base)
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value)
  return target
}

describe("web directory access", () => {
  test("host policy lists and opens directories outside the server cwd", async () => {
    await using tmp = await tmpdir({
      outsideGit: true,
      init: async (directory) => {
        await Bun.write(path.join(directory, "child", "file.txt"), "content")
      },
    })

    await withServer("host", async (base) => {
      const browse = await fetch(url(base, "/global/directory", { path: path.dirname(tmp.path) }))
      expect(browse.status).toBe(200)
      expect(await browse.json()).toContainEqual({
        name: path.basename(tmp.path),
        absolute: tmp.path,
      })

      const root = await fetch(url(base, "/global/directory", { path: path.parse(tmp.path).root }))
      expect(root.status).toBe(200)
      expect(Array.isArray(await root.json())).toBe(true)

      const files = await fetch(url(base, "/file", { directory: tmp.path, path: "" }))
      expect(files.status).toBe(200)
      expect(await files.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "child",
            type: "directory",
          }),
        ]),
      )

      const sessions = await fetch(url(base, "/session", { directory: tmp.path, roots: "true" }))
      expect(sessions.status).toBe(200)

      const traversal = await fetch(url(base, "/file", { directory: tmp.path, path: ".." }))
      expect(traversal.status).not.toBe(200)
      expect(await traversal.text()).toContain("Access denied: path escapes project directory")
    })
  }, 30_000)

  test("default server policy remains cwd-restricted without a password", async () => {
    await using tmp = await tmpdir({ outsideGit: true })

    await withServer(undefined, async (base) => {
      const browse = await fetch(url(base, "/global/directory", { path: path.dirname(tmp.path) }))
      expect(browse.status).toBe(403)
      expect(await browse.json()).toEqual({
        error: "Access denied: directory must be within the server's working directory",
      })

      const files = await fetch(url(base, "/file", { directory: tmp.path, path: "" }))
      expect(files.status).toBe(403)
    })
  }, 30_000)

  test("host policy is also applied to the experimental HTTP API", async () => {
    await using tmp = await tmpdir({ outsideGit: true })
    ;(Flag as any).MIMOCODE_EXPERIMENTAL_HTTPAPI = true
    try {
      await withServer("host", async (base) => {
        const response = await fetch(url(base, "/project/current", { directory: tmp.path }))
        expect(response.status).toBe(200)
        expect(await response.json()).toHaveProperty("id")
      })
    } finally {
      ;(Flag as any).MIMOCODE_EXPERIMENTAL_HTTPAPI = false
    }
  }, 30_000)
})
