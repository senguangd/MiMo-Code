import { randomUUID } from "node:crypto"
import { Context, Effect } from "effect"
import { and, Database, eq, or } from "@/storage"
import { ActorRegistryTable } from "@/actor/actor.sql"
import { RuntimeLeaseTable } from "./lease.sql"
import { ProcessIdentity } from "./process"

export type ResourceType = "session-run" | "session-admin" | "checkpoint" | "project-memory"

export type Key = {
  resourceType: ResourceType
  resourceID: string
  subresourceID?: string
}

export type Handle = Key & {
  ownerInstanceID: string
  ownerPID: number
  leaseID: string
  fencingToken: number
}

export class LostError extends Error {
  constructor(readonly handle: Handle) {
    super(`Runtime lease lost: ${handle.resourceType}:${handle.resourceID}:${handle.subresourceID ?? ""}`)
  }
}

export class CancelledError extends Error {
  constructor(
    readonly handle: Handle,
    readonly reason?: string,
  ) {
    super(
      reason ?? `Runtime lease cancelled: ${handle.resourceType}:${handle.resourceID}:${handle.subresourceID ?? ""}`,
    )
  }
}

export const Current = Context.Reference<readonly Handle[]>("~opencode/RuntimeLease", {
  defaultValue: () => [],
})

const HEARTBEAT_MS = 5_000
const TTL_MS = 30_000

const where = (input: Key) =>
  and(
    eq(RuntimeLeaseTable.resource_type, input.resourceType),
    eq(RuntimeLeaseTable.resource_id, input.resourceID),
    eq(RuntimeLeaseTable.subresource_id, input.subresourceID ?? ""),
  )

export const acquire = Effect.fn("RuntimeLease.acquire")(function* (input: Key) {
  return yield* Effect.sync(() =>
    Database.transaction(
      (db) => {
        const now = Date.now()
        const row = db.select().from(RuntimeLeaseTable).where(where(input)).get()
        if (row && row.lease_id !== "" && row.expires_at > now) return undefined

        // Session-wide management is mutually exclusive with every execution
        // path that can mutate the session: actor runs and checkpoint writers.
        // The check and lease insert happen under the same BEGIN IMMEDIATE
        // transaction, so no conflicting owner can slip in after preflight.
        if (input.resourceType === "session-admin") {
          const running = db
            .select()
            .from(RuntimeLeaseTable)
            .where(
              and(
                eq(RuntimeLeaseTable.resource_id, input.resourceID),
                or(
                  eq(RuntimeLeaseTable.resource_type, "session-run"),
                  eq(RuntimeLeaseTable.resource_type, "checkpoint"),
                ),
              ),
            )
            .all()
            .some(
              (candidate) =>
                (candidate.resource_type === "session-run" || candidate.resource_type === "checkpoint") &&
                candidate.lease_id !== "" &&
                candidate.expires_at > now,
            )
          if (running) return undefined
        }
        if (input.resourceType === "session-run" || input.resourceType === "checkpoint") {
          const admin = db
            .select()
            .from(RuntimeLeaseTable)
            .where(
              and(
                eq(RuntimeLeaseTable.resource_type, "session-admin"),
                eq(RuntimeLeaseTable.resource_id, input.resourceID),
                eq(RuntimeLeaseTable.subresource_id, ""),
              ),
            )
            .get()
          if (admin && admin.lease_id !== "" && admin.expires_at > now) return undefined
        }

        if (input.resourceType === "session-run" && !row) {
          const actor = db
            .select()
            .from(ActorRegistryTable)
            .where(
              and(
                eq(ActorRegistryTable.session_id, input.resourceID as never),
                eq(ActorRegistryTable.actor_id, input.subresourceID ?? "main"),
              ),
            )
            .get()
          const active = actor?.status === "pending" || actor?.status === "running"
          const foreign = actor !== undefined && actor.instance_id !== ProcessIdentity.instanceID
          if (active && foreign && now - actor.last_turn_time < 5 * 60_000) return undefined
        }

        const handle: Handle = {
          ...input,
          subresourceID: input.subresourceID ?? "",
          ownerInstanceID: ProcessIdentity.instanceID,
          ownerPID: ProcessIdentity.pid,
          leaseID: randomUUID(),
          fencingToken: (row?.fencing_token ?? 0) + 1,
        }
        const value = {
          resource_type: handle.resourceType,
          resource_id: handle.resourceID,
          subresource_id: handle.subresourceID ?? "",
          owner_instance_id: handle.ownerInstanceID,
          owner_pid: handle.ownerPID,
          lease_id: handle.leaseID,
          fencing_token: handle.fencingToken,
          heartbeat_at: now,
          expires_at: now + TTL_MS,
          cancel_requested_at: null,
          cancel_reason: null,
          time_created: row?.time_created ?? now,
          time_updated: now,
        }
        if (!row) db.insert(RuntimeLeaseTable).values(value).run()
        else db.update(RuntimeLeaseTable).set(value).where(where(input)).run()
        if (input.resourceType === "session-run") {
          db.update(ActorRegistryTable)
            .set({
              status: "running",
              last_outcome: null,
              last_error: null,
              instance_id: handle.ownerInstanceID,
              lease_fence: handle.fencingToken,
              time_completed: null,
              time_updated: now,
            })
            .where(
              and(
                eq(ActorRegistryTable.session_id, input.resourceID as never),
                eq(ActorRegistryTable.actor_id, input.subresourceID ?? "main"),
              ),
            )
            .run()
        }
        return handle
      },
      { behavior: "immediate" },
    ),
  )
})

export const owner = Effect.fn("RuntimeLease.owner")(function* (input: Key) {
  return yield* Effect.sync(() => {
    const row = Database.use((db) => db.select().from(RuntimeLeaseTable).where(where(input)).get())
    if (!row || row.lease_id === "" || row.expires_at <= Date.now()) return undefined
    return {
      resourceType: row.resource_type,
      resourceID: row.resource_id,
      subresourceID: row.subresource_id,
      ownerInstanceID: row.owner_instance_id,
      ownerPID: row.owner_pid,
      leaseID: row.lease_id,
      fencingToken: row.fencing_token,
    } satisfies Handle
  })
})

export const active = Effect.fn("RuntimeLease.active")(function* (resourceType: ResourceType) {
  return yield* Effect.sync(() => {
    const now = Date.now()
    return Database.use((db) =>
      db.select().from(RuntimeLeaseTable).where(eq(RuntimeLeaseTable.resource_type, resourceType)).all(),
    )
      .filter((row) => row.lease_id !== "" && row.expires_at > now)
      .map(
        (row): Handle => ({
          resourceType: row.resource_type,
          resourceID: row.resource_id,
          subresourceID: row.subresource_id,
          ownerInstanceID: row.owner_instance_id,
          ownerPID: row.owner_pid,
          leaseID: row.lease_id,
          fencingToken: row.fencing_token,
        }),
      )
  })
})

export const isHeld = Effect.fn("RuntimeLease.isHeld")(function* (input: Key) {
  return yield* Effect.sync(() => {
    const row = Database.use((db) => db.select().from(RuntimeLeaseTable).where(where(input)).get())
    if (!row || row.lease_id === "") return false
    return row.expires_at > Date.now()
  })
})

export const current = Effect.fn("RuntimeLease.current")(function* (input: Key) {
  const handles = yield* Current
  return handles.find(
    (handle) =>
      handle.resourceType === input.resourceType &&
      handle.resourceID === input.resourceID &&
      (handle.subresourceID ?? "") === (input.subresourceID ?? ""),
  )
})

export const assertHandle = Effect.fn("RuntimeLease.assertHandle")(function* (handle: Handle) {
  const owned = yield* Effect.sync(() => {
    const row = Database.use((db) => db.select().from(RuntimeLeaseTable).where(where(handle)).get())
    return (
      row?.owner_instance_id === handle.ownerInstanceID &&
      row.owner_pid === handle.ownerPID &&
      row.lease_id === handle.leaseID &&
      row.fencing_token === handle.fencingToken &&
      row.expires_at > Date.now()
    )
  })
  if (!owned) return yield* Effect.fail(new LostError(handle))
})

export const assertCurrent = Effect.fn("RuntimeLease.assertCurrent")(function* () {
  const handles = yield* Current
  yield* Effect.forEach(handles, assertHandle, { discard: true })
})

const renew = Effect.fn("RuntimeLease.renew")(function* (handle: Handle) {
  return yield* Effect.sync(() =>
    Database.transaction(
      (db) => {
        const row = db.select().from(RuntimeLeaseTable).where(where(handle)).get()
        const now = Date.now()
        if (
          !row ||
          row.owner_instance_id !== handle.ownerInstanceID ||
          row.owner_pid !== handle.ownerPID ||
          row.lease_id !== handle.leaseID ||
          row.fencing_token !== handle.fencingToken ||
          row.expires_at <= now
        )
          return { type: "lost" as const }
        if (row.cancel_requested_at) return { type: "cancelled" as const, reason: row.cancel_reason ?? undefined }
        db.update(RuntimeLeaseTable)
          .set({ heartbeat_at: now, expires_at: now + TTL_MS, time_updated: now })
          .where(where(handle))
          .run()
        return { type: "renewed" as const }
      },
      { behavior: "immediate" },
    ),
  )
})

const monitor = (handle: Handle) =>
  Effect.forever(
    Effect.sleep(HEARTBEAT_MS).pipe(
      Effect.andThen(renew(handle)),
      Effect.flatMap((result) => {
        if (result.type === "renewed") return Effect.void
        return Effect.interrupt
      }),
    ),
  )

export const release = Effect.fn("RuntimeLease.release")(function* (handle: Handle) {
  yield* Effect.sync(() => {
    const now = Date.now()
    Database.use((db) =>
      db
        .update(RuntimeLeaseTable)
        .set({
          owner_instance_id: "",
          owner_pid: 0,
          lease_id: "",
          heartbeat_at: now,
          expires_at: 0,
          cancel_requested_at: null,
          cancel_reason: null,
          time_updated: now,
        })
        .where(
          and(
            where(handle),
            eq(RuntimeLeaseTable.owner_instance_id, handle.ownerInstanceID),
            eq(RuntimeLeaseTable.lease_id, handle.leaseID),
            eq(RuntimeLeaseTable.fencing_token, handle.fencingToken),
          ),
        )
        .run(),
    )
  })
})

export const requestCancel = Effect.fn("RuntimeLease.requestCancel")(function* (input: Key & { reason?: string }) {
  return yield* Effect.sync(() =>
    Database.transaction(
      (db) => {
        const row = db.select().from(RuntimeLeaseTable).where(where(input)).get()
        if (!row || row.lease_id === "" || row.expires_at <= Date.now()) return false
        const now = Date.now()
        db.update(RuntimeLeaseTable)
          .set({ cancel_requested_at: now, cancel_reason: input.reason ?? null, time_updated: now })
          .where(where(input))
          .run()
        return true
      },
      { behavior: "immediate" },
    ),
  )
})

export const hold = <A, E, R>(handles: readonly Handle[], work: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    if (handles.length === 0) return yield* work
    const inherited = yield* Current
    const guarded = work.pipe(Effect.provideService(Current, [...inherited, ...handles]))
    const watchdog = Effect.forEach(handles, monitor, { concurrency: "unbounded", discard: true }).pipe(
      Effect.andThen(Effect.never),
    )
    return yield* Effect.raceFirst(guarded, watchdog).pipe(
      Effect.ensuring(Effect.forEach([...handles].reverse(), release, { discard: true })),
    )
  })

export const acquireMany = Effect.fn("RuntimeLease.acquireMany")(function* (keys: readonly Key[]) {
  const handles: Handle[] = []
  for (const key of keys) {
    const handle = yield* acquire(key)
    if (handle) {
      handles.push(handle)
      continue
    }
    yield* Effect.forEach(handles.reverse(), release, { discard: true })
    return undefined
  }
  return handles
})

export * as RuntimeLease from "./lease"
