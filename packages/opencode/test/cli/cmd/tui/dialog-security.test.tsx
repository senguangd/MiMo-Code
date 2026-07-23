import { describe, expect, test } from "bun:test"
import {
  canClearDialog,
  canDismissDialog,
  canReplaceDialog,
} from "../../../../src/cli/cmd/tui/ui/dialog"
import {
  maskSecret,
  updateSecretFromDisplay,
} from "../../../../src/cli/cmd/tui/ui/dialog-secret-prompt"

describe("TUI credential safety", () => {
  test("masks every entered character without retaining visible secret text", () => {
    const secret = "sk-super-secret-value"
    const masked = maskSecret(secret)
    expect(masked).toBe("*".repeat(Array.from(secret).length))
    expect(masked).not.toContain(secret)
    expect(masked.length).toBe(secret.length)
  })

  test("controlled secret input supports typing, paste, and backspace while the renderable contains only masks", () => {
    let secret = ""
    secret = updateSecretFromDisplay(secret, "s")
    expect(secret).toBe("s")
    expect(maskSecret(secret)).toBe("*")

    secret = updateSecretFromDisplay(secret, "*k-demo")
    expect(secret).toBe("sk-demo")
    expect(maskSecret(secret)).toBe("*******")

    secret = updateSecretFromDisplay(secret, "******")
    expect(secret).toBe("sk-dem")
    expect(maskSecret(secret)).toBe("******")
  })

  test("mandatory dialogs reject dismiss, ordinary replacement, and ordinary clear", () => {
    const mandatory = [{ dismissible: false }]
    expect(canDismissDialog(mandatory)).toBe(false)
    expect(canReplaceDialog(mandatory)).toBe(false)
    expect(canClearDialog(mandatory)).toBe(false)
    expect(canReplaceDialog(mandatory, true)).toBe(true)
    expect(canClearDialog(mandatory, true)).toBe(true)
  })

  test("normal dialogs preserve existing dismiss and replacement behavior", () => {
    const normal = [{ dismissible: true }]
    expect(canDismissDialog(normal)).toBe(true)
    expect(canReplaceDialog(normal)).toBe(true)
    expect(canClearDialog(normal)).toBe(true)
  })
})
