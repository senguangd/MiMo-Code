import { redactString } from "./mcp"

const exact = new Set([
  "auth",
  "authorization",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "client_secret",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "refresh_token",
  "auth_token",
  "credential",
  "credentials",
  "cookie",
  "set_cookie",
])
const terms = new Set([
  "authorization",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "credential",
  "credentials",
  "cookie",
])
const argumentLists = new Set(["args", "argv", "command"])
const redactedContainers = new Set(["env", "environment", "headers"])

function normalize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
}

function sensitive(key: string) {
  const value = normalize(key)
  if (exact.has(value)) return true
  const parts = value.split("_")
  if (parts.some((part) => terms.has(part))) return true
  return /(?:^|_)(?:api|private|signing|encryption|ssh|license)_?key$/.test(value)
}

function argument(input: unknown) {
  if (typeof input !== "string") return false
  const match = input.match(/^(-{1,2})([^=\s]+)(=(.*))?$/)
  if (!match) return false
  return {
    prefix: match[1] + match[2],
    sensitive: sensitive(match[2]),
    inline: match[3] !== undefined,
  }
}

export function value(input: unknown): unknown {
  const seen = new WeakMap<object, unknown>()

  function visit(item: unknown, parentKey?: string): unknown {
    if (typeof item === "string") return redactString(item)
    if (!item || typeof item !== "object") return item
    const existing = seen.get(item)
    if (existing) return "<circular>"

    if (Array.isArray(item)) {
      const output: unknown[] = []
      seen.set(item, output)
      const argumentsList = parentKey !== undefined && argumentLists.has(normalize(parentKey))
      for (let index = 0; index < item.length; index++) {
        const current = argumentsList && argument(item[index])
        const previous = argumentsList && index > 0 && argument(item[index - 1])
        if (current && current.sensitive && current.inline) output.push(`${current.prefix}=<redacted>`)
        else if (previous && previous.sensitive && !previous.inline) output.push("<redacted>")
        else output.push(visit(item[index]))
      }
      return output
    }

    const output: Record<string, unknown> = {}
    seen.set(item, output)
    const redactValues = parentKey !== undefined && redactedContainers.has(normalize(parentKey))
    for (const [key, child] of Object.entries(item)) {
      output[key] = sensitive(key) || redactValues ? "<redacted>" : visit(child, key)
    }
    return output
  }

  return visit(input)
}
