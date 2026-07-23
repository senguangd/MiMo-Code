#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const OLD_NODE_PATH_IMPORT = 'import { extname, isAbsolute, join, normalize } from "node:path";'
const NEW_NODE_PATH_IMPORT = 'import { extname, isAbsolute, join } from "node:path";'
const SOURCE_VITE_IMPORT = 'import { type PluginOption } from "vite";'
const PATCHED_SOURCE_VITE_IMPORT = 'import { normalizePath, type PluginOption } from "vite";'
const DIST_VITE_IMPORT = 'import { normalizePath } from "vite";'
const FILE_URL_IMPORT = 'import { fileURLToPath } from "node:url";'
const OLD_RUNTIME_CALL = "${normalize("
const NEW_RUNTIME_CALL = "${normalizePath("
const EXPECTED_RUNTIME_CALLS = 3
const OLD_APP_ENTRY_DEFINE = '"import.meta.env.START_APP_ENTRY": `"${appEntryPath}"`,'
const NEW_APP_ENTRY_DEFINE = '"import.meta.env.START_APP_ENTRY": JSON.stringify(appEntryPath),'

function occurrences(source: string, value: string) {
  return source.split(value).length - 1
}

function patchRuntimeImports(source: string) {
  const oldCalls = occurrences(source, OLD_RUNTIME_CALL)
  const newCalls = occurrences(source, NEW_RUNTIME_CALL)

  if (oldCalls === 0 && newCalls === EXPECTED_RUNTIME_CALLS) {
    if (source.includes(OLD_NODE_PATH_IMPORT)) {
      throw new Error("@solidjs/start path patch is partial: node:path still imports normalize")
    }
    if (!source.includes("normalizePath")) {
      throw new Error("@solidjs/start path patch is partial: normalizePath import is missing")
    }
    return { content: source, changed: false }
  }

  if (oldCalls !== EXPECTED_RUNTIME_CALLS || newCalls !== 0) {
    throw new Error(
      `Unsupported @solidjs/start config shape: expected ${EXPECTED_RUNTIME_CALLS} normalize runtime imports, found old=${oldCalls} patched=${newCalls}`,
    )
  }
  if (!source.includes(OLD_NODE_PATH_IMPORT)) {
    throw new Error("Unsupported @solidjs/start config shape: node:path normalize import not found")
  }

  let content = source.replace(OLD_NODE_PATH_IMPORT, NEW_NODE_PATH_IMPORT)
  if (content.includes(SOURCE_VITE_IMPORT)) {
    content = content.replace(SOURCE_VITE_IMPORT, PATCHED_SOURCE_VITE_IMPORT)
  } else if (!content.includes(DIST_VITE_IMPORT)) {
    if (!content.includes(FILE_URL_IMPORT)) {
      throw new Error("Unsupported @solidjs/start config shape: node:url import not found")
    }
    content = content.replace(FILE_URL_IMPORT, `${FILE_URL_IMPORT}\n${DIST_VITE_IMPORT}`)
  }
  content = content.replaceAll(OLD_RUNTIME_CALL, NEW_RUNTIME_CALL)

  if (occurrences(content, NEW_RUNTIME_CALL) !== EXPECTED_RUNTIME_CALLS) {
    throw new Error("Failed to normalize every @solidjs/start runtime import path")
  }
  return { content, changed: true }
}

function patchAppEntryDefine(source: string) {
  const oldDefines = occurrences(source, OLD_APP_ENTRY_DEFINE)
  const newDefines = occurrences(source, NEW_APP_ENTRY_DEFINE)
  if (oldDefines === 0 && newDefines === 1) return { content: source, changed: false }
  if (oldDefines !== 1 || newDefines !== 0) {
    throw new Error(
      `Unsupported @solidjs/start app-entry define shape: expected one quoted template, found old=${oldDefines} patched=${newDefines}`,
    )
  }
  return { content: source.replace(OLD_APP_ENTRY_DEFINE, NEW_APP_ENTRY_DEFINE), changed: true }
}

export function patchSolidStartConfig(source: string) {
  const runtime = patchRuntimeImports(source)
  const appEntry = patchAppEntryDefine(runtime.content)
  return { content: appEntry.content, changed: runtime.changed || appEntry.changed }
}

async function atomicWrite(file: string, content: string) {
  const stat = await fs.stat(file)
  const temp = `${file}.mimocode-${process.pid}.tmp`
  await fs.writeFile(temp, content, { mode: stat.mode })
  try {
    await fs.rename(temp, file)
  } catch (error: any) {
    if (process.platform !== "win32" || !["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error
    await fs.rm(file, { force: true })
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
  }
}

export async function fixSolidStartWindowsPaths(repoRoot: string) {
  if (process.platform !== "win32") return []

  const packageRoots = [
    path.join(repoRoot, "packages", "enterprise", "node_modules", "@solidjs", "start"),
    path.join(repoRoot, "packages", "console", "app", "node_modules", "@solidjs", "start"),
  ]
  const resolved = new Set<string>()
  for (const root of packageRoots) {
    const real = await fs.realpath(root).catch(() => undefined)
    if (real) resolved.add(real)
  }
  if (resolved.size === 0) {
    throw new Error("@solidjs/start is not installed for Enterprise or Console")
  }

  const changed: string[] = []
  for (const root of resolved) {
    for (const relative of ["dist/config/index.js", "src/config/index.ts"]) {
      const file = path.join(root, relative)
      const source = await fs.readFile(file, "utf8").catch((error: any) => {
        if (error?.code === "ENOENT") return undefined
        throw error
      })
      if (source === undefined) continue
      const result = patchSolidStartConfig(source)
      if (!result.changed) continue
      await atomicWrite(file, result.content)
      changed.push(file)
    }
  }
  return changed
}

if (import.meta.main) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const changed = await fixSolidStartWindowsPaths(repoRoot)
  if (changed.length) {
    console.log(`fixed @solidjs/start Windows import paths in ${changed.length} file${changed.length === 1 ? "" : "s"}`)
  }
}
