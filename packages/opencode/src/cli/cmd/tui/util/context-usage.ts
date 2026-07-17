import type { Message, Part } from "@mimo-ai/sdk/v2"

export type ContextUsage =
  | { kind: "live"; input: number; reserved: number; limit: number; inputLimit: number }
  | { kind: "last"; input: number; reserved: null; limit?: number }
  | { kind: "invalidated" }

type Input = {
  messages: readonly Message[]
  parts: (messageID: string) => readonly Part[]
  live?: { input: number; output: number; limit: number; inputLimit: number }
  contextLimit: (providerID: string, modelID: string) => number | undefined
}

export function resolveContextUsage(input: Input): ContextUsage | undefined {
  if (input.live) {
    return {
      kind: "live",
      input: input.live.input,
      reserved: input.live.output,
      limit: input.live.limit,
      inputLimit: input.live.inputLimit,
    }
  }

  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i]
    if (message.role === "user") {
      if (input.parts(message.id).some((part) => part.type === "checkpoint" || part.type === "compaction")) {
        return { kind: "invalidated" }
      }
      continue
    }

    if (message.summary) return { kind: "invalidated" }
    if (message.time.completed === undefined) continue

    const tokens = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
    if (tokens <= 0) continue

    return {
      kind: "last",
      input: tokens,
      reserved: null,
      limit: input.contextLimit(message.providerID, message.modelID),
    }
  }
}
