import { createMemo } from "solid-js"
import { Keybind } from "@/util"
import { pipe, mapValues } from "remeda"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"
import type { ParsedKey } from "@opentui/core"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"
import { useLeaderActive } from "../keymap"

export type KeybindKey = keyof NonNullable<TuiConfig.Info["keybinds"]> & string

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const keybinds = createMemo<Record<string, Keybind.Info[]>>(() => {
      return pipe(
        (config.keybinds ?? {}) as Record<string, string>,
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const leaderActive = useLeaderActive()

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return leaderActive()
      },
      parse(evt: ParsedKey): Keybind.Info {
        // Handle special case for Ctrl+Underscore (represented as \x1F)
        if (evt.name === "\x1F") {
          return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, leaderActive())
        }
        return Keybind.fromParsedKey(evt, leaderActive())
      },
      match(key: string, evt: ParsedKey) {
        const list = keybinds()[key] ?? Keybind.parse(key)
        if (!list.length) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const item of list) {
          if (Keybind.match(item, parsed)) {
            return true
          }
        }
        return false
      },
      print(key: string) {
        const first = keybinds()[key]?.at(0) ?? Keybind.parse(key).at(0)
        if (!first) return ""
        const text = Keybind.toString(first)
        const lead = keybinds().leader?.[0]
        if (!lead) return text
        return text.replace("<leader>", Keybind.toString(lead))
      },
    }
    return result
  },
})
