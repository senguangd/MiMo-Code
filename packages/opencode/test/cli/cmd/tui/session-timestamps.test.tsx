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

const userActionProps = {
  copyHover: false,
  text,
  onCopy: () => undefined,
  onHoverChange: () => undefined,
}

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
        {...userActionProps}
      />
    ))
    expect(frame).toContain("QUEUED")
    expect(frame).toContain(formatSessionTimestamp(timestamp))
  })

  test("preserves copy when user timestamps are hidden and the message is not queued", async () => {
    const frame = await capture(() => (
      <UserMessageMetadata
        queued={false}
        showTimestamp={false}
        timestamp={timestamp}
        queuedBackground={queuedBackground}
        queuedForeground={queuedForeground}
        muted={muted}
        {...userActionProps}
      />
    ))
    expect(frame).not.toContain(formatSessionTimestamp(timestamp))
    expect(frame).not.toContain("QUEUED")
    expect(frame).toContain("copy")
  })

  test("aligns queued state left and user timestamp plus copy at the right edge", async () => {
    const frame = await capture(
      () => (
        <UserMessageMetadata
          queued={true}
          showTimestamp={true}
          timestamp={timestamp}
          queuedBackground={queuedBackground}
          queuedForeground={queuedForeground}
          muted={muted}
          {...userActionProps}
        />
      ),
      48,
    )
    const row = frame.split("\n").find((line) => line.includes("QUEUED"))
    expect(row).toBeDefined()
    expect(row!.indexOf("QUEUED")).toBeLessThan(row!.indexOf(formatSessionTimestamp(timestamp)))
    expect(row!.endsWith("⎘ copy")).toBe(true)
  })

  test("user copy click does not bubble to the message container", async () => {
    let copied = 0
    let opened = 0
    const app = await testRender(
      () => (
        <box onMouseUp={() => opened++}>
          <UserMessageMetadata
            queued={false}
            showTimestamp={false}
            timestamp={timestamp}
            queuedBackground={queuedBackground}
            queuedForeground={queuedForeground}
            muted={muted}
            copyHover={false}
            text={text}
            onCopy={() => copied++}
            onHoverChange={() => undefined}
          />
        </box>
      ),
      { width: 40, height: 4 },
    )
    try {
      await app.flush()
      const rows = app.captureCharFrame().split("\n")
      const y = rows.findIndex((line) => line.includes("copy"))
      expect(y).toBeGreaterThanOrEqual(0)
      const x = rows[y]!.indexOf("copy")
      expect(x).toBeGreaterThanOrEqual(0)

      await app.mockMouse.click(x, y)
      await app.flush()

      expect(copied).toBe(1)
      expect(opened).toBe(0)
    } finally {
      app.renderer.destroy()
    }
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
