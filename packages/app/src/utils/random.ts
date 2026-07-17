export function secureRandomBytes(length: number) {
  if (!Number.isSafeInteger(length) || length < 0)
    throw new RangeError("Random byte length must be a non-negative integer")
  const crypto = globalThis.crypto
  if (!crypto || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random number generation is unavailable")
  }

  const result = new Uint8Array(length)
  for (let offset = 0; offset < result.length; offset += 65_536) {
    crypto.getRandomValues(result.subarray(offset, Math.min(offset + 65_536, result.length)))
  }
  return result
}
