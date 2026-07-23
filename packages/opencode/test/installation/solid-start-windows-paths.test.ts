import { describe, expect, test } from "bun:test"
import { patchSolidStartConfig } from "../../../../script/fix-solid-start-windows-paths"

const runtimeCalls = [
  'const a = `import x from "${normalize(fileURLToPath(new URL("../server/server-runtime", import.meta.url)))}"`',
  "const b = `import x from '${normalize(fileURLToPath(new URL(\"../server/server-fns-runtime\", import.meta.url)))}'`",
  "const c = `import x from '${normalize(fileURLToPath(new URL(\"../server/server-fns-runtime\", import.meta.url)))}'`",
].join("\n")

const appEntryDefine = '"import.meta.env.START_APP_ENTRY": `"${appEntryPath}"`,'

function publishedConfig() {
  return [
    'import { extname, isAbsolute, join, normalize } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'import solid from "vite-plugin-solid";',
    appEntryDefine,
    runtimeCalls,
  ].join("\n")
}

describe("SolidStart Windows runtime path patch", () => {
  test("patches published import IDs and the absolute app-entry define", () => {
    const result = patchSolidStartConfig(publishedConfig())

    expect(result.changed).toBe(true)
    expect(result.content).toContain('import { extname, isAbsolute, join } from "node:path";')
    expect(result.content).toContain('import { normalizePath } from "vite";')
    expect(result.content).not.toContain("${normalize(")
    expect(result.content.split("${normalizePath(").length - 1).toBe(3)
    expect(result.content).toContain('"import.meta.env.START_APP_ENTRY": JSON.stringify(appEntryPath),')
    expect(result.content).not.toContain(appEntryDefine)
  })

  test("patches the TypeScript source without duplicating the Vite import", () => {
    const source = [
      'import { extname, isAbsolute, join, normalize } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'import { type PluginOption } from "vite";',
      appEntryDefine,
      runtimeCalls,
    ].join("\n")

    const result = patchSolidStartConfig(source)
    expect(result.content).toContain('import { normalizePath, type PluginOption } from "vite";')
    expect(result.content.match(/from "vite"/g)).toHaveLength(1)
  })

  test("is idempotent after both dependency defects are patched", () => {
    const first = patchSolidStartConfig(publishedConfig())
    const second = patchSolidStartConfig(first.content)

    expect(second).toEqual({ content: first.content, changed: false })
  })

  test("repairs the app-entry define when runtime imports were patched earlier", () => {
    const runtimeOnly = patchSolidStartConfig(publishedConfig()).content.replace(
      '"import.meta.env.START_APP_ENTRY": JSON.stringify(appEntryPath),',
      appEntryDefine,
    )
    const result = patchSolidStartConfig(runtimeOnly)

    expect(result.changed).toBe(true)
    expect(result.content).toContain('"import.meta.env.START_APP_ENTRY": JSON.stringify(appEntryPath),')
  })

  test("fails closed when an upstream release changes the expected shape", () => {
    expect(() => patchSolidStartConfig('import { normalize } from "node:path";')).toThrow(
      "Unsupported @solidjs/start config shape",
    )
  })
})
