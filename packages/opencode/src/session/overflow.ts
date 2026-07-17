import type { Config } from "@/config"
import type { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import type { MessageV2 } from "./message-v2"

const DEFAULT_REBUILD_HEADROOM = 20_000

function tokenCount(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + (tokens.reasoning ?? 0) + tokens.cache.read + tokens.cache.write
}

export function contextBudget(input: { cfg: Config.Info; model: Provider.Model; output?: number }) {
  const context = input.model.limit.context
  const output = Math.min(context, input.output ?? ProviderTransform.maxOutputTokens(input.model))
  const physicalInput = Math.min(input.model.limit.input ?? Number.POSITIVE_INFINITY, Math.max(0, context - output))
  const headroom =
    input.cfg.compaction?.reserved ?? Math.min(DEFAULT_REBUILD_HEADROOM, ProviderTransform.maxOutputTokens(input.model))

  return {
    context,
    output,
    input: Number.isFinite(physicalInput) ? physicalInput : 0,
    target: Math.max(0, physicalInput - headroom),
  }
}

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  return contextBudget(input).input
}

export function rebuildTarget(input: { cfg: Config.Info; model: Provider.Model }) {
  return contextBudget(input).target
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  return tokenCount(input.tokens) >= usable(input)
}

export function pressureLevel(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
}): 0 | 1 | 2 | 3 {
  if (input.cfg.compaction?.auto === false) return 0
  if (input.model.limit.context === 0) return 0

  const limit = usable(input)
  if (limit === 0) return 0

  const ratio = tokenCount(input.tokens) / limit
  if (ratio < 0.5) return 0
  if (ratio < 0.7) return 1
  if (ratio < 0.85) return 2
  return 3
}
