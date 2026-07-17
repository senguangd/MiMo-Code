from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new))


replace(
    "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
    '''    const cost = msg.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    const label =
''',
    '''    const cost = msg.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    const effectiveLimit =
      context?.kind === "live" ? context.inputLimit : context?.kind === "last" ? context.limit : undefined
    const label =
''',
)
replace(
    "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
    '''              (context.kind === "live" ? context.inputLimit : context.limit)
                ? `(${Math.round(
                    (context.input / (context.kind === "live" ? context.inputLimit : context.limit!)) * 100,
                  )}%)`
                : undefined,
''',
    '''              effectiveLimit ? `(${Math.round((context.input / effectiveLimit) * 100)}%)` : undefined,
''',
)

replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''export function fitTokenBudget(text: string, maxTokens: number | undefined) {
''',
    '''export function fitTokenBudget(text: string, maxTokens: number | undefined): string {
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''      opts?: {
      lastMessageInfo?: LastMessageInfo
      agentID?: string
      coveredUpTo?: MessageID
      maxTokens?: number
    },
''',
    '''      opts?: {
        lastMessageInfo?: LastMessageInfo
        agentID?: string
        coveredUpTo?: MessageID
        maxTokens?: number
      },
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''      const writerRunning = yield* isWriterRunning(input.sessionID)
      const indexText = yield* renderIndex(input.sessionID).pipe(Effect.catch(() => Effect.succeed("")))
''',
    '''      const indexText = yield* renderIndex(input.sessionID).pipe(Effect.catch(() => Effect.succeed("")))
''',
)
replace(
    "packages/opencode/src/session/checkpoint.ts",
    '''      if (!writerRunning) {
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
    '''      const active = yield* MessageV2.filterCompactedEffect(input.sessionID, { agentID: "main" })
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
''',
)

replace(
    "packages/opencode/src/session/prompt.ts",
    '''          // Fire background checkpoint writers for any newly-crossed thresholds
          // based on the latest completed assistant message's tokens. Must run
          // BEFORE the overflow/maxThreshold check below so maxCrossed flag is
          // set in time to trigger rebuild on this same iteration.
''',
    '''          // Persist newly-crossed checkpoint milestones before deciding whether
          // the model-visible context itself must be reduced. Checkpoint writes and
          // context reduction are deliberately independent decisions.
''',
)

replace(
    "packages/opencode/src/session/prune.ts",
    '''      if (!(yield* actorReg.servesCheckpoint(input.sessionID, input.agentID))) return

      const cfg = yield* config.get()
''',
    '''      // Only checkpoint-owning agents participate. Subagents share the session
      // ID but keep independent context slices, so letting them advance the main
      // watermark would make future rebuilds capture the wrong conversation.
      if (!(yield* actorReg.servesCheckpoint(input.sessionID, input.agentID))) return

      const cfg = yield* config.get()
''',
)
replace(
    "packages/opencode/src/session/prune.ts",
    '''      const current =
        input.tokens.total ??
        input.tokens.input +
          input.tokens.output +
          input.tokens.reasoning +
          input.tokens.cache.read +
          input.tokens.cache.write
''',
    '''      const current =
        input.tokens.total ||
        input.tokens.input +
          input.tokens.output +
          (input.tokens.reasoning ?? 0) +
          input.tokens.cache.read +
          input.tokens.cache.write
''',
)

replace(
    "packages/opencode/test/session/prune.test.ts",
    '''})


describe("SessionPrune checkpoint epochs", () => {
''',
    '''})

describe("SessionPrune checkpoint epochs", () => {
''',
)

print("minimal context cleanup applied")
