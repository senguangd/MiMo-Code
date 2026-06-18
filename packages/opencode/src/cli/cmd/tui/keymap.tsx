import { InputRenderable, TextareaRenderable, type CliRenderer, type KeyEvent, type Renderable } from "@opentui/core"
import {
  registerBackspacePopsPendingSequence,
  registerBaseLayoutFallback,
  registerCommaBindings,
  registerEscapeClearsPendingSequence,
  registerManagedTextareaLayer,
  registerTimedLeader,
} from "@opentui/keymap/addons/opentui"
import { stringifyKeyStroke, type Binding } from "@opentui/keymap"
import { createBindingLookup } from "@opentui/keymap/extras"
import { KeymapProvider, useKeymap, useKeymapSelector, useBindings } from "@opentui/keymap/solid"
import type { TuiConfig } from "./config/tui"

export const LEADER_TOKEN = "leader"
export const OPENCODE_BASE_MODE = "base"
export const OPENCODE_AUTOCOMPLETE_MODE = "autocomplete"

const OPENCODE_MODE_KEY = "opencode.mode"
const LEADER_TIMEOUT_MS = 2000

export const OpencodeKeymapProvider = KeymapProvider
export const useOpencodeKeymap = useKeymap
export { useBindings }

export type OpenTuiKeymap = ReturnType<typeof useKeymap>
type OpencodeModeStack = ReturnType<typeof createOpencodeModeStack>

const modeStacks = new WeakMap<OpenTuiKeymap, OpencodeModeStack>()

const KEY_ALIASES = {
  enter: "return",
  esc: "escape",
  pgdown: "pagedown",
  pgup: "pageup",
} as const

const INPUT_COMMANDS = [
  "input.move.left",
  "input.move.right",
  "input.move.up",
  "input.move.down",
  "input.select.left",
  "input.select.right",
  "input.select.up",
  "input.select.down",
  "input.line.home",
  "input.line.end",
  "input.select.line.home",
  "input.select.line.end",
  "input.visual.line.home",
  "input.visual.line.end",
  "input.select.visual.line.home",
  "input.select.visual.line.end",
  "input.buffer.home",
  "input.buffer.end",
  "input.select.buffer.home",
  "input.select.buffer.end",
  "input.delete.line",
  "input.delete.to.line.end",
  "input.delete.to.line.start",
  "input.backspace",
  "input.delete",
  "input.newline",
  "input.undo",
  "input.redo",
  "input.word.forward",
  "input.word.backward",
  "input.select.word.forward",
  "input.select.word.backward",
  "input.delete.word.forward",
  "input.delete.word.backward",
  "input.submit",
] as const

export const COMMAND_MAP = {
  leader: LEADER_TOKEN,

  app_exit: "app.exit",
  editor_open: "prompt.editor",
  theme_list: "theme.switch",
  sidebar_toggle: "session.sidebar.toggle",
  scrollbar_toggle: "session.toggle.scrollbar",
  username_toggle: "username.toggle",
  status_view: "opencode.status",

  session_export: "session.export",
  session_new: "session.new",
  session_list: "session.list",
  session_timeline: "session.timeline",
  session_fork: "session.fork",
  session_rename: "session.rename",
  session_delete: "session.delete",
  session_share: "session.share",
  session_unshare: "session.unshare",
  session_interrupt: "session.interrupt",
  session_compact: "session.compact",
  session_child_first: "session.child.first",
  session_child_cycle: "session.child.next",
  session_child_cycle_reverse: "session.child.previous",
  session_parent: "session.parent",

  stash_delete: "stash.delete",
  model_provider_list: "model.dialog.provider",
  model_favorite_toggle: "model.dialog.favorite",
  model_list: "model.list",
  model_cycle_recent: "model.cycle_recent",
  model_cycle_recent_reverse: "model.cycle_recent_reverse",
  model_cycle_favorite: "model.cycle_favorite",
  model_cycle_favorite_reverse: "model.cycle_favorite.reverse",
  command_list: "command.palette.show",
  agent_list: "agent.list",
  agent_cycle: "agent.cycle",
  agent_cycle_reverse: "agent.cycle.reverse",
  variant_cycle: "variant.cycle",
  variant_list: "variant.list",

  messages_page_up: "session.page.up",
  messages_page_down: "session.page.down",
  messages_line_up: "session.line.up",
  messages_line_down: "session.line.down",
  messages_half_page_up: "session.half.page.up",
  messages_half_page_down: "session.half.page.down",
  messages_first: "session.first",
  messages_last: "session.last",
  messages_next: "session.message.next",
  messages_previous: "session.message.previous",
  messages_last_user: "session.messages_last_user",
  messages_copy: "messages.copy",
  messages_undo: "session.undo",
  messages_redo: "session.redo",
  messages_toggle_conceal: "session.toggle.conceal",
  tool_details: "session.toggle.actions",
  display_thinking: "session.toggle.thinking",

  prompt_submit: "prompt.submit",
  prompt_autocomplete_prev: "prompt.autocomplete.prev",
  prompt_autocomplete_next: "prompt.autocomplete.next",
  prompt_autocomplete_hide: "prompt.autocomplete.hide",
  prompt_autocomplete_select: "prompt.autocomplete.select",
  prompt_autocomplete_complete: "prompt.autocomplete.complete",

  input_clear: "prompt.clear",
  input_paste: "prompt.paste",
  input_submit: "input.submit",
  input_newline: "input.newline",
  input_move_left: "input.move.left",
  input_move_right: "input.move.right",
  input_move_up: "input.move.up",
  input_move_down: "input.move.down",
  input_select_left: "input.select.left",
  input_select_right: "input.select.right",
  input_select_up: "input.select.up",
  input_select_down: "input.select.down",
  input_line_home: "input.line.home",
  input_line_end: "input.line.end",
  input_select_line_home: "input.select.line.home",
  input_select_line_end: "input.select.line.end",
  input_visual_line_home: "input.visual.line.home",
  input_visual_line_end: "input.visual.line.end",
  input_select_visual_line_home: "input.select.visual.line.home",
  input_select_visual_line_end: "input.select.visual.line.end",
  input_buffer_home: "input.buffer.home",
  input_buffer_end: "input.buffer.end",
  input_select_buffer_home: "input.select.buffer.home",
  input_select_buffer_end: "input.select.buffer.end",
  input_delete_line: "input.delete.line",
  input_delete_to_line_end: "input.delete.to.line.end",
  input_delete_to_line_start: "input.delete.to.line.start",
  input_backspace: "input.backspace",
  input_delete: "input.delete",
  input_undo: "input.undo",
  input_redo: "input.redo",
  input_word_forward: "input.word.forward",
  input_word_backward: "input.word.backward",
  input_select_word_forward: "input.select.word.forward",
  input_select_word_backward: "input.select.word.backward",
  input_delete_word_forward: "input.delete.word.forward",
  input_delete_word_backward: "input.delete.word.backward",
  history_previous: "prompt.history.previous",
  history_next: "prompt.history.next",

  terminal_suspend: "terminal.suspend",
  terminal_title_toggle: "terminal.title.toggle",
  tips_toggle: "tips.toggle",
  plugin_manager: "plugins.list",
} as const

export function commandForKeybind(key: string) {
  return (COMMAND_MAP as Record<string, string>)[key] ?? key
}

export function createOpencodeModeStack(keymap: OpenTuiKeymap) {
  keymap.setData(OPENCODE_MODE_KEY, OPENCODE_BASE_MODE)

  const offFields = keymap.registerLayerFields({
    mode(value, ctx) {
      ctx.require(OPENCODE_MODE_KEY, value)
    },
  })

  const stack: { id: symbol; mode: string }[] = []
  let disposed = false

  const update = () => {
    keymap.setData(OPENCODE_MODE_KEY, stack.at(-1)?.mode ?? OPENCODE_BASE_MODE)
  }

  const stackApi = {
    current() {
      return stack.at(-1)?.mode ?? OPENCODE_BASE_MODE
    },
    push(mode: string) {
      if (disposed) return () => {}
      const id = Symbol(mode)
      let active = true
      stack.push({ id, mode })
      update()

      return () => {
        if (!active) return
        active = false
        const index = stack.findIndex((item) => item.id === id)
        if (index !== -1) stack.splice(index, 1)
        update()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stack.length = 0
      offFields()
      keymap.setData(OPENCODE_MODE_KEY, undefined)
      modeStacks.delete(keymap)
    },
  }

  modeStacks.set(keymap, stackApi)
  return stackApi
}

export function getOpencodeModeStack(keymap: OpenTuiKeymap) {
  const value = modeStacks.get(keymap)
  if (!value) throw new Error("Opencode mode stack is not registered for this keymap")
  return value
}

export function useOpencodeModeStack() {
  return getOpencodeModeStack(useOpencodeKeymap())
}

function expandKeyAliases(input: string) {
  const result = Object.entries(KEY_ALIASES).reduce(
    (acc, [alias, key]) => acc.replace(new RegExp(`(^|[+,\\s>])${alias}(?=$|[+,\\s<])`, "gi"), `$1${key}`),
    input,
  )
  if (result === input) return
  return result
}

function registerKeyAliases(keymap: OpenTuiKeymap) {
  return keymap.appendBindingExpander((ctx) => {
    const key = expandKeyAliases(ctx.input)
    if (!key) return
    return [{ key, displays: ctx.displays }]
  })
}

type ManagedTextareaTraits = {
  suspend?: boolean
  capture?: readonly string[]
}

function hasManagedTextareaFocus(renderer: CliRenderer) {
  const editor = renderer.currentFocusedEditor
  if (!(editor instanceof TextareaRenderable) || editor instanceof InputRenderable) return false

  const traits = editor.traits as ManagedTextareaTraits | undefined

  // When prompt autocomplete is open it captures navigation/submission keys itself.
  // Do not let the managed textarea layer consume up/down/return before that layer runs.
  if (traits?.capture?.some((item) => item === "navigate" || item === "submit")) return false

  return true
}

export function createOpencodeBindingLookup(config: TuiConfig.Info) {
  return createBindingLookup((config.keybinds ?? {}) as Record<string, string>, {
    commandMap: COMMAND_MAP,
  })
}

export function registerOpencodeKeymap(keymap: OpenTuiKeymap, renderer: CliRenderer, config: TuiConfig.Info) {
  const keybinds = createOpencodeBindingLookup(config)
  const modeStack = createOpencodeModeStack(keymap)
  const offCommaBindings = registerCommaBindings(keymap)
  const offAliasExpander = registerKeyAliases(keymap)
  const offBaseLayout = registerBaseLayoutFallback(keymap)
  const leader = keybinds.get(LEADER_TOKEN)?.[0]?.key
  const offLeader = leader
    ? registerTimedLeader(keymap, {
        trigger: leader,
        name: LEADER_TOKEN,
        timeoutMs: LEADER_TIMEOUT_MS,
      })
    : () => {}
  const offEscape = registerEscapeClearsPendingSequence(keymap)
  const offBackspace = registerBackspacePopsPendingSequence(keymap)
  const offInputBindings = registerManagedTextareaLayer(keymap, renderer, {
    enabled: () => hasManagedTextareaFocus(renderer),
    bindings: keybinds.gather("input", INPUT_COMMANDS),
  })

  return () => {
    offInputBindings()
    offBackspace()
    offEscape()
    offLeader()
    offAliasExpander()
    offBaseLayout()
    offCommaBindings()
    modeStack.dispose()
  }
}

export function useLeaderActive() {
  return useKeymapSelector((keymap: OpenTuiKeymap) => keymap.getPendingSequence()[0]?.tokenName === LEADER_TOKEN)
}

export function formatKey(key: Binding<Renderable, KeyEvent>["key"] | undefined) {
  if (!key) return ""
  return typeof key === "string" ? key : stringifyKeyStroke(key)
}
