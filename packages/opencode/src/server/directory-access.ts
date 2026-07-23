import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { isAllowedRoot } from "@/server/allowed-root"
import { Filesystem } from "@/util"
import { AppFileSystem } from "@adp-ai/shared/filesystem"
import path from "node:path"

export type DirectoryAccessPolicy = "cwd" | "host"

export const DIRECTORY_ACCESS_DENIED = "Access denied: directory must be within the server's working directory"

export function resolveDirectory(input: string) {
  return AppFileSystem.resolve(
    (() => {
      try {
        return decodeURIComponent(input)
      } catch {
        return input
      }
    })(),
  )
}

export function directoryAccessPolicy(policy?: DirectoryAccessPolicy): DirectoryAccessPolicy {
  if (policy) return policy
  return Flag.ADPCLI_SERVER_PASSWORD ? "host" : "cwd"
}

export function isDirectoryAllowed(directory: string, policy?: DirectoryAccessPolicy) {
  if (directoryAccessPolicy(policy) === "host") return true

  const target = Filesystem.resolve(directory)
  const cwd = Filesystem.resolve(process.cwd())
  const orchestrator = Flag.ADPCLI_EXPERIMENTAL_ORCHESTRATOR
    ? Filesystem.resolve(path.join(Global.Path.data, "orchestrator"))
    : undefined

  return Filesystem.contains(cwd, target) || isAllowedRoot(target) || target === orchestrator
}
