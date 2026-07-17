import { describe, expect, test } from "bun:test"
import { resolve } from "../../src/tool/websearch/backend"

describe("tool.websearch.backend", () => {
  test("does not expose websearch for grcbank without an enabled backend", () => {
    expect(resolve({ providerID: "grcbank", exaEnabled: false })).toBeUndefined()
  })

  test("resolves Exa only for opencode or explicit opt-in", () => {
    expect(resolve({ providerID: "opencode", exaEnabled: false })).toEqual({ kind: "exa" })
    expect(resolve({ providerID: "grcbank", exaEnabled: true })).toEqual({ kind: "exa" })
  })

  test("requires Xiaomi API authentication for the native backend", () => {
    expect(resolve({ providerID: "xiaomi", exaEnabled: false })).toBeUndefined()
    expect(resolve({ providerID: "xiaomi", xiaomiApiKey: "secret", exaEnabled: false })).toEqual({
      kind: "xiaomi-native",
      apiKey: "secret",
    })
  })

  test("falls back to explicitly enabled Exa when Xiaomi native auth is absent", () => {
    expect(resolve({ providerID: "xiaomi", exaEnabled: true })).toEqual({ kind: "exa" })
  })
})
