import { describe, expect, test } from "bun:test"
import { slashCandidates, slashEntries } from "../../../../src/cli/cmd/tui/component/dialog-command"

describe("slash command alias visibility", () => {
  const entries = slashEntries(
    {
      name: "timestamps",
      aliases: ["toggle-timestamps"],
    },
    "Show timestamps",
    () => undefined,
  )

  test("shows only the canonical command before the user searches", () => {
    expect(slashCandidates(entries, "").map((entry) => entry.display)).toEqual(["/timestamps"])
  })

  test("does not surface an alias for a canonical-name search", () => {
    expect(slashCandidates(entries, "time").map((entry) => entry.display)).toEqual(["/timestamps"])
  })

  test("surfaces an alias when the user types its prefix", () => {
    expect(slashCandidates(entries, "toggle").map((entry) => entry.display)).toEqual([
      "/timestamps",
      "/toggle-timestamps",
    ])
  })

  test("keeps aliases executable through the same handler", () => {
    let selected = 0
    const aliases = slashEntries(
      {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      "Toggle thinking",
      () => selected++,
    )

    aliases.find((entry) => entry.display === "/toggle-thinking")?.onSelect()
    expect(selected).toBe(1)
  })
})
