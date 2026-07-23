import { randomUUID } from "node:crypto"

export const instanceID = randomUUID()
export const pid = process.pid
export const startedAt = Date.now()

export function alive(target: number) {
  if (target === pid) return true
  try {
    process.kill(target, 0)
    return true
  } catch {
    return false
  }
}

export * as ProcessIdentity from "./process"
