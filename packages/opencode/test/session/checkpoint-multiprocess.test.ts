import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const worker = path.join(import.meta.dir, "fixtures", "checkpoint-lease-process.ts")

async function output(proc: ReturnType<typeof Bun.spawn>) {
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ])
  return { stdout, stderr, exit }
}

describe("checkpoint cross-process ownership", () => {
  test("only one process owns the session checkpoint and project memory pair", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "checkpoint-shared.db")
    const args = [db, "ses_checkpoint_owner", "project-owner", "1200"]
    const first = Bun.spawn([process.execPath, worker, ...args], {
      cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", env: process.env,
    })
    await Bun.sleep(200)
    const second = Bun.spawn([process.execPath, worker, ...args], {
      cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", env: process.env,
    })
    const results = await Promise.all([output(first), output(second)])
    expect(results.filter((result) => result.stdout.includes("STARTED"))).toHaveLength(1)
    expect(results.filter((result) => result.stdout.includes("BUSY"))).toHaveLength(1)
  }, 10_000)
})
