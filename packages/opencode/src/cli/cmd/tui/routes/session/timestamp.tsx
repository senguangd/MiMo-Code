import type { RGBA } from "@opentui/core"
import { Show } from "solid-js"
import { Locale } from "@/util"

export const DEFAULT_TIMESTAMP_VISIBILITY = "show" as const

export function formatSessionTimestamp(input: number) {
  return Locale.todayTimeOrDateTime(input, "second")
}

export function UserMessageMetadata(props: {
  queued: boolean
  showTimestamp: boolean
  timestamp: number
  queuedBackground: RGBA
  queuedForeground: RGBA
  muted: RGBA
}) {
  return (
    <Show when={props.queued || props.showTimestamp}>
      <box flexDirection="row" justifyContent="space-between">
        <Show when={props.queued}>
          <text fg={props.muted}>
            <span
              style={{
                bg: props.queuedBackground,
                fg: props.queuedForeground,
                bold: true,
              }}
            >
              {" QUEUED "}
            </span>
          </text>
        </Show>
        <Show when={props.showTimestamp}>
          <text fg={props.muted}>{formatSessionTimestamp(props.timestamp)}</text>
        </Show>
      </box>
    </Show>
  )
}

export function AssistantFooterMetadata(props: {
  showTimestamp: boolean
  completedAt?: number
  copyHover: boolean
  muted: RGBA
  text: RGBA
  onCopy: () => void
  onHoverChange: (hover: boolean) => void
}) {
  return (
    <Show when={props.completedAt !== undefined}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Show when={props.showTimestamp}>
          <text fg={props.muted}>{formatSessionTimestamp(props.completedAt!)}</text>
        </Show>
        <box
          onMouseOver={() => props.onHoverChange(true)}
          onMouseOut={() => props.onHoverChange(false)}
          onMouseUp={props.onCopy}
        >
          <text fg={props.copyHover ? props.text : props.muted}>⎘ copy</text>
        </box>
      </box>
    </Show>
  )
}
