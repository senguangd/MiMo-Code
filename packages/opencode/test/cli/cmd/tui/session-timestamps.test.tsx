/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import {
  AssistantFooterMetadata,
  DEFAULT_TIMESTAMP_VISIBILITY,
  UserMessageMetadata,
  formatSessionTimestamp,
} from "../../../../src/cli/cmd/tui/routes/session/timestamp"

const muted = RGBA.fromInts(128, 128, 128)
const text = RGBA.fromInts(255, 255, 255)
const queuedBackground = RGBA.fromInts(255, 165, 0)
const queuedForeground = RGBA.fromInts(0, 0, 0)
const timestamp = Date.now()
const userCreated = new Date(2026, 6, 21, 8, 41, 52, 848).getTime()
const assistantCreated = new Date(2026, 6, 21, 8, 41, 52, 896).getTime()
const assistantCompleted = new Date(2026, 6, 21, 8, 42, 22, 841).getTime()

async function capture(node: () => JSX.Element, width = 60) {
  const app = await testRender(node, { width, height: 4 })
  try {
    await app.flush()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

describe("session timestamps", () => {
  test("defaults timestamp visibility to show", () => {
    expect(DEFAULT_TIMESTAMP_VISIBILITY).toBe("show")
  })

  test("renders QUEUED and a second-precise timestamp together", async () => {
    const frame = await capture(() => (
      <UserMessageMetadata
        queued={true}
        showTimestamp={true}
        timestamp={timestamp}
        queuedBackground={queuedBackground}
        queuedForeground={queuedForeground}
        muted={muted}
      />
    ))
    expect(frame).toContain("QUEUED")
    expect(frame).toContain(formatSessionTimestamp(timestamp))
  })

  test("does not allocate visible metadata when timestamps are hidden and the message is not queued", async () => {
    const frame = await capture(() => (
      <UserMessageMetadata
        queued={false}
        showTimestamp={false}
        timestamp={timestamp}
        queuedBackground={queuedBackground}
        queuedForeground={queuedForeground}
        muted={muted}
      />
    ))
    expect(frame).not.toContain(formatSessionTimestamp(timestamp))
    expect(frame).not.toContain("QUEUED")
  })

  test("omits assistant completion metadata while streaming", async () => {
    const frame = await capture(() => (
      <AssistantFooterMetadata
        showTimestamp={true}
        completedAt={undefined}
        copyHover={false}
        muted={muted}
        text={text}
        onCopy={() => undefined}
        onHoverChange={() => undefined}
      />
    ))
    expect(frame).not.toContain(formatSessionTimestamp(timestamp))
    expect(frame).not.toContain("copy")
  })

  test("shows assistant completion time and copy after completion", async () => {
    const frame = await capture(
      () => (
        <AssistantFooterMetadata
          showTimestamp={true}
          completedAt={timestamp}
          copyHover={false}
          muted={muted}
          text={text}
          onCopy={() => undefined}
          onHoverChange={() => undefined}
        />
      ),
      28,
    )
    expect(frame).toContain(formatSessionTimestamp(timestamp))
    expect(frame).toContain("copy")
  })

  test("uses assistant completion time instead of the near-identical creation time", async () => {
    const frame = await capture(() => (
      <AssistantFooterMetadata
        showTimestamp={true}
        completedAt={assistantCompleted}
        copyHover={false}
        muted={muted}
        text={text}
        onCopy={() => undefined}
        onHoverChange={() => undefined}
      />
    ))
    expect(formatSessionTimestamp(userCreated)).toBe(formatSessionTimestamp(assistantCreated))
    expect(frame).toContain(formatSessionTimestamp(assistantCompleted))
    expect(frame).not.toContain(formatSessionTimestamp(assistantCreated))
  })

  test("preserves copy while timestamps are hidden", async () => {
    const frame = await capture(() => (
      <AssistantFooterMetadata
        showTimestamp={false}
        completedAt={timestamp}
        copyHover={false}
        muted={muted}
        text={text}
        onCopy={() => undefined}
        onHoverChange={() => undefined}
      />
    ))
    expect(frame).not.toContain(formatSessionTimestamp(timestamp))
    expect(frame).toContain("copy")
  })
})
