import path from "node:path"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import { Effect } from "effect"
import { Global } from "@/global"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { RuntimeLease } from "@/runtime/lease"

export function isMemoryPath(filePath: string) {
  return AppFileSystem.contains(path.join(Global.Path.data, "memory"), filePath)
}

export function atomic(filePath: string, content: string | Uint8Array) {
  const directory = path.dirname(filePath)
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  const cleanup = Effect.tryPromise({
    try: () => fs.rm(temporary, { force: true }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(Effect.ignore)
  return Effect.gen(function* () {
    yield* RuntimeLease.assertCurrent()
    yield* Effect.tryPromise({
      try: async () => {
        await fs.mkdir(directory, { recursive: true })
        const handle = await fs.open(temporary, "w")
        try {
          await handle.writeFile(content)
          await handle.sync()
        } finally {
          await handle.close()
        }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    yield* RuntimeLease.assertCurrent()
    yield* Effect.tryPromise({
      try: () => fs.rename(temporary, filePath),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
  }).pipe(Effect.ensuring(cleanup))
}

export function write(afs: AppFileSystem.Interface, filePath: string, content: string | Uint8Array) {
  return isMemoryPath(filePath) ? atomic(filePath, content) : afs.writeWithDirs(filePath, content)
}

export * as AtomicWrite from "./atomic-write"
