import { describe, expect, test } from "bun:test"
import path from "node:path"
import { formatDuration, formatHomePath } from "../../src/util/format"

describe("util.format", () => {
  describe("formatHomePath", () => {
    const home = path.join(path.parse(process.cwd()).root, "Users", "Alice")

    test("shortens the home directory and its descendants", () => {
      expect(formatHomePath(home, home)).toBe("~")
      expect(formatHomePath(path.join(home, ".config", "auth.json"), home)).toBe(
        path.join("~", ".config", "auth.json"),
      )
    })

    test("does not shorten sibling-prefix or unrelated paths", () => {
      const sibling = path.join(`${home}-backup`, "auth.json")
      expect(formatHomePath(sibling, home)).toBe(sibling)
      const unrelated = path.join(path.parse(process.cwd()).root, "Other", "auth.json")
      expect(formatHomePath(unrelated, home)).toBe(unrelated)
    })

    test("does not shorten a different Windows drive", () => {
      if (process.platform !== "win32") return
      expect(formatHomePath(String.raw`D:\auth.json`, String.raw`C:\Users\Alice`)).toBe(String.raw`D:\auth.json`)
    })
  })

  describe("formatDuration", () => {
    test("returns empty string for zero or negative values", () => {
      expect(formatDuration(0)).toBe("")
      expect(formatDuration(-1)).toBe("")
      expect(formatDuration(-100)).toBe("")
    })

    test("formats seconds under a minute", () => {
      expect(formatDuration(1)).toBe("1s")
      expect(formatDuration(30)).toBe("30s")
      expect(formatDuration(59)).toBe("59s")
    })

    test("formats minutes under an hour", () => {
      expect(formatDuration(60)).toBe("1m")
      expect(formatDuration(61)).toBe("1m 1s")
      expect(formatDuration(90)).toBe("1m 30s")
      expect(formatDuration(120)).toBe("2m")
      expect(formatDuration(330)).toBe("5m 30s")
      expect(formatDuration(3599)).toBe("59m 59s")
    })

    test("formats hours under a day", () => {
      expect(formatDuration(3600)).toBe("1h")
      expect(formatDuration(3660)).toBe("1h 1m")
      expect(formatDuration(7200)).toBe("2h")
      expect(formatDuration(8100)).toBe("2h 15m")
      expect(formatDuration(86399)).toBe("23h 59m")
    })

    test("formats days under a week", () => {
      expect(formatDuration(86400)).toBe("~1 day")
      expect(formatDuration(172800)).toBe("~2 days")
      expect(formatDuration(259200)).toBe("~3 days")
      expect(formatDuration(604799)).toBe("~6 days")
    })

    test("formats weeks", () => {
      expect(formatDuration(604800)).toBe("~1 week")
      expect(formatDuration(1209600)).toBe("~2 weeks")
      expect(formatDuration(1609200)).toBe("~2 weeks")
    })

    test("handles boundary values correctly", () => {
      expect(formatDuration(59)).toBe("59s")
      expect(formatDuration(60)).toBe("1m")
      expect(formatDuration(3599)).toBe("59m 59s")
      expect(formatDuration(3600)).toBe("1h")
      expect(formatDuration(86399)).toBe("23h 59m")
      expect(formatDuration(86400)).toBe("~1 day")
      expect(formatDuration(604799)).toBe("~6 days")
      expect(formatDuration(604800)).toBe("~1 week")
    })
  })
})
