export type Backend = { kind: "xiaomi-native"; apiKey: string } | { kind: "exa" }
export function resolve(input: {
  providerID: string
  xiaomiApiKey?: string
  exaEnabled: boolean
}): Backend | undefined {
  if (input.providerID === "xiaomi" && input.xiaomiApiKey) {
    return { kind: "xiaomi-native", apiKey: input.xiaomiApiKey }
  }
  if (input.providerID === "opencode" || input.exaEnabled) return { kind: "exa" }
  return undefined
}
