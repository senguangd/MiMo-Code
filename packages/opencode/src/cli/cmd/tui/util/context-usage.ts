import type { Message, Part } from "@mimo-ai/sdk/v2"

type Estimate = {
  tokens: number
  basis: "post-compaction" | "post-rebuild" | "pending-request"
  providerID: string
  modelID: string
}

export type ContextUsage =
  | { kind: "current"; tokens: number; limit?: number }
  | { kind: "estimated"; tokens: number; basis: Estimate["basis"]; limit?: number }
  | { kind: "invalidated" }

type Input = {
  messages: readonly Message[]
  parts: (messageID: string) => readonly Part[]
  estimate?: Estimate
  contextLimit: (providerID: string, modelID: string) => number | undefined
}

function estimated(input: Input, value: Estimate): ContextUsage {
  return {
    kind: "estimated",
    tokens: value.tokens,
    basis: value.basis,
    limit: input.contextLimit(value.providerID, value.modelID),
  }
}

export function resolveContextUsage(input: Input): ContextUsage | undefined {
  if (input.estimate) return estimated(input, input.estimate)

  let invalidated = false
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i]
    if (message.role === "user") {
      const boundary = input
        .parts(message.id)
        .find((part) => part.type === "checkpoint" || part.type === "compaction")
      if (!boundary) continue
      if (boundary.context_estimate) return estimated(input, boundary.context_estimate)
      return { kind: "invalidated" }
    }

    if (message.summary) {
      invalidated = true
      continue
    }
    if (invalidated || message.time.completed === undefined) continue

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
  return invalidated ? { kind: "invalidated" } : undefined
}
