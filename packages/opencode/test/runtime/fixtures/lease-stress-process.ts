const [db, roundsRaw] = process.argv.slice(2)
if (!db || roundsRaw === undefined) throw new Error("missing args")
process.env.ADPCLI_DB = db

const [{ Effect }, { RuntimeLease }] = await Promise.all([import("effect"), import("@/runtime/lease")])
const rounds = Number(roundsRaw)
if (rounds === 0) {
  const handle = await Effect.runPromise(RuntimeLease.acquire({ resourceType: "checkpoint", resourceID: "bootstrap" }))
  if (!handle) throw new Error("bootstrap lease unavailable")
  await Effect.runPromise(RuntimeLease.release(handle))
  console.log("READY")
  process.exit(0)
}

for (let round = 0; round < rounds; round++) {
  const handle = await Effect.runPromise(
    RuntimeLease.acquire({ resourceType: "session-run", resourceID: `stress-${round}`, subresourceID: "main" }),
  )
  if (handle) console.log(`WIN ${round}`)
}
