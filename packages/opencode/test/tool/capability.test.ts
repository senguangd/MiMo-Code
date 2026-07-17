import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import z from "zod"
import * as ToolCapabilities from "../../src/tool/capability"
function makeTool() {
  return tool({
    description: "test",
    inputSchema: z.object({}),
  })
}
describe("tool.capability", () => {
  test("builds a stable snapshot from explicit metadata only", () => {
    const tools = {
      webfetch: ToolCapabilities.annotate(makeTool(), { capabilities: ["web-fetch"] }),
      duckduckgo_search: ToolCapabilities.annotate(makeTool(), { capabilities: ["web-search"] }),
      search_files: makeTool(),
      invalid: ToolCapabilities.annotate(makeTool(), { internal: true }),
    }
    const snapshot = ToolCapabilities.snapshot({ tools })
    expect(snapshot.usableToolIDs).toEqual(["duckduckgo_search", "search_files", "webfetch"])
    expect(snapshot.byCapability["web-search"]).toEqual(["duckduckgo_search"])
    expect(snapshot.byCapability["web-fetch"]).toEqual(["webfetch"])
    expect(snapshot.byCapability["code-search"]).toEqual([])
    expect(ToolCapabilities.metadata(tools.search_files).capabilities).toBeUndefined()
    expect(ToolCapabilities.render(snapshot)).toContain("Web search is available via: `duckduckgo_search`.")
    expect(ToolCapabilities.render(snapshot)).not.toContain("`invalid`")
  })
  test("intersects visible schemas with the runtime whitelist", () => {
    const tools = {
      read: makeTool(),
      websearch: ToolCapabilities.annotate(makeTool(), { capabilities: ["web-search"] }),
      invalid: ToolCapabilities.annotate(makeTool(), { internal: true }),
    }
    const snapshot = ToolCapabilities.snapshot({ tools, usableToolIDs: ["read"] })
    expect(snapshot.restricted).toBe(true)
    expect(snapshot.usableToolIDs).toEqual(["read"])
    expect(snapshot.byCapability["web-search"]).toEqual([])
    expect(ToolCapabilities.render(snapshot)).toContain("Runtime-usable tool IDs: `read`.")
    expect(ToolCapabilities.render(snapshot)).toContain("Web search is unavailable in this request.")
  })
  test("keeps internal framework tools usable under a runtime whitelist", () => {
    const whitelist = new Set(["read"])

    expect(ToolCapabilities.isRuntimeUsable({ toolID: "read", whitelist })).toBe(true)
    expect(ToolCapabilities.isRuntimeUsable({ toolID: "websearch", whitelist })).toBe(false)
    expect(ToolCapabilities.isRuntimeUsable({ toolID: "invalid", internal: true, whitelist })).toBe(true)
  })

  test("offers declared alternatives without aliasing unknown tools", () => {
    const tools = {
      duckduckgo_search: ToolCapabilities.annotate(makeTool(), { capabilities: ["web-search"] }),
    }
    const snapshot = ToolCapabilities.snapshot({ tools })
    expect(ToolCapabilities.alternatives("WebSearch", snapshot)).toEqual(["duckduckgo_search"])
    expect(ToolCapabilities.alternatives("some_search_tool", snapshot)).toEqual([])
  })
})
