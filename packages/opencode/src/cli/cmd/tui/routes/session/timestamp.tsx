import type { RGBA } from "@opentui/core"
import { Show } from "solid-js"
import { Locale } from "@/util"

export const DEFAULT_TIMESTAMP_VISIBILITY = "show" as const

export function formatSessionTimestamp(input: number) {
  return Locale.todayTimeOrDateTime(input, "second")
}

function MessageFooterMetadata(props: {
  showTimestamp: boolean
  timestamp: number
  copyHover: boolean
  muted: RGBA
  text: RGBA
  onCopy: () => void
  onHoverChange: (hover: boolean) => void
}) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <Show when={props.showTimestamp}>
        <text fg={props.muted}>{formatSessionTimestamp(props.timestamp)}</text>
      </Show>
      <box
        onMouseOver={() => props.onHoverChange(true)}
        onMouseOut={() => props.onHoverChange(false)}
        onMouseUp={(event) => {
          event.stopPropagation()
          props.onCopy()
        }}
      >
        <text fg={props.copyHover ? props.text : props.muted}>⎘ copy</text>
      </box>
    </box>
  )
}

export function UserMessageMetadata(props: {
  queued: boolean
  showTimestamp: boolean
  timestamp: number
  queuedBackground: RGBA
  queuedForeground: RGBA
  copyHover: boolean
  muted: RGBA
  text: RGBA
  onCopy: () => void
  onHoverChange: (hover: boolean) => void
}) {
  return (
    <box width="100%" flexDirection="row" alignItems="center" flexShrink={0}>
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
      <box flexGrow={1} />
      <MessageFooterMetadata
        showTimestamp={props.showTimestamp}
        timestamp={props.timestamp}
        copyHover={props.copyHover}
        muted={props.muted}
        text={props.text}
        onCopy={props.onCopy}
        onHoverChange={props.onHoverChange}
      />
    </box>
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
      <MessageFooterMetadata
        showTimestamp={props.showTimestamp}
        timestamp={props.completedAt!}
        copyHover={props.copyHover}
        muted={props.muted}
        text={props.text}
        onCopy={props.onCopy}
        onHoverChange={props.onHoverChange}
      />
    </Show>
  )
}
