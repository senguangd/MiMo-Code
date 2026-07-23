import { describe, expect, test } from "bun:test"
import path from "path"
import { resolveAdpcliHome } from "@adp-ai/shared/global"

describe("resolveAdpcliHome", () => {
  test("with ADPCLI_HOME set, resolves 4 subdirs under root", () => {
    const result = resolveAdpcliHome({
      ADPCLI_HOME: "/tmp/profile-a",
    })
    expect(result.mode).toBe("adpcli_home")
    expect(result.root).toBe("/tmp/profile-a")
    expect(result.config).toBe(path.join("/tmp/profile-a", "config"))
    expect(result.data).toBe(path.join("/tmp/profile-a", "data"))
    expect(result.state).toBe(path.join("/tmp/profile-a", "state"))
    expect(result.cache).toBe(path.join("/tmp/profile-a", "cache"))
  })

  test("without ADPCLI_HOME, falls through to xdg mode", () => {
    const result = resolveAdpcliHome({})
    expect(result.mode).toBe("xdg")
    expect(result.root).toBeUndefined()
    // xdg paths end with "/adpcli"
    expect(result.config.endsWith(path.join("", "adpcli"))).toBe(true)
    expect(result.data.endsWith(path.join("", "adpcli"))).toBe(true)
    expect(result.state.endsWith(path.join("", "adpcli"))).toBe(true)
    expect(result.cache.endsWith(path.join("", "adpcli"))).toBe(true)
  })

  test("empty ADPCLI_HOME string is treated as unset (xdg mode)", () => {
    const result = resolveAdpcliHome({ ADPCLI_HOME: "" })
    expect(result.mode).toBe("xdg")
  })

  test("relative ADPCLI_HOME path throws with clear error", () => {
    expect(() => resolveAdpcliHome({ ADPCLI_HOME: "./foo" })).toThrow(
      /ADPCLI_HOME must be an absolute path/,
    )
    expect(() => resolveAdpcliHome({ ADPCLI_HOME: "foo/bar" })).toThrow(
      /ADPCLI_HOME must be an absolute path/,
    )
  })

  test("tilde-prefixed ADPCLI_HOME throws (not treated as absolute)", () => {
    expect(() => resolveAdpcliHome({ ADPCLI_HOME: "~/profiles/a" })).toThrow(
      /ADPCLI_HOME must be an absolute path/,
    )
  })

  test("error message includes the offending value", () => {
    expect(() => resolveAdpcliHome({ ADPCLI_HOME: "./relative" })).toThrow(
      /\.\/relative/,
    )
  })
})
