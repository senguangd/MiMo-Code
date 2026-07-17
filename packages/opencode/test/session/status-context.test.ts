import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionStatus } from "../../src/session/status"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

const it = testEffect(Layer.mergeAll(SessionStatus.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("session status context ownership", () => {
  it.live(
    "preserves context for ordinary busy updates and clears it explicitly for context rebuilds",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const status = yield* SessionStatus.Service
        const sessionID = SessionID.make("ses_context")
        const context = { input: 80_000, output: 20_000, limit: 200_000 }

        yield* status.set(sessionID, { type: "busy", messageID: MessageID.make("msg_main"), context })
        yield* status.set(sessionID, { type: "busy", message: "Running tools..." })
        expect(yield* status.get(sessionID)).toEqual({ type: "busy", message: "Running tools...", context })

        yield* status.set(sessionID, { type: "busy", message: "Compacting context..." }, { preserveContext: false })
        expect(yield* status.get(sessionID)).toEqual({ type: "busy", message: "Compacting context..." })
      }),
    ),
  )
})
