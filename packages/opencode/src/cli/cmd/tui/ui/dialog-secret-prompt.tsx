import { InputRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createSignal, onMount, Show, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { useLanguage } from "@tui/context/language"
import { useDialog } from "./dialog"
import { Spinner } from "../component/spinner"

const MASK = "*"

export function maskSecret(value: string) {
  return MASK.repeat(Array.from(value).length)
}

export function updateSecretFromDisplay(secret: string, display: string) {
  const chars = Array.from(secret)
  const mask = maskSecret(secret)
  if (display === mask) return secret
  if (display.length < mask.length && Array.from(display).every((char) => char === MASK)) {
    return chars.slice(0, Array.from(display).length).join("")
  }
  if (display.startsWith(mask)) return secret + display.slice(mask.length)
  return secret
}

export type DialogSecretPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  busyText?: string
  dismissible?: boolean
  onConfirm: (value: string) => void | Promise<void>
  onError?: (error: unknown) => void
}

export function DialogSecretPrompt(props: DialogSecretPromptProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useLanguage().t
  const [value, setValue] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  let input: InputRenderable

  function syncDisplay() {
    if (!input || input.isDestroyed) return
    const masked = maskSecret(value())
    if (input.value !== masked) input.value = masked
    input.gotoLineEnd()
  }

  async function submit() {
    if (busy()) return
    const key = value().trim()
    if (!key) return
    setBusy(true)
    try {
      await props.onConfirm(key)
    } catch (error) {
      props.onError?.(error)
    } finally {
      setBusy(false)
    }
  }

  useKeyboard((event) => {
    if (busy()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (["left", "right", "home", "end"].includes(event.name)) {
      event.preventDefault()
      event.stopPropagation()
      syncDisplay()
      return
    }
    if (event.name !== "return") return
    event.preventDefault()
    event.stopPropagation()
    void submit()
  })

  createEffect(syncDisplay)

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      syncDisplay()
      input.focus()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <Show when={props.dismissible !== false}>
          <text fg={theme.textMuted} onMouseUp={() => dialog.dismiss()}>
            {t("tui.dialog.close_hint")}
          </text>
        </Show>
      </box>
      <box gap={1}>
        {props.description}
        <input
          ref={(renderable: InputRenderable) => {
            input = renderable
          }}
          value={maskSecret(value())}
          placeholder={props.placeholder ?? "API key"}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          backgroundColor={theme.backgroundPanel}
          focusedBackgroundColor={theme.backgroundPanel}
          onInput={(display) => {
            setValue((secret) => updateSecretFromDisplay(secret, display))
            queueMicrotask(syncDisplay)
          }}
        />
        <Show when={busy()}>
          <Spinner color={theme.textMuted}>{props.busyText ?? "Validating API key..."}</Spinner>
        </Show>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <Show when={!busy()} fallback={<text fg={theme.textMuted}>{t("tui.dialog.prompt.processing")}</text>}>
          <text fg={theme.text} onMouseUp={() => void submit()}>
            {t("tui.dialog.prompt.submit_key")}{" "}
            <span style={{ fg: theme.textMuted }}>{t("tui.dialog.prompt.submit_action")}</span>
          </text>
        </Show>
      </box>
    </box>
  )
}
