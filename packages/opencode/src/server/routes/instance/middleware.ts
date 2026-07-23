import type { MiddlewareHandler } from "hono"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceID } from "@/control-plane/schema"
import {
  DIRECTORY_ACCESS_DENIED,
  isDirectoryAllowed,
  resolveDirectory,
  type DirectoryAccessPolicy,
} from "@/server/directory-access"

export function InstanceMiddleware(
  workspaceID?: WorkspaceID,
  directoryAccess?: DirectoryAccessPolicy,
): MiddlewareHandler {
  return async (c, next) => {
    const directory = resolveDirectory(
      c.req.query("directory") || c.req.header("x-adpcli-directory") || process.cwd(),
    )

    if (!isDirectoryAllowed(directory, directoryAccess)) {
      return c.json({ error: DIRECTORY_ACCESS_DENIED }, 403)
    }

    return WorkspaceContext.provide({
      workspaceID,
      async fn() {
        return Instance.provide({
          directory,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          async fn() {
            return next()
          },
        })
      },
    })
  }
}
