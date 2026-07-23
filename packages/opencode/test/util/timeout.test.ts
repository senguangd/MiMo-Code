import { describe, expect, test } from "bun:test"
import { withTimeout } from "../../src/util/timeout"

describe("util.timeout", () => {
  test("should resolve when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast"), 10)
    })

    const result = await withTimeout(fastPromise, 100)
    expect(result).toBe("fast")
  })

  test("should reject when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 200)
    })

    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("Operation timed out after 50ms")
  })

  test("uses a caller-provided timeout message", async () => {
    await expect(withTimeout(new Promise(() => {}), 1, "custom timeout")).rejects.toThrow("custom timeout")
  })

  test("clears the deadline timer when the wrapped promise rejects early", async () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const handle = {} as ReturnType<typeof setTimeout>
    let cleared = false

    globalThis.setTimeout = ((..._args: Parameters<typeof setTimeout>) => handle) as typeof setTimeout
    globalThis.clearTimeout = ((value: ReturnType<typeof setTimeout>) => {
      if (value === handle) cleared = true
    }) as typeof clearTimeout

    try {
      const error = new Error("early failure")
      await expect(withTimeout(Promise.reject(error), 100)).rejects.toThrow("early failure")
      expect(cleared).toBe(true)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }
  })
})
