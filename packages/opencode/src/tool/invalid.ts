import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"

const Parameters = z.object({
  kind: z.enum(["tool_unavailable", "invalid_arguments"]),
  tool: z.string(),
  error: z.string(),
  alternatives: z.array(z.string()).optional(),
})
export type InvalidInput = z.infer<typeof Parameters>

export function renderFailure(params: InvalidInput) {
  if (params.kind === "invalid_arguments") {
    return {
      title: "Invalid tool arguments",
      output: `Invalid arguments for tool ${params.tool}: ${params.error}`,
    }
  }
  const alternatives = params.alternatives?.length
    ? ` Available tools with the same declared capability: ${params.alternatives.join(", ")}.`
    : ""
  return {
    title: "Tool unavailable",
    output: `Tool unavailable: ${params.tool}. ${params.error}${alternatives}`,
  }
}

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    internal: true,
    description: "Do not use",
    parameters: Parameters,
    execute: (params: InvalidInput) => {
      const rendered = renderFailure(params)
      return Effect.succeed({
        ...rendered,
        metadata: { reason: params.kind },
      })
    },
  }),
)
