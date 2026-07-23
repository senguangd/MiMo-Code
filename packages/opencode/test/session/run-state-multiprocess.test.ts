import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const worker = path.join(import.meta.dir, "fixtures", "run-state-process.ts")

async function output(proc: ReturnType<typeof Bun.spawn>) {
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ])
  return { stdout, stderr, exit }
}

describe("SessionRunState cross-process ownership", () => {
  test("only one process executes the same session actor", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "shared.db")
    const sessionID = "ses_cross_process_owner"
    const first = Bun.spawn([process.execPath, worker, db, tmp.path, sessionID, "1200"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    await Bun.sleep(200)
    const second = Bun.spawn([process.execPath, worker, db, tmp.path, sessionID, "100"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const results = await Promise.all([output(first), output(second)])
    const started = results.filter((result) => result.stdout.includes("STARTED"))
    const busy = results.filter((result) => result.stdout.includes("BUSY"))

    expect(results.map((result) => ({ stdout: result.stdout, stderr: result.stderr, exit: result.exit }))).toEqual(
      expect.any(Array),
    )
    expect(started).toHaveLength(1)
    expect(busy).toHaveLength(1)
  }, 10_000)
  test("a remote cancellation request interrupts the owner", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "cancel-shared.db")
    const sessionID = "ses_cross_process_cancel"
    const startedAt = Date.now()
    const owner = Bun.spawn([process.execPath, worker, db, tmp.path, sessionID, "12000"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const ready = path.join(tmp.path, `${sessionID}.ready`)
    const deadline = Date.now() + 8_000
    while (!(await Bun.file(ready).exists())) {
      if (Date.now() >= deadline) throw new Error("owner did not acquire the lease in time")
      await Bun.sleep(100)
    }
    const cancelWorker = path.join(import.meta.dir, "fixtures", "lease-cancel-process.ts")
    const canceller = Bun.spawn([process.execPath, cancelWorker, db, sessionID, "main"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const [cancelled, ownerResult] = await Promise.all([output(canceller), output(owner)])
    expect(cancelled.stdout).toContain("CANCELLED")
    expect(ownerResult.stdout).toContain("STARTED")
    expect(ownerResult.stdout).toContain("DONE")
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  }, 15_000)

})
