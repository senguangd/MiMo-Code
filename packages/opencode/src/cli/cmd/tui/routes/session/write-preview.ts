const MAX_LINES = 12
const MAX_LINE_LENGTH = 240

export function writeStreamPreview(lines: string[]) {
  const preview = lines.slice(-MAX_LINES).map((line) => {
    if (line.length <= MAX_LINE_LENGTH) return line
    return "…" + line.slice(-MAX_LINE_LENGTH)
  })
  if (lines.length > MAX_LINES) preview.unshift("…")
  return preview.join("\n")
}

export function writeDisplayContent(input: { status: string; content: unknown; preview: unknown }) {
  if (input.status === "pending" && typeof input.preview === "string") return input.preview
  return typeof input.content === "string" ? input.content : ""
}
