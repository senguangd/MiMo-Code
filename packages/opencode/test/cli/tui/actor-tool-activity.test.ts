import { describe, expect, test } from "bun:test"
import { actorToolActivity } from "../../../src/cli/cmd/tui/routes/session/index"

const completed = {
  tool: "write",
  state: {
    status: "completed" as const,
    input: {},
    output: "ok",
    title: "DashboardPage.vue",
    metadata: {},
    time: { start: 1, end: 2 },
  },
}

describe("actor tool activity", () => {
  test("completed status check is not rendered as an active task", () => {
    const result = actorToolActivity({
      action: "status",
      actorStatus: "running",
      partStatus: "completed",
      tools: [completed],
    })
    expect(result.running).toBe(false)
    expect(result.current).toBeUndefined()
  })

  test("last completed write is not treated as current work", () => {
    const result = actorToolActivity({
      action: "spawn",
      actorStatus: "running",
      partStatus: "completed",
      tools: [completed],
    })
    expect(result.running).toBe(true)
    expect(result.current).toBeUndefined()
    expect(result.lastCompleted?.state.status).toBe("completed")
    if (result.lastCompleted?.state.status === "completed")
      expect(result.lastCompleted.state.title).toBe("DashboardPage.vue")
  })
})
