import path from "node:path"
import { Global } from "@/global"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { formatHomePath } from "@/util/format"

export function normalizePermissionPath(input?: string, cwd = process.cwd(), home = Global.Path.home) {
  if (!input) return ""

  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)

  if (!relative) return "."
  if (AppFileSystem.contains(cwd, absolute)) return relative
  return home ? formatHomePath(absolute, home) : absolute
}