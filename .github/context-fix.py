from __future__ import annotations

import re
from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrences, found {actual}: {old[:120]!r}")
    file.write_text(text.replace(old, new))


def replace_re(path: str, pattern: str, replacement: str, count: int = 1, flags: int = 0) -> None:
    file = Path(path)
    text = file.read_text()
    result, actual = re.subn(pattern, replacement, text, count=count, flags=flags)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} regex matches, found {actual}: {pattern[:120]!r}")
    file.write_text(result)


Path("packages/opencode/src/session/overflow.ts").write_text(
r'''import type { Config } from "@/config"
import type { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import type { MessageV2 } from "./message-v2"

const DEFAULT_REBUILD_HEADROOM = 20_000

function tokenCount(tokens: MessageV2.Assistant["tokens"]) {
  return (
    tokens.total ||
    tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  )
}

export function contextBudget(input: {
  cfg: Config.Info
  model: Provider.Model
  output?: number
}) {
  const context = input.model.limit.context
  const output = Math.min(context, input.output ?? ProviderTransform.maxOutputTokens(input.model))
  const physicalInput = Math.min(
    input.model.limit.input ?? Number.POSITIVE_INFINITY,
    Math.max(0, context - output),
  )
  const headroom =
    input.cfg.compaction?.reserved ??
    Math.min(DEFAULT_REBUILD_HEADROOM, ProviderTransform.maxOutputTokens(input.model))

  return {
    context,
    output,
    input: Number.isFinite(physicalInput) ? physicalInput : 0,
    target: Math.max(0, physicalInput - headroom),
  }
}

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  return contextBudget(input).input
}

export function rebuildTarget(input: { cfg: Config.Info; model: Provider.Model }) {
  return contextBudget(input).target
}

export function isOverflow(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  return tokenCount(input.tokens) >= usable(input)
}

export function pressureLevel(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
}): 0 | 1 | 2 | 3 {
  if (input.cfg.compaction?.auto === false) return 0
  if (input.model.limit.context === 0) return 0

  const limit = usable(input)
  if (limit === 0) return 0

  const ratio = tokenCount(input.tokens) / limit
  if (ratio < 0.50) return 0
  if (ratio < 0.70) return 1
  if (ratio < 0.85) return 2
  return 3
}
'''
)

replace(
    "packages/opencode/src/session/llm.ts",
    'import { isRetryableTransientError } from "./retry"\n',
    'import { isRetryableTransientError } from "./retry"\nimport { contextBudget } from "./overflow"\n',
)
replace(
    "packages/opencode/src/session/llm.ts",
    '''export type ContextUsage = {
  input: number
  output: number
  limit: number
}
''',
    '''export type ContextUsage = {
  input: number
  output: number
  limit: number
  inputLimit: number
}
''',
)
replace(
    "packages/opencode/src/session/llm.ts",
    '''                const context = {
                  input: counted.tokens,
                  output: call.maxOutputTokens ?? ProviderTransform.maxOutputTokens(input.model),
                  limit: input.model.limit.context,
                }
                await input.onContextUsage?.(context)
                if (context.limit === 0) return doStream()

                const inputLimit = Math.min(
                  input.model.limit.input ?? Number.POSITIVE_INFINITY,
                  Math.max(0, context.limit - context.output),
                )
                if (context.input > inputLimit) {
                  const message = `Input requires ${context.input} tokens, but only ${inputLimit} are available after reserving ${context.output} output tokens.`
''',
    '''                const output = call.maxOutputTokens ?? ProviderTransform.maxOutputTokens(input.model)
                const budget = contextBudget({ cfg, model: input.model, output })
                const context = {
                  input: counted.tokens,
                  output,
                  limit: budget.context,
                  inputLimit: budget.input,
                }
                await input.onContextUsage?.(context)
                if (context.limit === 0) return doStream()

                if (context.input > context.inputLimit) {
                  const message = `Input requires ${context.input} tokens, but only ${context.inputLimit} are available after reserving ${context.output} output tokens.`
''',
)
replace(
    "packages/opencode/src/session/status.ts",
    '''          input: z.number(),
          output: z.number(),
          limit: z.number(),
''',
    '''          input: z.number(),
          output: z.number(),
          limit: z.number(),
          inputLimit: z.number(),
''',
)

replace(
    "packages/opencode/src/cli/cmd/tui/util/context-usage.ts",
    '''export type ContextUsage =
  | { kind: "live"; input: number; reserved: number; limit: number }
  | { kind: "last"; input: number; reserved: null; limit?: number }
  | { kind: "invalidated" }
''',
    '''export type ContextUsage =
  | { kind: "live"; input: number; reserved: number; limit: number; inputLimit: number }
  | { kind: "last"; input: number; reserved: null; limit?: number }
  | { kind: "invalidated" }
''',
)
replace(
    "packages/opencode/src/cli/cmd/tui/util/context-usage.ts",
    '  live?: { input: number; output: number; limit: number }\n',
    '  live?: { input: number; output: number; limit: number; inputLimit: number }\n',
)
replace(
    "packages/opencode/src/cli/cmd/tui/util/context-usage.ts",
    '''      reserved: input.live.output,
      limit: input.live.limit,
''',
    '''      reserved: input.live.output,
      limit: input.live.limit,
      inputLimit: input.live.inputLimit,
''',
)

replace(
    "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
    '    const live = (status() as { context?: { input: number; output: number; limit: number } }).context\n',
    '    const live = (status() as { context?: { input: number; output: number; limit: number; inputLimit: number } }).context\n',
)
replace(
    "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
    '''              context.limit ? `(${Math.round((context.input / context.limit) * 100)}%)` : undefined,
''',
    '''              (context.kind === "live" ? context.inputLimit : context.limit)
                ? `(${Math.round(
                    (context.input / (context.kind === "live" ? context.inputLimit : context.limit!)) * 100,
                  )}%)`
                : undefined,
''',
)

replace(
    "packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx",
    '''type Reading = Exclude<ContextUsage, { kind: "invalidated" }>

function reservedTokens(usage: Reading) {
  return usage.kind === "live" ? usage.reserved : 0
}
''',
    '''type Reading = Exclude<ContextUsage, { kind: "invalidated" }>

function inputLimit(usage: Reading) {
  return usage.kind === "live" ? usage.inputLimit : usage.limit
}
''',
)
replace(
    "packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx",
    '''      | { type: string; context?: { input: number; output: number; limit: number } }
''',
    '''      | { type: string; context?: { input: number; output: number; limit: number; inputLimit: number } }
''',
)
replace(
    "packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx",
    '''            <Show when={usage().limit}>
              {(limit) => (
                <text fg={theme().textMuted}>
                  {Math.round(((usage().input + reservedTokens(usage())) / limit()) * 100)}%{" "}
                  {usage().kind === "live" ? "budget used" : "used (last request)"}
                </text>
              )}
            </Show>
''',
    '''            <Show when={inputLimit(usage())}>
              {(limit) => (
                <text fg={theme().textMuted}>
                  {Math.round((usage().input / limit()) * 100)}%{" "}
                  {usage().kind === "live" ? "effective input used" : "used (last request)"}
                </text>
              )}
            </Show>
            <Show when={usage().kind === "live" ? usage().inputLimit : null}>
              {(limit) => <text fg={theme().textMuted}>{limit().toLocaleString()} effective input limit</text>}
            </Show>
''',
)

replace(
    "packages/opencode/src/session/prune.ts",
    '''  /** True when the current tokens have just crossed the max checkpoint threshold. */
  readonly maxThresholdCrossed: (sessionID: SessionID) => Effect.Effect<boolean>
  /** Clear the crossed-threshold state for a session (e.g. after discard+rebuild). */
  readonly resetThresholds: (sessionID: SessionID) => Effect.Effect<void>
''',
    '''  /** Clear checkpoint progress without changing the current context epoch. */
  readonly resetThresholds: (sessionID: SessionID) => Effect.Effect<void>
  /** Start a new context epoch; the next measured request becomes its baseline. */
  readonly markContextReduced: (sessionID: SessionID) => Effect.Effect<void>
''',
)
replace(
    "packages/opencode/src/session/prune.ts",
    '''    // Per-session state: which checkpoint thresholds have already been crossed
    // (and had a checkpoint writer enqueued). Prevents re-firing on the same
    // threshold every turn.
    const crossed = new Map<SessionID, Set<number>>()
    // Per-session signal: the max threshold was just crossed; prompt.ts should
    // trigger discard+rebuild on the next loop iteration.
    const maxCrossed = new Set<SessionID>()
''',
    '''    type CheckpointProgress = {
      baseline: number
      last: number
      crossed: Set<number>
      pendingBaseline: boolean
    }

    // Checkpoint thresholds measure growth inside the current model-visible
    // context epoch. A rebuild/compaction starts a new epoch so the context
    // injected by the reduction itself cannot immediately retrigger writers.
    const progress = new Map<SessionID, CheckpointProgress>()
''',
)
replace_re(
    "packages/opencode/src/session/prune.ts",
    r'''    // Fires a checkpoint write for every threshold newly crossed by the
    // current token count\. Exposed publicly so runLoop can call it at each
    // iteration to catch mid-turn threshold crossings \(not just turn end\)\.
    const fireCheckpoints = Effect\.fn\("SessionPrune\.fireCheckpoints"\)\(function\* \(input: \{
.*?    \}\)

    // Each turn end, decide''',
    '''    // Fires at most one checkpoint for the highest newly-crossed threshold.
    // One checkpoint at the latest watermark subsumes all lower thresholds.
    const fireCheckpoints = Effect.fn("SessionPrune.fireCheckpoints")(function* (input: {
      sessionID: SessionID
      model: Provider.Model
      tokens: MessageV2.Assistant["tokens"]
      promptOps: ActorPromptOps
      agentID?: string
    }) {
      if (!(yield* actorReg.servesCheckpoint(input.sessionID, input.agentID))) return

      const cfg = yield* config.get()
      const windowSize = usable({ cfg, model: input.model })
      if (windowSize === 0) return
      const thresholds = resolveThresholds(
        cfg.checkpoint?.thresholds ?? defaultThresholdsFor(windowSize),
        windowSize,
        cfg.checkpoint?.reserved,
      )
      if (thresholds.length === 0) return

      const current =
        input.tokens.total ??
        input.tokens.input +
          input.tokens.output +
          input.tokens.reasoning +
          input.tokens.cache.read +
          input.tokens.cache.write
      const state =
        progress.get(input.sessionID) ??
        ({ baseline: 0, last: 0, crossed: new Set<number>(), pendingBaseline: false } satisfies CheckpointProgress)

      if (state.pendingBaseline || current < state.last) {
        state.baseline = current
        state.last = current
        state.crossed.clear()
        state.pendingBaseline = false
        progress.set(input.sessionID, state)
        log.info("checkpoint epoch baseline established", { sessionID: input.sessionID, baseline: current })
        return
      }

      state.last = current
      progress.set(input.sessionID, state)
      if (yield* checkpoint.isWriterRunning(input.sessionID)) return

      const growth = current - state.baseline
      const threshold = thresholds.findLast((value) => growth >= value && !state.crossed.has(value))
      if (threshold === undefined) return

      const outcome = yield* checkpoint
        .tryStartCheckpointWriter({
          sessionID: input.sessionID,
          model: { providerID: input.model.providerID, modelID: input.model.id },
          promptOps: input.promptOps,
        })
        .pipe(Effect.catch(() => Effect.succeed<"started" | "queued" | "skipped">("skipped")))
      if (outcome === "skipped") return

      for (const value of thresholds) {
        if (value > threshold) break
        state.crossed.add(value)
      }
      log.info("checkpoint triggered", { threshold, growth, current })

      if (outcome !== "started") return
      const maxFailures = cfg.checkpoint?.max_writer_failures ?? MAX_WRITER_FAILURES
      yield* Effect.gen(function* () {
        const result = yield* checkpoint.waitForWriter(input.sessionID)
        if (result === "success") {
          writerFailures.delete(input.sessionID)
          return
        }
        if (result !== "failure") return
        const next = (writerFailures.get(input.sessionID) ?? 0) + 1
        writerFailures.set(input.sessionID, next)
        if (next >= maxFailures) {
          log.warn("checkpoint writer gave up after max consecutive failures", {
            sessionID: input.sessionID,
            maxAttempts: maxFailures,
          })
          return
        }
        progress.get(input.sessionID)?.crossed.clear()
        log.info("checkpoint writer failed — cleared thresholds for retry", {
          sessionID: input.sessionID,
          attempt: next,
          maxAttempts: maxFailures,
        })
      }).pipe(Effect.forkDetach)
    })

    // Each turn end, decide''',
    flags=re.S,
)
replace_re(
    "packages/opencode/src/session/prune.ts",
    r'''    const maxThresholdCrossed = Effect\.fn\("SessionPrune\.maxThresholdCrossed"\)\(function\* \(
      sessionID: SessionID,
    \) \{
      return maxCrossed\.has\(sessionID\)
    \}\)

    const resetThresholds = Effect\.fn\("SessionPrune\.resetThresholds"\)\(function\* \(sessionID: SessionID\) \{
      crossed\.delete\(sessionID\)
      maxCrossed\.delete\(sessionID\)
    \}\)

    return Service\.of\(\{ prune, fireCheckpoints, maxThresholdCrossed, resetThresholds \}\)''',
    '''    const resetThresholds = Effect.fn("SessionPrune.resetThresholds")(function* (sessionID: SessionID) {
      progress.delete(sessionID)
    })

    const markContextReduced = Effect.fn("SessionPrune.markContextReduced")(function* (sessionID: SessionID) {
      progress.set(sessionID, {
        baseline: 0,
        last: 0,
        crossed: new Set(),
        pendingBaseline: true,
      })
    })

    return Service.of({ prune, fireCheckpoints, resetThresholds, markContextReduced })''',
)

replace(
    "packages/opencode/src/session/prompt.ts",
    'import { Log } from "../util"\n',
    'import { Log, Token } from "../util"\n',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    'import { pressureLevel, isOverflow as overflowCheck } from "./overflow"\n',
    'import { pressureLevel, isOverflow as overflowCheck, rebuildTarget } from "./overflow"\n',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '''      model: { providerID: string; id: string }
''',
    '''      model: Provider.Model
''',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '''      const boundaryMsg = input.msgs.find((m) => m.info.id === boundary)
      const inserted = yield* checkpoint
        .insertRebuildBoundary({
''',
    '''      const boundaryIdx = input.msgs.findIndex((m) => m.info.id === boundary)
      const tail = boundaryIdx < 0 ? [] : input.msgs.slice(boundaryIdx + 1)
      const tailTokens = Token.estimate(
        JSON.stringify(yield* MessageV2.toModelMessagesEffect(tail, input.model)),
      )
      const maxTokens = Math.max(
        0,
        rebuildTarget({ cfg: yield* config.get(), model: input.model }) - tailTokens,
      )
      const boundaryMsg = input.msgs[boundaryIdx]
      const inserted = yield* checkpoint
        .insertRebuildBoundary({
''',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '''          model: { providerID: input.model.providerID, modelID: input.model.id },
          boundaryCreatedAt: boundaryMsg?.info.time.created,
''',
    '''          model: { providerID: input.model.providerID, modelID: input.model.id },
          boundaryCreatedAt: boundaryMsg?.info.time.created,
          maxTokens,
''',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '      if (inserted) yield* prune.resetThresholds(input.sessionID)\n',
    '      if (inserted) yield* prune.markContextReduced(input.sessionID)\n',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '''          if (!skipOverflowCheck && !isBoundedComputation && lastFinished && lastFinished.tokens) {
''',
    '''          if (
            !skipOverflowCheck &&
            !isBoundedComputation &&
            lastFinished &&
            lastFinished.summary !== true &&
            lastFinished.tokens
          ) {
''',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '''            (overflowCheck({ cfg: yield* config.get(), tokens: lastFinished.tokens, model }) ||
              (yield* prune.maxThresholdCrossed(sessionID)))
''',
    '''            overflowCheck({ cfg: yield* config.get(), tokens: lastFinished.tokens, model })
''',
)
replace(
    "packages/opencode/src/session/prompt.ts",
    'model: { providerID: model.providerID, id: model.id },',
    'model,',
    count=3,
)
replace(
    "packages/opencode/src/session/prompt.ts",
    '''        const model = yield* lastModel(input.sessionID)
        const inserted = yield* rebuildFromCheckpoint({
          sessionID: input.sessionID,
          msgs,
          agentID: lastUser?.info.agentID ?? "main",
          agent: agentName,
          model: { providerID: model.providerID, id: model.modelID },
        }).pipe(Effect.catch(() => Effect.succeed(false)))
''',
    '''        const modelRef = yield* lastModel(input.sessionID)
        const model = yield* getModel(modelRef.providerID, modelRef.modelID, input.sessionID)
        const inserted = yield* rebuildFromCheckpoint({
          sessionID: input.sessionID,
          msgs,
          agentID: lastUser?.info.agentID ?? "main",
          agent: agentName,
          model,
        }).pipe(Effect.catch(() => Effect.succeed(false)))
''',
)

replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 60) + "\\n... (truncated, full body at file)"
}
''',
    '''function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 60) + "\\n... (truncated, full body at file)"
}

export function fitTokenBudget(text: string, maxTokens: number | undefined) {
  if (maxTokens === undefined || Token.estimate(text) <= maxTokens) return text
  if (maxTokens <= 0) return ""

  const marker = "\\n\\n[... additional memory omitted to fit the model context ...]\\n\\n"
  const markerTokens = Token.estimate(marker)
  if (maxTokens <= markerTokens) return marker.slice(0, maxTokens * 4)

  const tailTokens = Math.min(1_000, Math.floor((maxTokens - markerTokens) * 0.2))
  const headChars = Math.max(0, (maxTokens - markerTokens - tailTokens) * 4)
  const tailChars = tailTokens * 4
  const head = text.slice(0, headChars).replace(/[\\uD800-\\uDBFF]$/, "")
  const tail = text.slice(-tailChars).replace(/^[\\uDC00-\\uDFFF]/, "")
  return head + marker + tail
}
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''    opts?: { lastMessageInfo?: LastMessageInfo; agentID?: string },
''',
    '''    opts?: {
      lastMessageInfo?: LastMessageInfo
      agentID?: string
      coveredUpTo?: MessageID
      maxTokens?: number
    },
''',
    count=2,
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''            m.info.role === "user" &&
            !m.parts.some((p) => p.type === "tool" || p.type === "checkpoint" || p.type === "compaction"),
''',
    '''            m.info.role === "user" &&
            (!opts?.coveredUpTo || m.info.id <= opts.coveredUpTo) &&
            !m.parts.some((p) => p.type === "tool" || p.type === "checkpoint" || p.type === "compaction"),
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''        !globalText.trim() &&
        actors.length === 0 &&
''',
    '''        !globalText.trim() &&
        !notesText.trim() &&
        actors.length === 0 &&
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '      return lines.join("\\n")\n    })\n\n    const lastBoundary',
    '      return fitTokenBudget(lines.join("\\n"), opts?.maxTokens)\n    })\n\n    const lastBoundary',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''    boundaryCreatedAt?: number
  }) => Effect.Effect<boolean>
''',
    '''    boundaryCreatedAt?: number
    maxTokens?: number
  }) => Effect.Effect<boolean>
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''      boundaryCreatedAt?: number
    }) {
      const rebuildContext = yield* renderRebuildContext(input.sessionID, {
        lastMessageInfo: input.lastMessageInfo,
        agentID: input.agentID,
      }).pipe(Effect.catch(() => Effect.succeed("")))
      if (!rebuildContext) return false

      const indexText = yield* renderIndex(input.sessionID).pipe(Effect.catch(() => Effect.succeed("")))
''',
    '''      boundaryCreatedAt?: number
      maxTokens?: number
    }) {
      const writerRunning = yield* isWriterRunning(input.sessionID)
      const indexText = yield* renderIndex(input.sessionID).pipe(Effect.catch(() => Effect.succeed("")))
      const actorsText = yield* actorRegistry
        .renderForAgent(input.sessionID)
        .pipe(Effect.catch(() => Effect.succeed("")))
      const fixedTokens = Token.estimate([indexText, actorsText].filter(Boolean).join("\\n"))
      const rebuildContext = yield* renderRebuildContext(input.sessionID, {
        lastMessageInfo: input.lastMessageInfo,
        agentID: input.agentID,
        coveredUpTo: input.boundary,
        maxTokens:
          input.maxTokens === undefined ? undefined : Math.max(0, input.maxTokens - fixedTokens),
      }).pipe(Effect.catch(() => Effect.succeed("")))
      if (!rebuildContext) return false

      if (!writerRunning) {
        const active = yield* MessageV2.filterCompactedEffect(input.sessionID, { agentID: "main" })
        if (
          active.some(
            (message) =>
              message.info.role === "user" &&
              message.parts.some(
                (part) => part.type === "checkpoint" && part.coveredUpTo === input.boundary,
              ),
          )
        ) {
          log.warn("rebuild skipped: checkpoint watermark already active", {
            sessionID: input.sessionID,
            boundary: input.boundary,
          })
          return false
        }
      }
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''      const actorsText = yield* actorRegistry
        .renderForAgent(input.sessionID)
        .pipe(Effect.catch(() => Effect.succeed("")))
      if (actorsText) {
''',
    '''      if (actorsText) {
''',
)

replace(
    "packages/opencode/src/config/config.ts",
    'description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",',
    'description: "Input headroom that automatic context reduction must free for subsequent requests. Default: up to 20000 tokens.",',
)
replace(
    "packages/opencode/src/config/config.ts",
    '''          "Context fill thresholds that trigger checkpoint writes. Strings may be percentages (\\"40%\\"), absolute tokens (\\"100K\\", \\"1.5M\\"), or mixed (\\"100K\\", \\"50%\\"). Each threshold must be <= window - 20K reserved. Default: [\\"40%\\", \\"60%\\", \\"80%\\"].",
''',
    '''          "Context-growth thresholds that trigger background checkpoint writes only; they never trigger context reduction. Strings may be percentages (\\"40%\\"), absolute tokens (\\"100K\\", \\"1.5M\\"), or mixed. Defaults vary by effective input window.",
''',
)
replace(
    "packages/opencode/src/config/config.ts",
    'description: "Token buffer reserved for checkpoint operations. Default: 20000.",',
    'description: "Token buffer reserved for checkpoint writer thresholds. Default: 13000.",',
)

Path("packages/opencode/test/session/context-budget.test.ts").write_text(
r'''import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider"
import { contextBudget, isOverflow, rebuildTarget, usable } from "../../src/session/overflow"

function model(input: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: input,
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai-compatible" },
    options: {},
  } as Provider.Model
}

const cfg = { compaction: {} } as any

describe("context budget", () => {
  test("uses one physical input limit and keeps rebuild headroom separate", () => {
    const value = contextBudget({ cfg, model: model({ context: 128_000, output: 32_000 }) })
    expect(value).toEqual({
      context: 128_000,
      output: 32_000,
      input: 96_000,
      target: 76_000,
    })
    expect(usable({ cfg, model: model({ context: 128_000, output: 32_000 }) })).toBe(96_000)
    expect(rebuildTarget({ cfg, model: model({ context: 128_000, output: 32_000 }) })).toBe(76_000)
  })

  test("honors the smaller explicit input limit", () => {
    expect(
      contextBudget({
        cfg,
        model: model({ context: 400_000, input: 250_000, output: 128_000 }),
      }).input,
    ).toBe(250_000)
  })

  test("uses the actual per-call output reservation", () => {
    expect(
      contextBudget({
        cfg,
        model: model({ context: 128_000, output: 32_000 }),
        output: 8_000,
      }).input,
    ).toBe(120_000)
  })

  test("overflow fallback includes reasoning when provider total is unavailable", () => {
    const mdl = model({ context: 100_000, output: 20_000 })
    expect(
      isOverflow({
        cfg,
        model: mdl,
        tokens: {
          total: 0,
          input: 70_000,
          output: 0,
          reasoning: 15_000,
          cache: { read: 0, write: 0 },
        },
      }),
    ).toBe(true)
    expect(
      isOverflow({
        cfg,
        model: mdl,
        tokens: {
          input: 70_000,
          output: 0,
          reasoning: 15_000,
          cache: { read: 0, write: 0 },
        },
      }),
    ).toBe(true)
  })
})
'''
)

replace(
    "packages/opencode/test/cli/tui/context-usage.test.ts",
    '  live?: { input: number; output: number; limit: number },\n',
    '  live?: { input: number; output: number; limit: number; inputLimit: number },\n',
)
replace(
    "packages/opencode/test/cli/tui/context-usage.test.ts",
    '''    expect(resolve([user("u1")], {}, { input: 12_000, output: 8_000, limit: 100_000 })).toEqual({
      kind: "live",
      input: 12_000,
      reserved: 8_000,
      limit: 100_000,
    })
''',
    '''    expect(
      resolve([user("u1")], {}, { input: 12_000, output: 8_000, limit: 100_000, inputLimit: 92_000 }),
    ).toEqual({
      kind: "live",
      input: 12_000,
      reserved: 8_000,
      limit: 100_000,
      inputLimit: 92_000,
    })
''',
)
replace(
    "packages/opencode/test/session/status-context.test.ts",
    '        const context = { input: 80_000, output: 20_000, limit: 200_000 }\n',
    '        const context = { input: 80_000, output: 20_000, limit: 200_000, inputLimit: 180_000 }\n',
)

Path("packages/opencode/test/session/prompt-rebuild-reset.test.ts").write_text(
r'''import { describe, expect, test } from "bun:test"

describe("checkpoint reduction separation", () => {
  test("successful rebuild starts a new checkpoint epoch", async () => {
    const prompt = await Bun.file(`${import.meta.dir}/../../src/session/prompt.ts`).text()
    expect(prompt).toMatch(/if\s*\(inserted\)\s+yield\*\s+prune\.markContextReduced\(input\.sessionID\)/)
  })

  test("checkpoint thresholds never directly trigger context reduction", async () => {
    const prompt = await Bun.file(`${import.meta.dir}/../../src/session/prompt.ts`).text()
    expect(prompt).not.toContain("maxThresholdCrossed")
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
'''
)

with Path("packages/opencode/test/session/prune.test.ts").open("a") as file:
    file.write(
r'''

describe("SessionPrune checkpoint epochs", () => {
  function harness(result: "started" | "queued" | "skipped" = "queued") {
    const state = { starts: 0 }
    const checkpointLayer = Layer.succeed(
      SessionCheckpoint.Service,
      SessionCheckpoint.Service.of({
        tryStartCheckpointWriter: () =>
          Effect.sync(() => {
            state.starts++
            return result
          }),
        waitForWriter: () => Effect.succeed("success"),
        drainWriters: () => Effect.succeed({ drained: 0, timedOut: 0 }),
        hasCheckpoint: () => Effect.succeed(false),
        hasMemoryOrTasks: () => Effect.succeed(false),
        loadLatest: () => Effect.succeed(undefined),
        loadCheckpoints: () => Effect.succeed([]),
        renderIndex: () => Effect.succeed(""),
        renderRebuildContext: () => Effect.succeed(""),
        lastBoundary: () => Effect.succeed(undefined),
        isWriterRunning: () => Effect.succeed(false),
        insertRebuildBoundary: () => Effect.succeed(false),
      }),
    )
    return {
      state,
      layer: Layer.mergeAll(
        SessionNs.defaultLayer,
        CrossSpawnSpawner.defaultLayer,
        SessionPrune.layer.pipe(
          Layer.provide(SessionNs.defaultLayer),
          Layer.provide(checkpointLayer),
          Layer.provide(ActorRegistry.defaultLayer),
          Layer.provideMerge(deps),
        ),
      ),
    }
  }

  test("a large jump writes only the newest checkpoint", async () => {
    const value = harness()
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const service = yield* SessionPrune.Service
            const session = yield* SessionNs.Service
            const info = yield* session.create({})
            const model = createModel({ context: 128_000, output: 32_000 })
            yield* service.fireCheckpoints({
              sessionID: info.id,
              model,
              tokens: { input: 80_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              promptOps: {} as any,
            })
          }),
        { config: { checkpoint: { thresholds: ["20%", "40%", "60%", "80%"] } } },
      ).pipe(Effect.scoped, Effect.provide(value.layer)),
    )
    expect(value.state.starts).toBe(1)
  })

  test("a reduced context establishes a baseline before checkpointing again", async () => {
    const value = harness()
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const service = yield* SessionPrune.Service
            const session = yield* SessionNs.Service
            const info = yield* session.create({})
            const model = createModel({ context: 128_000, output: 32_000 })
            const run = (input: number) =>
              service.fireCheckpoints({
                sessionID: info.id,
                model,
                tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                promptOps: {} as any,
              })

            yield* run(80_000)
            yield* service.markContextReduced(info.id)
            yield* run(60_000)
            yield* run(70_000)
            expect(value.state.starts).toBe(1)
            yield* run(80_000)
          }),
        { config: { checkpoint: { thresholds: ["20K"] } } },
      ).pipe(Effect.scoped, Effect.provide(value.layer)),
    )
    expect(value.state.starts).toBe(2)
  })

  test("a skipped writer does not consume the threshold", async () => {
    const value = harness("skipped")
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const service = yield* SessionPrune.Service
            const session = yield* SessionNs.Service
            const info = yield* session.create({})
            const model = createModel({ context: 128_000, output: 32_000 })
            const input = {
              sessionID: info.id,
              model,
              tokens: { input: 30_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              promptOps: {} as any,
            }
            yield* service.fireCheckpoints(input)
            yield* service.fireCheckpoints(input)
          }),
        { config: { checkpoint: { thresholds: ["20K"] } } },
      ).pipe(Effect.scoped, Effect.provide(value.layer)),
    )
    expect(value.state.starts).toBe(2)
  })
})
'''
    )

Path("packages/opencode/test/session/rebuild-budget.test.ts").write_text(
r'''import { describe, expect, test } from "bun:test"
import { fitTokenBudget } from "../../src/session/checkpoint"
import { Token } from "../../src/util"

describe("rebuild context budget", () => {
  test("keeps output within the total token budget while preserving both ends", () => {
    const text = "HEAD\\n" + "x".repeat(20_000) + "\\nTAIL"
    const fitted = fitTokenBudget(text, 1_000)
    expect(Token.estimate(fitted)).toBeLessThanOrEqual(1_000)
    expect(fitted).toStartWith("HEAD")
    expect(fitted).toEndWith("TAIL")
    expect(fitted).toContain("additional memory omitted")
  })

  test("does not modify content already inside the budget", () => {
    expect(fitTokenBudget("small", 100)).toBe("small")
  })
})
'''
)

for file in Path("packages/opencode").rglob("*.ts"):
    if "maxThresholdCrossed" in file.read_text():
        raise RuntimeError(f"obsolete maxThresholdCrossed reference remains in {file}")

print("context budget root fix applied")
