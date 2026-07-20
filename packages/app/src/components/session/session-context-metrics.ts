import type { AssistantMessage, Message, Part, SessionStatus } from "@mimo-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: { context: number }
}

type Estimate = {
  tokens: number
  basis: "post-compaction" | "post-rebuild" | "pending-request"
  providerID: string
  modelID: string
  calculatedAt: number
}

type Context = {
  kind: "measured" | "estimated"
  basis?: Estimate["basis"]
  message?: AssistantMessage
  calculatedAt?: number
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number | undefined
  output: number | undefined
  reasoning: number | undefined
  cacheRead: number | undefined
  cacheWrite: number | undefined
  total: number
  usage: number | null
}

type Metrics = { totalCost: number; context: Context | undefined }

type Options = {
  parts?: Record<string, readonly Part[] | undefined>
  status?: SessionStatus
}

const contextTokenTotal = (msg: AssistantMessage) =>
  msg.tokens.total ||
  msg.tokens.input + msg.tokens.cache.read + msg.tokens.cache.write + msg.tokens.output + msg.tokens.reasoning

function statusEstimate(status: SessionStatus | undefined): Estimate | undefined {
  if (!status || status.type === "idle") return undefined
  return status.contextEstimate
}

function contextSource(messages: Message[], options: Options) {
  const pending = statusEstimate(options.status)
  if (pending) return { type: "estimated" as const, estimate: pending }

  let invalidated = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "user") {
      const boundary = options.parts?.[message.id]?.find(
        (part) => part.type === "checkpoint" || part.type === "compaction",
      )
      if (!boundary) continue
      if (boundary.context_estimate) return { type: "estimated" as const, estimate: boundary.context_estimate }
      return undefined
    }
    if (message.summary) {
      invalidated = true
      continue
    }
    if (invalidated || contextTokenTotal(message) <= 0) continue
    return { type: "measured" as const, message }
  }
  return undefined
}

function labels(providerID: string, modelID: string, providers: Provider[]) {
  const provider = providers.find((item) => item.id === providerID)
  const model = provider?.models[modelID]
  return {
    provider,
    model,
    providerLabel: provider?.name ?? providerID,
    modelLabel: model?.name ?? modelID,
    limit: model?.limit.context,
  }
}

const build = (messages: Message[] = [], providers: Provider[] = [], options: Options = {}): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const source = contextSource(messages, options)
  if (!source) return { totalCost, context: undefined }

  if (source.type === "estimated") {
    const estimate = source.estimate
    const meta = labels(estimate.providerID, estimate.modelID, providers)
    return {
      totalCost,
      context: {
        kind: "estimated",
        basis: estimate.basis,
        calculatedAt: estimate.calculatedAt,
        ...meta,
        input: undefined,
        output: undefined,
        reasoning: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
        total: estimate.tokens,
        usage: meta.limit ? Math.round((estimate.tokens / meta.limit) * 100) : null,
      },
    }
  }

  const message = source.message
  const meta = labels(message.providerID, message.modelID, providers)
  const total = contextTokenTotal(message)
  return {
    totalCost,
    context: {
      kind: "measured",
      message,
      ...meta,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: meta.limit ? Math.round((total / meta.limit) * 100) : null,
    },
  }
}

export function getSessionContextMetrics(
  messages: Message[] = [],
  providers: Provider[] = [],
  options: Options = {},
) {
  return build(messages, providers, options)
}
