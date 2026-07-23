const [db, sessionID, actorID] = process.argv.slice(2)
if (!db || !sessionID || !actorID) throw new Error("missing args")
process.env.MIMOCODE_DB = db
const [{ Effect }, { RuntimeLease }] = await Promise.all([import("effect"), import("@/runtime/lease")])
const requested = await Effect.runPromise(
  RuntimeLease.requestCancel({
    resourceType: "session-run",
    resourceID: sessionID,
    subresourceID: actorID,
    reason: "remote test cancellation",
  }),
)
console.log(requested ? "CANCELLED" : "NOT_FOUND")
