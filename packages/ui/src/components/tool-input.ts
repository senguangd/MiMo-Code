function string(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === "string" ? value : undefined
}

export function toolFilePath(input: Record<string, unknown>) {
  return string(input, "file_path") ?? string(input, "filePath")
}

export function editOldString(input: Record<string, unknown>) {
  return string(input, "old_string") ?? string(input, "oldString")
}

export function editNewString(input: Record<string, unknown>) {
  return string(input, "new_string") ?? string(input, "newString")
}

export function toolFileLabel(input: Record<string, unknown>, directory?: string) {
  const filePath = toolFilePath(input)
  if (!filePath) return ""

  const file = filePath.replaceAll("\\", "/")
  const base = directory?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!base) return file

  const windows = /^[A-Za-z]:\//.test(file) && /^[A-Za-z]:\//.test(base)
  const target = windows ? file.toLowerCase() : file
  const root = windows ? base.toLowerCase() : base
  if (target === root) return "."
  if (target.startsWith(root + "/")) return file.slice(base.length + 1)
  return file
}
