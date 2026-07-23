import fs from "node:fs/promises"

const TRANSIENT_WINDOWS_ERRORS = new Set(["EBUSY", "EACCES", "EPERM"])

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return ""
  return String(error.code)
}

async function exists(target: string) {
  try {
    await fs.stat(target)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}

async function removeWithWindowsShell(target: string) {
  const proc = Bun.spawn(
    [
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Remove-Item -LiteralPath $env:MIMOCODE_REMOVE_DIRECTORY_TARGET -Recurse -Force -ErrorAction Stop",
    ],
    {
      env: { ...process.env, MIMOCODE_REMOVE_DIRECTORY_TARGET: target },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    },
  )
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  return { code, stderr: stderr.trim() }
}

export async function removeDirectory(
  target: string,
  options: {
    maxRetries?: number
    retryDelay?: number
    nativeTimeout?: number
    nativeRetryDelay?: number
  } = {},
) {
  try {
    await fs.rm(target, {
      recursive: true,
      force: true,
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 100,
    })
    return
  } catch (error) {
    if (process.platform !== "win32" || !TRANSIENT_WINDOWS_ERRORS.has(errorCode(error))) throw error
  }

  const deadline = Date.now() + (options.nativeTimeout ?? 30_000)
  const delay = options.nativeRetryDelay ?? 250
  let last = ""
  while (true) {
    const result = await removeWithWindowsShell(target)
    if (result.code === 0 || !(await exists(target))) return
    last = result.stderr
    if (Date.now() >= deadline) break
    await Bun.sleep(Math.min(delay, Math.max(0, deadline - Date.now())))
  }
  throw new Error(last || `Failed to remove directory: ${target}`)
}