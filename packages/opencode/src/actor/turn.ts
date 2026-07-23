import { Cause, Effect, Exit } from "effect"
import { ActorRegistry } from "@/actor/registry"
import type { SessionID } from "@/session/schema"
import * as Session from "@/session/session"
import { RuntimeLease } from "@/runtime/lease"

export const runTurn = <A, E>(
  sessionID: SessionID,
  actorID: string,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E, ActorRegistry.Service> =>
  Effect.gen(function* () {
    const handle = yield* RuntimeLease.acquire({
      resourceType: "session-run",
      resourceID: sessionID,
      subresourceID: actorID,
    })
    if (!handle) throw new Session.BusyError(sessionID)
    return yield* RuntimeLease.hold(
      [handle],
      Effect.uninterruptible(
        Effect.gen(function* () {
          const reg = yield* ActorRegistry.Service
          yield* reg.updateStatus(sessionID, actorID, { status: "running" }).pipe(Effect.ignore)
          const exit: Exit.Exit<A, E> = yield* work.pipe(Effect.interruptible, Effect.exit)
          if (Exit.isSuccess(exit)) {
            yield* reg
              .updateStatus(sessionID, actorID, {
                status: "idle",
                lastOutcome: "success",
                lastError: undefined,
              })
              .pipe(Effect.ignore)
            return exit.value
          }
          const cause = exit.cause
          const cancelled = Cause.hasInterruptsOnly(cause)
          yield* reg
            .updateStatus(sessionID, actorID, {
              status: "idle",
              lastOutcome: cancelled ? "cancelled" : "failure",
              lastError: cancelled ? undefined : extractErrorString(cause),
            })
            .pipe(Effect.ignore)
          return yield* Effect.failCause(cause) as Effect.Effect<A, E>
        }),
      ),
    )
  }) as Effect.Effect<A, E, ActorRegistry.Service>

function extractErrorString(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause)
}

export * as ActorTurn from "./turn"
