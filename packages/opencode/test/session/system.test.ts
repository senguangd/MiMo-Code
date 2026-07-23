import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { Skill } from "../../src/skill"
import { provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system", () => {
  test("uses the dedicated prompt for grcbank/grcb-router-flash", () => {
    const grcbank = SystemPrompt.provider({
      providerID: "grcbank",
      api: { id: "grcb-router-flash" },
    } as Provider.Model)
    const fallback = SystemPrompt.provider({
      providerID: "other",
      api: { id: "grcb-router-flash" },
    } as Provider.Model)

    expect(grcbank).toHaveLength(1)
    expect(grcbank[0]).toContain("smallest complete change")
    expect(grcbank[0]).not.toContain("Claude Code")
    expect(grcbank[0]).not.toBe(fallback[0])
  })

  test("requires Simplified Chinese for grcbank user-facing natural-language responses", async () => {
    await using tmp = await tmpdir({ git: true })
    const systemPromptLayer = SystemPrompt.layer.pipe(
      Layer.provide(Layer.succeed(Provider.Service, {} as Provider.Interface)),
      Layer.provide(Layer.succeed(Skill.Service, {} as Skill.Interface)),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = {
          providerID: "grcbank",
          api: { id: "grcb-router-flash" },
          capabilities: { input: { image: true } },
        } as Provider.Model
        const runEnvironment = Effect.gen(function* () {
          const svc = yield* SystemPrompt.Service
          return yield* svc.environment(model, Date.UTC(2026, 6, 17))
        }).pipe(Effect.provide(systemPromptLayer))

        const prompt = await Effect.runPromise(runEnvironment)

        expect(prompt[1]).toBe(
          "IMPORTANT: All user-facing natural-language responses, including progress updates, explanations, questions, and final answers, MUST be written in Simplified Chinese regardless of the language used by the user. Preserve source code, commands, identifiers, file paths, logs, error messages, quotations, and explicitly requested translations in their original or required language.",
        )
        expect(prompt.join("\n")).not.toContain("same major language as the user")
      },
    })
  })

  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".adpcli", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.HOME
    const userProfile = process.env.USERPROFILE
    process.env.HOME = tmp.path
    process.env.USERPROFILE = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.HOME = home
      process.env.USERPROFILE = userProfile
    }
  })
})
