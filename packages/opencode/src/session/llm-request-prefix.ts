import { Effect } from "effect"
import { tool, jsonSchema, type Tool as AITool } from "ai"
import z from "zod"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"
import { ModelID } from "../provider/schema"
import { Agent } from "../agent/agent"
import type { Provider } from "../provider"
import { LLM } from "./llm"
import { ToolRegistry } from "../tool"
import { ProviderTransform } from "../provider"
import { Permission } from "../permission"
import { bindToolScript, ToolScriptTool } from "../tool/tool-script"
import * as ToolCapabilities from "../tool/capability"

/**
 * Build the LLM request prefix (system + tools + inheritedMessages) from the
 * given msgs array. Given identical inputs this returns deep-equal output
 * (modulo plugin trigger determinism, which is the only external non-determinism
 * source).
 *
 * Used by:
 *   - parent runLoop, to construct its own request
 *   - tryStartCheckpointWriter, to capture a frozen ForkContext at spawn time
 *
 * Both call sites must use this same function — the byte-equal invariant
 * across parent and fork is a structural consequence, not a separate assertion.
 *
 * Slicing (e.g. for fork capture at a watermark) is a caller concern; callers
 * pass the already-sliced msgs. ForkContext.watermarkMsgID is a boundary marker
 * on the fork context, not a parameter here.
 */
export const buildLLMRequestPrefix = Effect.fn("Session.buildLLMRequestPrefix")(function* (input: {
  sessionID: SessionID
  agent: Agent.Info
  model: Provider.Model
  msgs: MessageV2.WithParts[]
  /**
   * Caller-built system parts to splice into the system array (after agent.prompt
   * and before memory instructions). Currently env, skills, instructions in that
   * order. Caller is responsible for the ordering and content.
   */
  additions: string[]
  permission?: Permission.Ruleset
  toolWhitelist?: readonly string[]
  toolIDs?: readonly string[]
}) {
  const llm = yield* LLM.Service
  const toolRegistry = yield* ToolRegistry.Service

  // Always use full msgs — slicing is a fork-capture concern that lives at the
  // caller (ForkContext.watermarkMsgID is a boundary marker, not a slice arg).
  // See spec changelog at docs/superpowers/specs/2026-05-26-fork-agent-prefix-cache-design.md
  const inheritedMessages = yield* MessageV2.toModelMessagesEffect(input.msgs, input.model)

  // Find the last user message; required for system "user.system" pass-through
  const lastUserMsg = input.msgs.findLast((m) => m.info.role === "user")
  if (!lastUserMsg) return yield* Effect.die(new Error("buildLLMRequestPrefix: no user message in msgs"))
  const lastUser = lastUserMsg.info as MessageV2.User

  // Build system using LLM.buildSystemArray (single source of truth shared with stream())
  const system = yield* llm.buildSystemArray({
    agent: input.agent,
    model: input.model,
    system: input.additions,
    user: lastUser,
    sessionID: input.sessionID as string,
    agentID: lastUser.agentID,
  })

  // Resolve the request-visible definitions from model, permission, user overrides, and any runtime whitelist
  const toolDefs = yield* toolRegistry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })
  const disabled = Permission.disabled(
    toolDefs.map((item) => item.id),
    Agent.runtimePermission(input.agent, input.permission),
  )
  const whitelist = input.toolWhitelist ? new Set(input.toolWhitelist) : undefined
  const requested = input.toolIDs ? new Set(input.toolIDs) : undefined
  const effective = toolDefs.filter(
    (item) =>
      item.internal ||
      ((!whitelist || whitelist.has(item.id)) &&
        (!requested || requested.has(item.id)) &&
        lastUser.tools?.[item.id] !== false &&
        !disabled.has(item.id)),
  )
  const bound = effective.map((item) =>
    item.id === ToolScriptTool.id ? bindToolScript({ tool: item, defs: effective }) : item,
  )
  const tools: Record<string, AITool> = {}
  for (const item of bound) {
    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = ToolCapabilities.annotate(
      tool({
        description: item.description,
        inputSchema: jsonSchema(schema),
      }),
      { capabilities: item.capabilities, internal: item.internal },
    )
  }

  return { system, tools, inheritedMessages }
})
