import { afterEach, describe, expect, test } from "bun:test"
import { uuid } from "./uuid"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value })
}

function zeroRandomValues(array: Uint8Array) {
  array.fill(0)
  return array
}

afterEach(() => {
  if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  else Reflect.deleteProperty(globalThis, "crypto")
})

describe("uuid", () => {
  test("uses randomUUID when available", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })

  test("builds an RFC 4122 v4 UUID from getRandomValues when randomUUID throws", () => {
    setCrypto({
      randomUUID: () => {
        throw new DOMException("Failed", "OperationError")
      },
      getRandomValues: zeroRandomValues,
    })
    expect(uuid()).toBe("00000000-0000-4000-8000-000000000000")
  })

  test("uses getRandomValues when randomUUID is unavailable", () => {
    setCrypto({ getRandomValues: zeroRandomValues })
    expect(uuid()).toBe("00000000-0000-4000-8000-000000000000")
  })

  test("fails closed when secure randomness is unavailable", () => {
    setCrypto({})
    expect(() => uuid()).toThrow(/Secure random/)
  })
})
