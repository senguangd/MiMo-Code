export type ReasoningDisplayState = "none" | "visible" | "hidden" | "unavailable"

export function reasoningDisplayState(input: {
  showSummaries: boolean
  hasSummary: boolean
  reasoningTokens: number
}): ReasoningDisplayState {
  if (input.hasSummary) return input.showSummaries ? "visible" : "hidden"
  if (input.reasoningTokens > 0) return "unavailable"
  return "none"
}
