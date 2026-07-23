import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const worker = path.join(import.meta.dir, "fixtures", "lease-stress-process.ts")

async function output(proc: ReturnType<typeof Bun.spawn>) {
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ])
  return { stdout, stderr, exit }
}

describe("RuntimeLease multiprocess stress", () => {
  test("twenty processes elect one owner for each of one hundred resources", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "lease-stress.db")
    const bootstrap = Bun.spawn([process.execPath, worker, db, "0"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const ready = await output(bootstrap)
    expect(ready.exit).toBe(0)
    expect(ready.stdout).toContain("READY")

    const processes = Array.from({ length: 20 }, () =>
      Bun.spawn([process.execPath, worker, db, "100"], {
        cwd: import.meta.dir,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      }),
    )
    const results = await Promise.all(processes.map(output))
    expect(results.every((result) => result.exit === 0)).toBe(true)
    expect(results.every((result) => !result.stderr.includes("SQLITE_BUSY"))).toBe(true)

    const winners = results
      .flatMap((result) => result.stdout.split(/\r?\n/))
      .flatMap((line) => {
        const match = /^WIN (\d+)$/.exec(line)
        return match ? [Number(match[1])] : []
      })
    expect(winners).toHaveLength(100)
    const counts = new Map<number, number>()
    for (const winner of winners) counts.set(winner, (counts.get(winner) ?? 0) + 1)
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, index) => index))
    expect([...counts.values()].every((count) => count === 1)).toBe(true)
  }, 60_000)
})
