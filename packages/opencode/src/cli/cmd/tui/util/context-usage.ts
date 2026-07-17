import type { Message, Part } from "@mimo-ai/sdk/v2"

export type ContextUsage = { kind: "current"; tokens: number; limit?: number } | { kind: "invalidated" }

type Input = {
  messages: readonly Message[]
  parts: (messageID: string) => readonly Part[]
  contextLimit: (providerID: string, modelID: string) => number | undefined
}

export function resolveContextUsage(input: Input): ContextUsage | undefined {
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

    const tokens =
      message.tokens.total ||
      message.tokens.input +
        message.tokens.cache.read +
        message.tokens.cache.write +
        message.tokens.output +
        message.tokens.reasoning
    if (tokens <= 0) continue

    return {
      kind: "current",
      tokens,
      limit: input.contextLimit(message.providerID, message.modelID),
    }
  }
  return undefined
}
