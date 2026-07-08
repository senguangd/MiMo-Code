import { Filesystem } from "@/util"

const roots = new Set<string>()

export function allowRoot(directory: string) {
  roots.add(Filesystem.resolve(directory))
}

export function isAllowedRoot(directory: string) {
  const target = Filesystem.resolve(directory)
  for (const root of roots) {
    if (Filesystem.contains(root, target)) {
      return true
    }
  }
  return false
}
