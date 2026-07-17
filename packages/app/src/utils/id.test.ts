import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "./id"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value })
}

afterEach(() => {
  if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  else Reflect.deleteProperty(globalThis, "crypto")
})

describe("Identifier", () => {
  test("uses rejection sampling for unbiased base62 output", () => {
    let calls = 0
    setCrypto({
      getRandomValues(array: Uint8Array) {
        array.fill(calls++ === 0 ? 255 : 0)
        return array
      },
    })

    const id = Identifier.ascending("session")
    expect(calls).toBe(2)
    expect(id.slice(-14)).toBe("0".repeat(14))
  })

  test("fails closed when secure randomness is unavailable", () => {
    setCrypto({})
    expect(() => Identifier.ascending("message")).toThrow(/Secure random/)
  })
})
