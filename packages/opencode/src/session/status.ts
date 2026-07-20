import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { MessageID, SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { ContextEstimate } from "./context-estimate"

export const Info = z
  .union([
    z.object({
      type: z.literal("idle"),
    }),
    z.object({
      type: z.literal("retry"),
      attempt: z.number(),
      message: z.string(),
      next: z.number(),
      // Owner of this session-level status. The TUI prompt is session-scoped,
      // but multiple runs/messages can race to publish status for the same
      // session. Keeping the owner lets newer busy work ignore stale retry
      // updates from an older/background message.
      messageID: MessageID.zod.optional(),
      contextEstimate: ContextEstimate.Info.optional(),
    }),
    z.object({
      type: z.literal("busy"),
      message: z.string().optional(),
      messageID: MessageID.zod.optional(),
      // Internal marker: a retry footer should remain visible while the
      // network/provider is still failing. Only a busy status emitted after real
      // stream progress may clear a retry for the same message.
      recoveredFromRetry: z.boolean().optional(),
      contextEstimate: ContextEstimate.Info.optional(),
    }),
  ])
  .meta({
    ref: "SessionStatus",
  })
export type Info = z.infer<typeof Info>

export const Event = {
  Status: BusEvent.define(
    "session.status",
    z.object({
      sessionID: SessionID.zod,
      status: Info,
    }),
  ),
  // deprecated
  Idle: BusEvent.define(
    "session.idle",
    z.object({
      sessionID: SessionID.zod,
    }),
  ),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      return new Map(yield* InstanceState.get(state))
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      const current = data.get(sessionID)
      const sameMessageEstimate =
        status.type !== "idle" &&
        status.contextEstimate === undefined &&
        current?.type !== "idle" &&
        current?.contextEstimate !== undefined &&
        current.messageID !== undefined &&
        (status.messageID === undefined || current.messageID === status.messageID)
          ? current.contextEstimate
          : undefined
      const next = sameMessageEstimate ? { ...status, contextEstimate: sameMessageEstimate } : status
      // Retry is sticky for its owning message. Generic busy updates from
      // run-state/onBusy, beginRun, lifecycle events, or reconnect bookkeeping
      // must not erase the visible retry footer. Otherwise users see the red
      // transient warning and then no persistent grey retry status while the
      // network is still down.
      if (next.type === "busy" && current?.type === "retry") {
        const currentOwner = current.messageID
        const nextOwner = next.messageID

        const sameOwner =
          currentOwner
            ? !nextOwner || nextOwner === currentOwner
            : !nextOwner

        // Allow two intentional retry -> busy transitions:
        // 1. recoveredFromRetry: true  => real stream progress, clear footer
        // 2. message present           => keep showing the last transport error
        //                                as the old grey busy footer
        if (sameOwner && !next.recoveredFromRetry && !next.message) return
      }

      // A session has only one visible prompt status, but there can be multiple
      // effects associated with the same session. Do not let an unowned or
      // different-message retry banner overwrite the busy status of the message
      // that is currently making progress.
      if (next.type === "retry" && current?.type === "busy" && current.messageID) {
        if (!next.messageID || next.messageID !== current.messageID) return
      }

      yield* bus.publish(Event.Status, { sessionID, status: next })
      if (next.type === "idle") {
        yield* bus.publish(Event.Idle, { sessionID })
        data.delete(sessionID)
        return
      }
      data.set(sessionID, next)
    })

    return Service.of({ get, list, set })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as SessionStatus from "./status"
