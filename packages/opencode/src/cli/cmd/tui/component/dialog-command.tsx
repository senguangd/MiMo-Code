import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeybind } from "@tui/context/keybind"
import { useLanguage } from "@tui/context/language"
import { useTuiConfig } from "@tui/context/tui-config"
import { OPENCODE_BASE_MODE, commandForKeybind, createOpencodeBindingLookup, formatKey, useBindings } from "../keymap"

const CATEGORY_KEYS: Record<string, string> = {
  session: "tui.command.category.session",
  agent: "tui.command.category.agent",
  provider: "tui.command.category.provider",
  system: "tui.command.category.system",
  prompt: "tui.command.category.prompt",
  internal: "tui.command.category.internal",
  external: "tui.command.category.external",
}

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type Slash = {
  name: string
  aliases?: string[]
}

export type SlashEntry = {
  display: string
  description: string
  onSelect: () => void
  alias?: boolean
}

export function slashEntries(slash: Slash, description: string, onSelect: () => void): SlashEntry[] {
  return [
    { display: "/" + slash.name, description, onSelect },
    ...(slash.aliases ?? []).map((alias) => ({
      display: "/" + alias,
      description,
      onSelect,
      alias: true,
    })),
  ]
}

export function slashCandidates(entries: SlashEntry[], search: string) {
  const query = search.replace(/^\/+/, "").toLowerCase()
  if (!query) return entries.filter((entry) => !entry.alias)
  return entries.filter((entry) => !entry.alias || entry.display.slice(1).toLowerCase().startsWith(query))
}

export type CommandOption = DialogSelectOption<string> & {
  keybind?: string
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}

function init() {
  const root = getOwner()
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const [reservedKeys, setReservedKeys] = createSignal(new Map<string, number>())
  const dialog = useDialog()
  const keybind = useKeybind()
  const lang = useLanguage()
  const tuiConfig = useTuiConfig()

  const localizeCategory = (category: string | undefined) => {
    if (!category) return category
    const key = CATEGORY_KEYS[category]
    if (key) return lang.t(key)
    return category
  }

  // The command value (e.g. "session.list") and slash names are stable English
  // identifiers. Expose them as latin search keywords so users in a non-English
  // locale can still find commands by typing "session", "model", "theme", etc.
  // without switching input method, even though the visible title is localized.
  const deriveKeywords = (option: CommandOption) => {
    const tokens = [option.value, ...option.value.split(/[.\-_:]/)]
    if (option.slash) tokens.push(option.slash.name, ...(option.slash.aliases ?? []))
    return [...new Set([...(option.keywords ?? []), ...tokens].filter(Boolean))]
  }

  const entries = createMemo(() => {
    const all = registrations().flatMap((x) => x())
    return all.map((x) => ({
      ...x,
      category: localizeCategory(x.category),
      keywords: deriveKeywords(x),
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = createMemo(() => entries().filter((option) => isVisible(option)))
  const suggestedOptions = createMemo(() =>
    visibleOptions()
      .filter((option) => option.suggested)
      .map((option) => ({
        ...option,
        value: `suggested:${option.value}`,
        category: lang.t("tui.command.palette.suggested"),
      })),
  )
  const suspended = () => suspendCount() > 0
  const normalizeKey = (key: string) => key.trim().toLowerCase()
  const reservedKeySet = createMemo(() => new Set(reservedKeys().keys()))
  const updateReservedKeys = (keys: readonly string[], delta: 1 | -1) => {
    setReservedKeys((current) => {
      const next = new Map(current)

      for (const raw of keys) {
        const key = normalizeKey(raw)
        const count = (next.get(key) ?? 0) + delta

        if (count <= 0) next.delete(key)
        else next.set(key, count)
      }

      return next
    })
  }

  const bindingLookup = createMemo(() => createOpencodeBindingLookup(tuiConfig))
  const commandEntries = createMemo(() =>
    entries().map((option) => ({
      namespace: "palette",
      name: option.value,
      title: option.title,
      desc: option.description,
      category: option.category,
      hidden: option.hidden,
      enabled: isEnabled(option),
      run: () => {
        if (!isEnabled(option)) return
        option.onSelect?.(dialog)
      },
    })),
  )
  const showCommandPalette = () => {
    if (suspended()) return
    if (dialog.stack.length > 0) return
    dialog.replace(() => <DialogCommand options={visibleOptions()} suggestedOptions={suggestedOptions()} />)
  }

  useBindings(() => ({
    commands: commandEntries(),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings:
      suspended() || dialog.stack.length > 0
        ? []
        : entries().flatMap((option) => {
            if (!isEnabled(option)) return []
            if (!option.keybind) return []
            // input.submit is handled by registerManagedTextareaLayer and textarea onSubmit.
            if (option.keybind === "input_submit") return []
            return bindingLookup()
              .get(commandForKeybind(option.keybind))
              .filter((binding) => !reservedKeySet().has(normalizeKey(formatKey(binding.key))))
          }),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        namespace: "palette",
        name: "command.palette.show",
        title: lang.t("tui.command.palette.title"),
        hidden: true,
        run: showCommandPalette,
      },
    ],
    bindings: suspended() || dialog.stack.length > 0 ? [] : bindingLookup().get(commandForKeybind("command_list")),
  }))

  const result = {
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          option.onSelect?.(dialog)
          return
        }
      }
    },
    slashes() {
      return visibleOptions().flatMap((option) => {
        const slash = option.slash
        if (!slash) return []
        return slashEntries(slash, option.description ?? option.title, () => result.trigger(option.value))
      })
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    reserveKeys(keys: readonly string[]) {
      updateReservedKeys(keys, 1)

      let released = false
      return () => {
        if (released) return
        released = true
        updateReservedKeys(keys, -1)
      }
    },
    suspended,
    show() {
      showCommandPalette()
    },
    register(cb: () => CommandOption[]) {
      const owner = getOwner() ?? root
      if (!owner) return () => {}

      let list: Accessor<CommandOption[]> | undefined

      // TUI plugins now register commands via an async store that runs outside an active reactive scope.
      // runWithOwner attaches createMemo/onCleanup to this owner so plugin registrations stay reactive and dispose correctly.
      runWithOwner(owner, () => {
        list = createMemo(cb)
        const ref = list
        if (!ref) return
        setRegistrations((arr) => [ref, ...arr])
        onCleanup(() => {
          setRegistrations((arr) => arr.filter((x) => x !== ref))
        })
      })

      if (!list) return () => {}
      let done = false
      return () => {
        if (done) return
        done = true
        const ref = list
        if (!ref) return
        setRegistrations((arr) => arr.filter((x) => x !== ref))
      }
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  const lang = useLanguage()
  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return props.options
    return [...props.suggestedOptions, ...props.options]
  }
  return <DialogSelect ref={(r) => (ref = r)} title={lang.t("tui.command.palette.title")} options={list()} />
}
