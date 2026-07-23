import { Provider } from "../provider"
import { NamedError } from "@adp-ai/shared/util/error"
import { NotFoundError } from "../storage"
import { Session } from "../session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { Log } from "../util"
import { Flag } from "@/flag/flag"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { compress } from "hono/compress"
import { isPtyConnectPath, PTY_CONNECT_TICKET_QUERY } from "./pty-ticket"

const log = Log.create({ service: "server" })

export const ErrorMiddleware: ErrorHandler = (err, c) => {
  log.error("failed", {
    error: err,
  })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err.name === "ProviderAuthValidationFailed") status = 400
    else if (err.name.startsWith("Worktree")) status = 400
    else status = 500
    return c.json(err.toObject(), { status })
  }
  if (err instanceof Session.BusyError) {
    return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 409 })
  }
  if (err instanceof HTTPException) return err.getResponse()
  const message = err instanceof Error ? err.message : "Internal Server Error"
  return c.json(new NamedError.Unknown({ message }).toObject(), {
    status: 500,
  })
}

export const AuthMiddleware: MiddlewareHandler = (c, next) => {
  if (c.req.method === "OPTIONS") return next()
  const password = Flag.ADPCLI_SERVER_PASSWORD
  if (!password) return next()

  // PTY websocket connect with a ticket skips basic auth; the handler validates the ticket.
  const path = new URL(c.req.url).pathname
  if (isPtyConnectPath(path) && c.req.query(PTY_CONNECT_TICKET_QUERY)) return next()

  const username = Flag.ADPCLI_SERVER_USERNAME ?? "adpcli"

  return basicAuth({ username, password })(c, next)
}

export const SecurityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  await next()
}

export const LoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const skip = c.req.path === "/log"
  if (!skip) {
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
    })
  }
  const timer = log.time("request", {
    method: c.req.method,
    path: c.req.path,
  })
  await next()
  if (!skip) timer.stop()
}

const builtinOrigins = new Set([
  "https://opencode.ai",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
])
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

function normalizeOrigin(input: string) {
  if (input !== input.trim()) throw new Error("origin must not contain surrounding whitespace")
  const url = new URL(input)
  if (!url.hostname) throw new Error("origin must include a host")
  if (url.username || url.password) throw new Error("origin must not include credentials")
  if (url.search || url.hash) throw new Error("origin must not include a query or fragment")
  if (url.pathname && url.pathname !== "/") throw new Error("origin must not include a path")
  return `${url.protocol}//${url.host}`
}

export type OriginPolicy = (input: string) => boolean

export function createOriginPolicy(cors: string[] = []): OriginPolicy {
  const configured = new Set(
    cors.map((input) => {
      try {
        return normalizeOrigin(input)
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid origin"
        throw new Error(`Invalid CORS origin ${JSON.stringify(input)}: ${reason}`, { cause: error })
      }
    }),
  )

  return (input) => {
    let origin: string
    try {
      origin = normalizeOrigin(input)
    } catch {
      return false
    }
    if (builtinOrigins.has(origin) || configured.has(origin)) return true

    const url = new URL(origin)
    return url.protocol === "http:" && loopbackHosts.has(url.hostname)
  }
}

export function CorsMiddleware(allowedOrigin: OriginPolicy): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      return input && allowedOrigin(input) ? input : undefined
    },
  })
}

export function OriginMiddleware(allowedOrigin: OriginPolicy): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin")
    if (origin && !allowedOrigin(origin)) return c.json({ error: "Origin is not allowed" }, 403)
    if (!origin && c.req.header("sec-fetch-site")?.trim().toLowerCase() === "cross-site") {
      return c.json({ error: "Cross-site requests are not allowed" }, 403)
    }
    return next()
  }
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const path = c.req.path
  const method = c.req.method
  if (path === "/event" || path === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return next()
  return zipped(c, next)
}
