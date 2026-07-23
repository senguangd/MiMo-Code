const [db, directory, sessionID, hold] = process.argv.slice(2)
if (!db || !directory || !sessionID || !hold) throw new Error("missing args")
process.env.MIMOCODE_DB = db

const [{ Effect, ManagedRuntime }, { Instance }, { SessionRunState }] = await Promise.all([
  import("effect"),
  import("@/project/instance"),
  import("@/session/run-state"),
])

await Instance.provide({
  directory,
  fn: async () => {
    const runtime = ManagedRuntime.make(SessionRunState.defaultLayer)
    try {
      await runtime.runPromise(
        SessionRunState.Service.use((service) =>
          service.ensureRunning(
            sessionID as never,
            "main",
            Effect.succeed({ info: { role: "assistant" }, parts: [] } as never),
            Effect.gen(function* () {
              console.log("STARTED")
              yield* Effect.promise(() => Bun.write(`${directory}/${sessionID}.ready`, "ready"))
              yield* Effect.sleep(Number(hold))
              return { info: { role: "assistant" }, parts: [] } as never
            }),
          ),
        ),
      )
      console.log("DONE")
    } catch (error) {
      console.log(error instanceof Error && error.message.includes(" is busy") ? "BUSY" : `ERROR:${String(error)}`)
    } finally {
      await runtime.dispose()
    }
  },
})
