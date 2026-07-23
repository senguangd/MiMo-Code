import { GlobalBus } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@adp-ai/shared/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util"
import { withTimeout } from "@/util/timeout"
import { LocalContext } from "../util"
import * as Project from "./project"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { parse as pathParse } from "path"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

const context = LocalContext.create<InstanceContext>("instance")
const cache = new Map<string, Promise<InstanceContext>>()
// Bounded gates preserve the public disposeDirectory contract: callers wait at
// most DIRECTORY_DISPOSE_TIMEOUT before a replacement may initialize.
const directoryDisposals = new Map<string, Promise<void>>()
// Full cleanups outlive the bounded gate and are awaited by deletion boundaries
// (worktree removal / test fixture teardown) that must not race open handles.
const directoryCleanups = new Map<string, Promise<void>>()
const project = makeRuntime(Project.Service, Project.defaultLayer)
const DIRECTORY_DISPOSE_TIMEOUT = 2_000

const POSIX_FORBIDDEN_PREFIXES = ["/etc", "/proc", "/sys", "/dev", "/boot", "/private/etc"] as const

function protectedSystemDirectories() {
  if (process.platform !== "win32") return POSIX_FORBIDDEN_PREFIXES
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR
  return systemRoot ? [systemRoot] : []
}

function assertSafeDirectory(directory: string): void {
  const resolved = AppFileSystem.resolve(directory)
  if (resolved === pathParse(resolved).root) {
    throw new Error("Access denied: filesystem root is not a valid project directory")
  }
  for (const prefix of protectedSystemDirectories()) {
    if (AppFileSystem.contains(AppFileSystem.resolve(prefix), resolved)) {
      throw new Error("Access denied: target is a protected system directory")
    }
  }
}

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function boot(input: { directory: string; init?: () => Promise<any>; worktree?: string; project?: Project.Info }) {
  return iife(async () => {
    const ctx =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
          }
        : await project
            .runPromise((svc) => svc.fromDirectory(input.directory))
            .then(({ project, sandbox }) => ({
              directory: input.directory,
              worktree: sandbox,
              project,
            }))
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(directory: string, next: Promise<InstanceContext>) {
  const task = next.catch((error) => {
    if (cache.get(directory) === task) cache.delete(directory)
    throw error
  })
  cache.set(directory, task)
  return task
}

async function disposeCached(directory: string, current: Promise<InstanceContext>) {
  const ctx = await current.catch(() => undefined)
  if (!ctx || cache.get(directory) !== current) return

  cache.delete(directory)
  Log.Default.info("disposing instance", { directory })
  await context.provide(ctx, () => disposeInstance(directory))

  GlobalBus.emit("event", {
    directory,
    project: ctx.project.id,
    workspace: WorkspaceContext.workspaceID,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

function beginDirectoryCleanup(directory: string, current: Promise<InstanceContext>) {
  const existing = directoryCleanups.get(directory)
  if (existing) return existing
  const cleanup = disposeCached(directory, current).finally(() => {
    if (directoryCleanups.get(directory) === cleanup) directoryCleanups.delete(directory)
  })
  directoryCleanups.set(directory, cleanup)
  return cleanup
}

function beginDirectoryDisposal(directory: string, cleanup: Promise<void>) {
  const existing = directoryDisposals.get(directory)
  if (existing) return existing
  const bounded = withTimeout(cleanup, DIRECTORY_DISPOSE_TIMEOUT)
    .catch((error) => {
      Log.Default.warn("instance dispose did not complete", { directory, error })
    })
    .finally(() => {
      if (directoryDisposals.get(directory) === bounded) directoryDisposals.delete(directory)
    })
  directoryDisposals.set(directory, bounded)
  return bounded
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = AppFileSystem.resolve(input.directory)
    assertSafeDirectory(directory)
    await directoryDisposals.get(directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      existing = track(
        directory,
        boot({
          directory,
          init: input.init,
        }),
      )
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get current() {
    return context.use()
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },

  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string, ctx?: InstanceContext) {
    const instance = ctx ?? Instance
    if (AppFileSystem.contains(instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (instance.worktree === "/") return false
    return AppFileSystem.contains(instance.worktree, filepath)
  },
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = AppFileSystem.resolve(input.directory)
    await directoryDisposals.get(directory)
    Log.Default.info("reloading instance", { directory })
    await disposeInstance(directory)
    cache.delete(directory)
    const next = track(directory, boot({ ...input, directory }))

    GlobalBus.emit("event", {
      directory,
      project: input.project?.id,
      workspace: WorkspaceContext.workspaceID,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory,
        },
      },
    })

    return await next
  },
  async disposeDirectory(input: string) {
    const directory = AppFileSystem.resolve(input)
    assertSafeDirectory(directory)
    const pending = directoryDisposals.get(directory)
    if (pending) {
      await pending
      return
    }
    const current = cache.get(directory)
    if (!current) return
    const cleanup = beginDirectoryCleanup(directory, current)
    await beginDirectoryDisposal(directory, cleanup)
  },
  async disposeDirectoryFully(input: string) {
    const directory = AppFileSystem.resolve(input)
    assertSafeDirectory(directory)
    while (true) {
      const cleanup = directoryCleanups.get(directory)
      if (cleanup) await cleanup
      const current = cache.get(directory)
      if (!current) return
      await beginDirectoryCleanup(directory, current)
    }
  },
  async dispose() {
    const directory = Instance.directory
    const project = Instance.project
    Log.Default.info("disposing instance", { directory })
    await disposeInstance(directory)
    cache.delete(directory)

    GlobalBus.emit("event", {
      directory,
      project: project.id,
      workspace: WorkspaceContext.workspaceID,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory,
        },
      },
    })
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
