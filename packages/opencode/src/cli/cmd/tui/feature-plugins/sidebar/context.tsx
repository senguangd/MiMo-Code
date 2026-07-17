import type { AssistantMessage } from "@mimo-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@mimo-ai/plugin/tui"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { completedTPS, formatTPS, streamingTPS } from "./tps"
import { resolveContextUsage, type ContextUsage } from "../../util/context-usage"

const id = "internal:sidebar-context"
const REFRESH_MS = 1000
type Reading = Exclude<ContextUsage, { kind: "invalidated" }>

function inputLimit(usage: Reading) {
  return usage.kind === "live" ? usage.inputLimit : usage.limit
}

function liveInputLimit(usage: Reading) {
  return usage.kind === "live" ? usage.inputLimit : null
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const [tick, setTick] = createSignal(Date.now())

  const lastAssistant = createMemo(() =>
    msg().findLast((item): item is AssistantMessage => item.role === "assistant"),
  )

  const isStreaming = createMemo(() => {
    const m = lastAssistant()
    return m !== undefined && !m.time.completed
  })

  createEffect(() => {
    if (!isStreaming()) return
    const handle = setInterval(() => setTick(Date.now()), REFRESH_MS)
    onCleanup(() => clearInterval(handle))
  })

  const tps = createMemo<number | null>(() => {
    const m = lastAssistant()
    if (!m) return null

    if (isStreaming()) {
      tick() // reactivity dep so the readout updates between deltas
      const parts = props.api.state.part(m.id)
      const combined = parts
        .filter((p) => p.type === "text" || p.type === "reasoning")
        .map((p) => p.text)
        .join("")
      return streamingTPS(combined, m.time.created, Date.now())
    }

    const idleTarget = msg().findLast(
      (item): item is AssistantMessage =>
        item.role === "assistant" &&
        item.time.completed !== undefined &&
        item.tokens.output + item.tokens.reasoning > 0,
    )
    if (!idleTarget || idleTarget.time.completed === undefined) return null
    return completedTPS(
      idleTarget.tokens.output,
      idleTarget.tokens.reasoning,
      idleTarget.time.created,
      idleTarget.time.completed,
    )
  })

  const tpsLabel = createMemo(() => formatTPS(tps()))

  const state = createMemo(() => {
    const live = (props.api.state.session.status(props.session_id) as
      | { type: string; context?: { input: number; output: number; limit: number; inputLimit: number } }
      | undefined)?.context
    return resolveContextUsage({
      messages: msg(),
      parts: (messageID) => props.api.state.part(messageID),
      live,
      contextLimit: (providerID, modelID) =>
        props.api.state.provider.find((item) => item.id === providerID)?.models[modelID]?.limit.context,
    })
  })
  const reading = createMemo<Reading | undefined>(() => {
    const value = state()
    return value?.kind === "invalidated" ? undefined : value
  })
  const invalidated = createMemo(() => state()?.kind === "invalidated")

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <Show
        when={reading()}
        fallback={invalidated() ? <text fg={theme().textMuted}>Recalculates on next request</text> : undefined}
      >
        {(usage) => (
          <>
            <text fg={theme().textMuted}>
              {usage().input.toLocaleString()} {usage().kind === "live" ? "input tokens" : "tokens (last request)"}
            </text>
            <Show when={usage().kind === "live" ? usage().reserved : null}>
              {(reserved) => <text fg={theme().textMuted}>{reserved().toLocaleString()} output reserved</text>}
            </Show>
            <Show when={inputLimit(usage())}>
              {(limit) => (
                <text fg={theme().textMuted}>
                  {Math.round((usage().input / limit()) * 100)}%{" "}
                  {usage().kind === "live" ? "effective input used" : "used (last request)"}
                </text>
              )}
            </Show>
            <Show when={liveInputLimit(usage())}>
              {(limit) => <text fg={theme().textMuted}>{limit().toLocaleString()} effective input limit</text>}
            </Show>
          </>
        )}
      </Show>
      <Show when={tpsLabel()}>{(label) => <text fg={theme().textMuted}>{label()}</text>}</Show>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
