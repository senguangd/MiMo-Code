import { EffectLogger, InstanceState } from "@/effect"
import { Runner } from "@/effect"
import { Cause, Effect, Exit, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { RuntimeLease, type Handle as RuntimeLeaseHandle } from "@/runtime/lease"
import { ActorRegistryTable } from "@/actor/actor.sql"
import { and, Database, eq } from "@/storage"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancelActor: (sessionID: SessionID, agentID: string) => Effect.Effect<"local" | "remote" | "idle">
  readonly ensureRunning: (
    sessionID: SessionID,
    agentID: string,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startExclusive: (
    sessionID: SessionID,
    agentID: string,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly withSessionExclusive: <A, E, R>(sessionID: SessionID, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

const runnerKey = (sessionID: SessionID, agentID: string) => `${sessionID}:${agentID}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const elog = EffectLogger.create({ service: "SessionRunState" })

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<string, Runner.Runner<MessageV2.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      agentID: string,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
    ) {
      const key = runnerKey(sessionID, agentID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (existing) return existing
      const isMain = agentID === "main"
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        label: key,
        onReentryWarn: (info) => elog.warn("runner-reentry", info),
        onIdle: isMain
          ? Effect.gen(function* () {
              data.runners.delete(key)
              yield* status.set(sessionID, { type: "idle" })
            })
          : Effect.sync(() => {
              data.runners.delete(key)
            }),
        onBusy: isMain ? status.set(sessionID, { type: "busy" }) : Effect.void,
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(key, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(runnerKey(sessionID, "main"))
      if (existing?.busy) throw new Session.BusyError(sessionID)
      if (yield* RuntimeLease.isHeld({ resourceType: "session-run", resourceID: sessionID, subresourceID: "main" }))
        throw new Session.BusyError(sessionID)
    })

    const settleActor = <A>(handle: RuntimeLeaseHandle, exit: Exit.Exit<A, unknown>) =>
      Effect.gen(function* () {
        yield* RuntimeLease.assertHandle(handle).pipe(Effect.orDie)
        const now = Date.now()
        yield* Effect.sync(() => {
          const cancelled = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
          Database.use((db) =>
            db
              .update(ActorRegistryTable)
              .set({
                status: "idle",
                last_outcome: Exit.isSuccess(exit) ? "success" : cancelled ? "cancelled" : "failure",
                last_error: Exit.isFailure(exit) && !cancelled ? Cause.pretty(exit.cause) : null,
                time_completed: now,
                time_updated: now,
              })
              .where(
                and(
                  eq(ActorRegistryTable.session_id, handle.resourceID as SessionID),
                  eq(ActorRegistryTable.actor_id, handle.subresourceID ?? "main"),
                  eq(ActorRegistryTable.instance_id, handle.ownerInstanceID),
                  eq(ActorRegistryTable.lease_fence, handle.fencingToken),
                ),
              )
              .run(),
          )
        })
      })

    const leased = <A, E, R>(sessionID: SessionID, agentID: string, work: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const key = { resourceType: "session-run" as const, resourceID: sessionID, subresourceID: agentID }
        const inherited = yield* RuntimeLease.current(key)
        if (inherited) return yield* work
        const handle = yield* RuntimeLease.acquire(key)
        if (!handle) throw new Session.BusyError(sessionID)
        return yield* RuntimeLease.hold([handle], work.pipe(Effect.onExit((exit) => settleActor(handle, exit))))
      })

    const withSessionExclusive = <A, E, R>(sessionID: SessionID, work: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const key = { resourceType: "session-admin" as const, resourceID: sessionID }
        const inherited = yield* RuntimeLease.current(key)
        if (inherited) return yield* work
        const handle = yield* RuntimeLease.acquire(key)
        if (!handle) throw new Session.BusyError(sessionID)
        return yield* RuntimeLease.hold([handle], work)
      })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const key = runnerKey(sessionID, "main")
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (existing) {
        yield* existing.interrupt
        return
      }
      const requested = yield* RuntimeLease.requestCancel({
        resourceType: "session-run",
        resourceID: sessionID,
        subresourceID: "main",
        reason: "Session aborted by another client",
      })
      // A remote owner remains authoritative until its interrupted cleanup
      // releases the lease. Publishing idle here would create a false turn-end
      // edge for the TUI and cron bridge while the session is still busy.
      if (!requested) yield* status.set(sessionID, { type: "idle" })
    })

    const cancelActor = Effect.fn("SessionRunState.cancelActor")(function* (sessionID: SessionID, agentID: string) {
      const key = runnerKey(sessionID, agentID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(key)
      if (existing?.busy) {
        yield* existing.cancel
        return "local" as const
      }
      const requested = yield* RuntimeLease.requestCancel({
        resourceType: "session-run",
        resourceID: sessionID,
        subresourceID: agentID,
        reason: "Actor cancelled by another client",
      })
      return requested ? ("remote" as const) : ("idle" as const)
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      agentID: string,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, agentID, onInterrupt)).ensureRunning(leased(sessionID, agentID, work))
    })

    const startExclusive = Effect.fn("SessionRunState.startExclusive")(function* (
      sessionID: SessionID,
      agentID: string,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      const owned = yield* runner(sessionID, agentID, onInterrupt)
      return yield* owned
        .startExclusive(leased(sessionID, agentID, work))
        .pipe(Effect.onInterrupt(() => owned.interrupt))
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, "main", onInterrupt)).startShell(leased(sessionID, "main", work))
    })

    return Service.of({
      assertNotBusy,
      cancel,
      cancelActor,
      ensureRunning,
      startExclusive,
      startShell,
      withSessionExclusive,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))

export * as SessionRunState from "./run-state"
