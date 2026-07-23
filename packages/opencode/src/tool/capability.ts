import type { Tool as AITool } from "ai"
import { TOOL_CAPABILITIES, type ToolCapability } from "@adp-ai/plugin/tool"
export type Metadata = {
  capabilities?: readonly ToolCapability[]
  internal?: boolean
}
export type Snapshot = {
  usableToolIDs: readonly string[]
  restricted: boolean
  byCapability: Readonly<Record<ToolCapability, readonly string[]>>
}
const ORDER = TOOL_CAPABILITIES
const LABEL: Record<ToolCapability, string> = {
  "web-search": "Web search",
  "web-fetch": "Web fetch",
  "code-search": "Code/documentation search",
}
const KNOWN_TOOL_CAPABILITY: Record<string, ToolCapability> = {
  websearch: "web-search",
  webfetch: "web-fetch",
  codesearch: "code-search",
}
const store = new WeakMap<object, Metadata>()
const EMPTY: Metadata = Object.freeze({})
function canonical(input: string) {
  return input.replace(/[-_\s]+/g, "").toLowerCase()
}
export function annotate<T extends object>(tool: T, value: Metadata): T {
  if (value.capabilities?.length || value.internal) {
    store.set(tool, {
      ...(value.capabilities?.length ? { capabilities: [...new Set(value.capabilities)] } : {}),
      ...(value.internal ? { internal: true } : {}),
    })
  }
  return tool
}
export function metadata(tool: object): Metadata {
  return store.get(tool) ?? EMPTY
}
export function isInternal(tool: object): boolean {
  return metadata(tool).internal === true
}

export function isRuntimeUsable(input: {
  toolID: string
  internal?: boolean
  whitelist?: ReadonlySet<string>
}): boolean {
  return input.internal === true || input.whitelist === undefined || input.whitelist.has(input.toolID)
}

export function snapshot(input: {
  tools: Readonly<Record<string, AITool>>
  usableToolIDs?: readonly string[]
}): Snapshot {
  const visible = Object.keys(input.tools).filter((id) => !isInternal(input.tools[id]!))
  const requested = input.usableToolIDs ? new Set(input.usableToolIDs) : undefined
  const usable = visible.filter((id) => !requested || requested.has(id)).toSorted()
  const allowed = new Set(usable)
  const byCapability: Record<ToolCapability, string[]> = {
    "web-search": [],
    "web-fetch": [],
    "code-search": [],
  }
  for (const [id, tool] of Object.entries(input.tools)) {
    if (!allowed.has(id)) continue
    for (const capability of metadata(tool).capabilities ?? []) byCapability[capability].push(id)
  }
  for (const capability of ORDER) byCapability[capability].sort()
  return {
    usableToolIDs: usable,
    restricted: requested !== undefined && usable.length !== visible.length,
    byCapability,
  }
}
export function capabilityForTool(toolID: string): ToolCapability | undefined {
  return KNOWN_TOOL_CAPABILITY[canonical(toolID)]
}
export function alternatives(toolID: string, current: Snapshot): readonly string[] {
  const capability = capabilityForTool(toolID)
  return capability ? current.byCapability[capability] : []
}
export function render(current: Snapshot): string {
  const lines = [
    "<tool-contract>",
    "The active tool schemas and this runtime contract are the sole authority for tool use in this request.",
    "Call only exact tool IDs that are active and runtime-usable. A tool mentioned elsewhere in system text, skills, workflows, or history is unavailable when it is absent from the active schemas or runtime whitelist.",
  ]
  if (current.restricted) {
    lines.push(
      current.usableToolIDs.length
        ? `Runtime-usable tool IDs: ${current.usableToolIDs.map((id) => `\`${id}\``).join(", ")}.`
        : "No tools are runtime-usable in this request.",
    )
  }
  for (const capability of ORDER) {
    const ids = current.byCapability[capability]
    lines.push(
      ids.length
        ? `${LABEL[capability]} is available via: ${ids.map((id) => `\`${id}\``).join(", ")}.`
        : `${LABEL[capability]} is unavailable in this request.`,
    )
  }
  const editing = ["apply_patch", "edit", "write", "multiedit", "notebook_edit"].filter((id) =>
    current.usableToolIDs.includes(id),
  )
  lines.push(
    editing.length
      ? `File editing is available via: ${editing.map((id) => `\`${id}\``).join(", ")}.`
      : "File editing is unavailable in this request.",
  )
  lines.push(
    "Use each tool's declared schema exactly; do not invent aliases or substitute a different tool by name similarity.",
  )
  lines.push("</tool-contract>")
  return lines.join("\n")
}
