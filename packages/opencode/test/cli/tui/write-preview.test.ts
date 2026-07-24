import { describe, expect, test } from "bun:test"
import { writeDisplayContent, writeStreamPreview } from "../../../src/cli/cmd/tui/routes/session/write-preview"

describe("writeStreamPreview", () => {
  test("keeps a short streamed write intact", () => {
    expect(writeStreamPreview(["line 1", "line 2"])).toBe("line 1\nline 2")
  })

  test("shows a bounded rolling tail for large streamed writes", () => {
    const lines = Array.from({ length: 20 }, (_, index) => "line " + (index + 1))
    expect(writeStreamPreview(lines).split("\n")).toEqual(["…", ...lines.slice(-12)])
  })

  test("keeps the newest end of an unusually long line", () => {
    const line = "prefix-" + "x".repeat(300) + "-tail"
    const preview = writeStreamPreview([line])
    expect(preview.startsWith("…")).toBe(true)
    expect(preview.endsWith("-tail")).toBe(true)
    expect(preview.length).toBe(241)
  })

  test("uses the streamed preview only while tool input is pending", () => {
    expect(writeDisplayContent({ status: "pending", content: undefined, preview: "partial" })).toBe("partial")
    expect(writeDisplayContent({ status: "running", content: "final", preview: "partial" })).toBe("final")
    expect(writeDisplayContent({ status: "completed", content: "final", preview: "partial" })).toBe("final")
  })
})
