import { describe, expect, test } from "bun:test"

describe("checkpoint reduction separation", () => {
  test("successful rebuild starts a new checkpoint epoch", async () => {
    const prompt = await Bun.file(`${import.meta.dir}/../../src/session/prompt.ts`).text()
    expect(prompt).toMatch(/if\s*\(inserted\)\s+yield\*\s+prune\.markContextReduced\(input\.sessionID\)/)
  })

  test("checkpoint thresholds never directly trigger context reduction", async () => {
    const prompt = await Bun.file(`${import.meta.dir}/../../src/session/prompt.ts`).text()
    expect(prompt).not.toContain(["maxThreshold", "Crossed"].join(""))
    expect(prompt).toMatch(
      /lastFinished\.summary\s*!==\s*true[\s\S]*?overflowCheck\(\{\s*cfg:[\s\S]*?tokens:\s*lastFinished\.tokens,\s*model\s*\}\)/,
    )
  })

  test("the rebuild branch still skips one stale overflow check before continuing", async () => {
    const prompt = await Bun.file(`${import.meta.dir}/../../src/session/prompt.ts`).text()
    expect(prompt).toMatch(
      /const\s+inserted\s*=\s*yield\*\s+rebuildFromCheckpoint\([\s\S]*?\)\s*\n\s*if\s*\(inserted\)\s*\{\s*\n\s*skipOverflowCheck\s*=\s*true\s*\n\s*continue/,
    )
  })
})
