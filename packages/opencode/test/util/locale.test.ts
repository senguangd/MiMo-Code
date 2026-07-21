import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util"

describe("Locale timestamp precision", () => {
  test("keeps existing callers minute-precise by default", () => {
    const input = Date.now()
    expect(Locale.time(input)).toBe(new Date(input).toLocaleTimeString(undefined, { timeStyle: "short" }))
  })

  test("formats explicit second precision without milliseconds", () => {
    const input = Date.now()
    const expected = new Date(input).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    })
    expect(Locale.time(input, "second")).toBe(expected)
    expect(Locale.time(input, "second")).not.toMatch(/\.\d{3}/)
  })

  test("uses second precision for today's session timestamp", () => {
    const input = Date.now()
    expect(Locale.todayTimeOrDateTime(input, "second")).toBe(
      new Date(input).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    )
  })

  test("includes both second-precise time and date for older messages", () => {
    const input = Date.now() - 3 * 24 * 60 * 60 * 1000
    const date = new Date(input)
    const expectedTime = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    })
    expect(Locale.todayTimeOrDateTime(input, "second")).toBe(`${expectedTime} · ${date.toLocaleDateString()}`)
  })
})
