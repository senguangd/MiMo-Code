import z from "zod"
import { asSchema, type ModelMessage, type Tool } from "ai"
import { ModelID, ProviderID } from "@/provider/schema"
import { Cause } from "effect"
import { Log, Token } from "@/util"

const log = Log.create({ service: "session.context-estimate" })

export const Info = z.object({
  tokens: z.number().int().nonnegative(),
  basis: z.enum(["post-compaction", "post-rebuild", "pending-request"]),
  providerID: ProviderID.zod,
  modelID: ModelID.zod,
  calculatedAt: z.number(),
})
export type Info = z.infer<typeof Info>

type Input = Omit<Info, "tokens" | "calculatedAt"> & {
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, Tool>
}

export function shouldPropagateEstimateCause<E>(cause: Cause.Cause<E>): boolean {
  return Cause.hasInterrupts(cause)
}

export async function estimateContext(input: Input): Promise<Info> {
  const tools = await Promise.all(
    Object.entries(input.tools)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(async ([name, item]) => ({
        name,
        description: "description" in item ? item.description : undefined,
        inputSchema:
          "inputSchema" in item && item.inputSchema
            ? await Promise.resolve(asSchema(item.inputSchema).jsonSchema)
            : undefined,
        providerOptions: "providerOptions" in item ? item.providerOptions : undefined,
      })),
  )
  const tokens = Token.estimate(JSON.stringify({ system: input.system, messages: input.messages, tools }))
  log.debug("calculated", {
    basis: input.basis,
    providerID: input.providerID,
    modelID: input.modelID,
    tokens,
    systemParts: input.system.length,
    messages: input.messages.length,
    tools: tools.length,
  })
  return {
    tokens,
    basis: input.basis,
    providerID: input.providerID,
    modelID: input.modelID,
    calculatedAt: Date.now(),
  }
}

export * as ContextEstimate from "./context-estimate"
