const [db, sessionID, projectID, hold] = process.argv.slice(2)
if (!db || !sessionID || !projectID || !hold) throw new Error("missing args")
process.env.ADPCLI_DB = db
const [{ Effect }, { RuntimeLease }] = await Promise.all([import("effect"), import("@/runtime/lease")])
const handles = await Effect.runPromise(
  RuntimeLease.acquireMany([
    { resourceType: "checkpoint", resourceID: sessionID },
    { resourceType: "project-memory", resourceID: projectID },
  ]),
)
if (!handles) {
  console.log("BUSY")
  process.exit(0)
}
await Effect.runPromise(
  RuntimeLease.hold(
    handles,
    Effect.gen(function* () {
      console.log("STARTED")
      yield* Effect.sleep(Number(hold))
    }),
  ),
)
console.log("DONE")
