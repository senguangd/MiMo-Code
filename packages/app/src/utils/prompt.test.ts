import { describe, expect, test } from "bun:test"
import type { Part } from "@mimo-ai/sdk/v2"
import { extractPromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  const filePrompt = (value: string, sourcePath = value.slice(1)) =>
    [
      {
        id: "text_path",
        type: "text",
        text: value,
        sessionID: "ses_path",
        messageID: "msg_path",
      },
      {
        id: "file_path",
        type: "file",
        mime: "text/plain",
        url: `file://${sourcePath}`,
        sessionID: "ses_path",
        messageID: "msg_path",
        source: {
          type: "file",
          path: sourcePath,
          text: { value, start: 0, end: value.length },
        },
      },
    ] satisfies Part[]

  test("restores Windows project files as relative paths", () => {
    const result = extractPromptFromParts(filePrompt(String.raw`@c:\work\project\src\index.ts`), {
      directory: String.raw`C:\Work\Project`,
    })

    expect(result.find((part) => part.type === "file")).toMatchObject({ path: String.raw`src\index.ts` })
  })

  test("keeps sibling-prefix file paths absolute", () => {
    const value = String.raw`@C:\Work\Project-old\index.ts`
    const result = extractPromptFromParts(filePrompt(value), { directory: String.raw`C:\Work\Project` })

    expect(result.find((part) => part.type === "file")).toMatchObject({ path: value.slice(1) })
  })

  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      { type: "image", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      { type: "image", filename: "b.pdf", mime: "application/pdf", dataUrl: "data:application/pdf;base64,BBB" },
    ])
  })
})
