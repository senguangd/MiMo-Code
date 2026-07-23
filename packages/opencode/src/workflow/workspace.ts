import path from "path"
import { lstat, open, realpath } from "fs/promises"
import { Filesystem } from "@/util"
import { Glob } from "@adp-ai/shared/util/glob"

export const WorkspaceLimits = {
  pathBytes: 4 * 1024,
  fileBytes: 16 * 1024 * 1024,
  globResults: 10_000,
} as const

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function isMissing(error: unknown) {
  return errorCode(error) === "ENOENT"
}

function boundedString(input: unknown, name: string) {
  const value = String(input)
  if (value.includes("\0")) throw new Error(`${name} contains a null byte`)
  if (Buffer.byteLength(value) > WorkspaceLimits.pathBytes) {
    throw new Error(`${name} exceeds the ${WorkspaceLimits.pathBytes}-byte workspace limit`)
  }
  return value
}

function assertRelativeGlob(pattern: string) {
  const segments = pattern.replace(/[{}()[\]|,]/g, "/").split(/[\\/]+/)
  if (path.isAbsolute(pattern) || path.win32.isAbsolute(pattern) || segments.includes("..")) {
    throw new Error(`workspace glob escapes the workspace root: ${JSON.stringify(pattern)}`)
  }
}

async function readTextBounded(target: string, input: string) {
  const file = await open(target, "r")
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error(`workspace read target is not a regular file: ${JSON.stringify(input)}`)
    if (info.size > WorkspaceLimits.fileBytes) {
      throw new Error(
        `workspace file exceeds the ${WorkspaceLimits.fileBytes}-byte read limit: ${JSON.stringify(input)}`,
      )
    }

    const chunks: Buffer[] = []
    let total = 0
    while (total <= WorkspaceLimits.fileBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, WorkspaceLimits.fileBytes + 1 - total))
      const { bytesRead } = await file.read(buffer, 0, buffer.length)
      if (!bytesRead) break
      chunks.push(buffer.subarray(0, bytesRead))
      total += bytesRead
    }
    if (total > WorkspaceLimits.fileBytes) {
      throw new Error(
        `workspace file exceeds the ${WorkspaceLimits.fileBytes}-byte read limit: ${JSON.stringify(input)}`,
      )
    }
    return Buffer.concat(chunks, total).toString("utf8")
  } finally {
    await file.close()
  }
}

function assertContained(root: string, target: string, input: string) {
  if (Filesystem.contains(root, target)) return
  throw new Error(`workspace path escapes the workspace root: ${JSON.stringify(input)}`)
}

async function canonicalExisting(
  root: string,
  target: string,
  input: string,
  rejectEscape = true,
): Promise<string | undefined> {
  const resolved = await realpath(target).catch((error) => {
    if (isMissing(error)) return undefined
    throw error
  })
  if (!resolved) return undefined
  const canonical = Filesystem.normalizePath(resolved)
  if (Filesystem.contains(root, canonical)) return canonical
  if (!rejectEscape) return undefined
  assertContained(root, canonical, input)
  return undefined
}

async function safeWriteTarget(root: string, target: string, input: string) {
  const leaf = await lstat(target).catch((error) => {
    if (isMissing(error)) return undefined
    throw error
  })
  if (leaf?.isSymbolicLink()) {
    throw new Error(`workspace write target must not be a symbolic link: ${JSON.stringify(input)}`)
  }
  if (leaf) {
    const canonical = await canonicalExisting(root, target, input)
    if (canonical) return canonical
    throw new Error(`workspace write target disappeared before validation: ${JSON.stringify(input)}`)
  }

  let ancestor = path.dirname(target)
  while (true) {
    const canonical = await canonicalExisting(root, ancestor, input)
    if (canonical) return path.join(canonical, path.relative(ancestor, target))
    const parent = path.dirname(ancestor)
    if (parent === ancestor) {
      throw new Error(`workspace path has no existing in-root ancestor: ${JSON.stringify(input)}`)
    }
    ancestor = parent
  }
}

// Resolve a guest-supplied relative path against the workspace root. This is the
// lexical half of the boundary; makeFileHooks additionally validates real paths
// before host I/O so in-workspace symlinks and junctions cannot escape it.
export function resolveInWorkspace(root: string, rel: string): string {
  const base = path.resolve(root)
  const abs = path.resolve(base, rel)
  assertContained(base, abs, rel)
  return abs
}

// Build the workspace-jailed file host functions exposed to workflow guests.
// The checks are deliberately repeated at the I/O boundary: QuickJS' heap cap
// does not constrain host filesystem reads/writes. A portable path check cannot
// eliminate a malicious same-user symlink swap between validation and I/O, but
// canonical preflight plus a post-write assertion fails closed for stable paths
// on every supported OS without weakening normal workspace behavior.
export function makeFileHooks(root: string) {
  const canonicalRoot = Filesystem.resolve(root)

  return {
    async readFile(rel: unknown): Promise<string | null> {
      const input = boundedString(rel, "workspace path")
      const target = await canonicalExisting(canonicalRoot, resolveInWorkspace(canonicalRoot, input), input)
      if (!target) return null
      return readTextBounded(target, input)
    },
    async writeFile(rel: unknown, content: unknown): Promise<void> {
      const input = boundedString(rel, "workspace path")
      const value = String(content)
      if (Buffer.byteLength(value) > WorkspaceLimits.fileBytes) {
        throw new Error(
          `workspace content exceeds the ${WorkspaceLimits.fileBytes}-byte write limit: ${JSON.stringify(input)}`,
        )
      }
      const target = await safeWriteTarget(canonicalRoot, resolveInWorkspace(canonicalRoot, input), input)
      await Filesystem.write(target, value)
      if (!(await canonicalExisting(canonicalRoot, target, input))) {
        throw new Error(`workspace write target disappeared before validation: ${JSON.stringify(input)}`)
      }
    },
    async exists(rel: unknown): Promise<boolean> {
      const input = boundedString(rel, "workspace path")
      return Boolean(await canonicalExisting(canonicalRoot, resolveInWorkspace(canonicalRoot, input), input))
    },
    async glob(pattern: unknown): Promise<string[]> {
      const input = boundedString(pattern, "workspace glob")
      assertRelativeGlob(input)
      const matches = await Glob.scan(input, {
        cwd: canonicalRoot,
        absolute: true,
        include: "all",
        dot: true,
        maxResults: WorkspaceLimits.globResults,
      })

      const safe = new Set<string>()
      for (const match of matches) {
        const relative = path.relative(canonicalRoot, match)
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue
        const info = await lstat(match).catch((error) => {
          if (isMissing(error)) return undefined
          throw error
        })
        if (!info || info.isSymbolicLink()) continue
        const canonical = await canonicalExisting(canonicalRoot, match, relative, false)
        if (canonical) safe.add(path.relative(canonicalRoot, canonical))
      }
      return [...safe].sort()
    },
  }
}
