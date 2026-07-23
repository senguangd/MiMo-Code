export * as ConfigPaths from "./paths"

import path from "path"
import { Filesystem } from "@/util"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { unique } from "remeda"
import { JsonError } from "./error"
import * as Effect from "effect/Effect"
import { AppFileSystem } from "@adp-ai/shared/filesystem"

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* AppFileSystem.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* AppFileSystem.Service
  return unique([
    Global.Path.config,
    ...(!Flag.ADPCLI_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".adpcli"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".adpcli"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.ADPCLI_CONFIG_DIR ? [Flag.ADPCLI_CONFIG_DIR] : []),
  ])
})

export const claudeCommandDirectories = Effect.fn("ConfigPaths.claudeCommandDirectories")(function* (
  directory: string,
  worktree?: string,
) {
  if (Flag.ADPCLI_DISABLE_CLAUDE_CODE_COMMANDS) return []
  const afs = yield* AppFileSystem.Service
  return unique([
    path.join(Global.Path.home, ".claude"),
    ...(!Flag.ADPCLI_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".claude"],
          start: directory,
          stop: worktree,
        })
      : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

export function lockKey(dir: string, name: string) {
  return `config:${Filesystem.resolve(path.join(dir, name))}`
}

/** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
export async function readFile(filepath: string) {
  return Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return
    throw new JsonError({ path: filepath }, { cause: err })
  })
}
