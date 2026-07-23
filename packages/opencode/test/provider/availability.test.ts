import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { Config, ConfigParse, ConfigPaths } from "../../src/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Global } from "../../src/global"
import { ProviderAvailability } from "../../src/provider"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { Flock } from "@adp-ai/shared/util/flock"

const providerID = "availability-test"
const modelID = "gateway-model"
const globalConfig = path.join(Global.Path.config, "adpcli.jsonc")

function invalidate() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const config = yield* Config.Service
      yield* config.invalidate(true)
    }),
  )
}

function setAuth(info: Auth.Info) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set(providerID, info)
    }),
  )
}

function getAuth() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      return yield* auth.get(providerID)
    }),
  )
}

function inspectDefaultModel(apiKey?: string, timeoutMs?: number) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      return yield* ProviderAvailability.inspectDefaultModel({ apiKey, timeoutMs })
    }),
  )
}

function saveApiKey(input: { key: string; modelID?: string; persistUnverified?: boolean }) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      return yield* ProviderAvailability.setApiKey({ providerID, ...input })
    }),
  )
}

function updateGlobal(config: Config.Info) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.updateGlobal(config)
    }),
  )
}

async function clearState() {
  await fs.rm(globalConfig, { force: true })
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.remove(providerID)
      const config = yield* Config.Service
      yield* config.invalidate(true)
    }),
  )
}

beforeEach(clearState)
afterEach(clearState)

describe("provider availability", () => {
  test("classifies an unconnected built-in provider as missing credentials", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "adpcli.json"),
          JSON.stringify({
            model: "anthropic/claude-sonnet-4-20250514",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await inspectDefaultModel()
        expect(status.status).toBe("credential_missing")
        expect(status.providerID).toBe("anthropic")
        expect(status.remediation.login).toBe(true)
      },
    })
  })

  test("classifies authentication and provider failures through the real /models endpoint", async () => {
    let mode:
      | "ready"
      | "forbidden"
      | "limited"
      | "unavailable"
      | "missing-model"
      | "unsupported"
      | "redirect"
      | "slow" = "ready"
    let redirectedRequests = 0
    const redirectTarget = Bun.serve({
      port: 0,
      fetch() {
        redirectedRequests++
        return new Response("should not be reached")
      },
    })
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (mode === "slow") await Bun.sleep(100)
        if (mode === "forbidden") return new Response("forbidden", { status: 403 })
        if (mode === "limited") return new Response("limited", { status: 429 })
        if (mode === "unavailable") return new Response("unavailable", { status: 503 })
        if (mode === "unsupported") return new Response("missing", { status: 404 })
        if (mode === "redirect") {
          return new Response(null, {
            status: 302,
            headers: { location: `http://127.0.0.1:${redirectTarget.port}/capture` },
          })
        }
        if (request.headers.get("authorization") !== "Bearer valid-key") {
          return new Response("unauthorized", { status: 401 })
        }
        return Response.json({ data: [{ id: mode === "missing-model" ? "another-model" : modelID }] })
      },
    })
    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "adpcli.json"),
            JSON.stringify({
              model: `${providerID}/${modelID}`,
              provider: {
                [providerID]: {
                  name: "Availability Test",
                  npm: "@ai-sdk/openai-compatible",
                  env: [],
                  options: {
                    baseURL: `http://127.0.0.1:${server.port}/v1`,
                    headers: { Authorization: "Bearer stale-key" },
                  },
                  models: {
                    [modelID]: {
                      name: "Gateway Model",
                      tool_call: true,
                      limit: { context: 32000, output: 8000 },
                    },
                  },
                },
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect((await inspectDefaultModel()).status).toBe("credential_missing")
          expect((await inspectDefaultModel("wrong-key")).status).toBe("authentication_failed")
          expect((await inspectDefaultModel("valid-key")).status).toBe("ready")

          mode = "forbidden"
          expect((await inspectDefaultModel("valid-key")).status).toBe("permission_denied")
          mode = "limited"
          expect((await inspectDefaultModel("valid-key")).status).toBe("rate_limited")
          mode = "unavailable"
          expect((await inspectDefaultModel("valid-key")).status).toBe("provider_unavailable")
          mode = "missing-model"
          expect((await inspectDefaultModel("valid-key")).status).toBe("model_not_found")
          mode = "unsupported"
          expect((await inspectDefaultModel("valid-key")).status).toBe("credential_unverified")
          mode = "redirect"
          expect((await inspectDefaultModel("valid-key")).status).toBe("endpoint_unreachable")
          expect(redirectedRequests).toBe(0)
          mode = "slow"
          expect((await inspectDefaultModel("valid-key", 10)).status).toBe("endpoint_unreachable")
        },
      })
    } finally {
      server.stop(true)
      redirectTarget.stop(true)
    }
  })

  test("exposes default-model recovery through the mounted provider HTTP routes", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.headers.get("authorization") !== "Bearer route-key") {
          return new Response("unauthorized", { status: 401 })
        }
        return Response.json({ data: [{ id: modelID }] })
      },
    })
    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "adpcli.json"),
            JSON.stringify({
              provider: {
                [providerID]: {
                  name: "Availability Route Test",
                  npm: "@ai-sdk/openai-compatible",
                  env: [],
                  options: { baseURL: `http://127.0.0.1:${upstream.port}/v1` },
                  models: {
                    [modelID]: {
                      name: "Gateway Model",
                      tool_call: true,
                      limit: { context: 32000, output: 8000 },
                    },
                  },
                },
              },
            }),
          )
        },
      })
      const app = Server.Default().app
      const headers = {
        "content-type": "application/json",
        "x-adpcli-directory": tmp.path,
      }

      const setModel = await app.request("/provider/default-model", {
        method: "PUT",
        headers,
        body: JSON.stringify({ model: `${providerID}/${modelID}` }),
      })
      expect(setModel.status).toBe(200)
      expect(await setModel.json()).toMatchObject({
        status: "ready",
        providerID,
        modelID,
      })

      await Instance.disposeAll()
      const missing = await app.request("/provider/default-model/status", { headers })
      expect(missing.status).toBe(200)
      expect(await missing.json()).toMatchObject({
        status: "credential_missing",
        providerID,
        modelID,
      })

      const setKey = await app.request(`/provider/${providerID}/api-key`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ key: "route-key", modelID }),
      })
      expect(setKey.status).toBe(200)
      expect(await setKey.json()).toMatchObject({ status: "ready", providerID, modelID })

      const saved = ConfigParse.jsonc(await fs.readFile(globalConfig, "utf8"), globalConfig) as {
        model: string
        provider: Record<string, { options: { apiKey: string } }>
      }
      expect(saved.model).toBe(`${providerID}/${modelID}`)
      expect(saved.provider[providerID].options.apiKey).toBe("route-key")
    } finally {
      upstream.stop(true)
      await Instance.disposeAll()
    }
  })

  test("persists a verified API key as a minimal JSONC patch and removes only plain legacy auth", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.headers.get("authorization") !== "Bearer replacement-key") {
          return new Response("unauthorized", { status: 401 })
        }
        return Response.json({ data: [{ id: modelID }] })
      },
    })
    try {
      const baseURL = `http://127.0.0.1:${server.port}/v1`
      await fs.mkdir(Global.Path.config, { recursive: true })
      const before = `{
  // keep this comment
  "permission": { "bash": "ask" },
  "provider": {
    "${providerID}": {
      "options": {
        "baseURL": "${baseURL}"
      }
    }
  }
}\n`
      await fs.writeFile(globalConfig, before)
      await invalidate()
      await setAuth({ type: "api", key: "legacy-key" })

      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "adpcli.json"),
            JSON.stringify({
              model: `${providerID}/${modelID}`,
              provider: {
                [providerID]: {
                  name: "Availability Test",
                  npm: "@ai-sdk/openai-compatible",
                  env: [],
                  models: {
                    [modelID]: {
                      name: "Gateway Model",
                      tool_call: true,
                      limit: { context: 32000, output: 8000 },
                    },
                  },
                },
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const saved = await saveApiKey({
            modelID,
            key: "replacement-key",
          })
          expect(saved.status).toBe("ready")
        },
      })

      const after = await fs.readFile(globalConfig, "utf8")
      const parsed = ConfigParse.jsonc(after, globalConfig) as {
        permission: unknown
        provider: Record<string, { options: Record<string, unknown> }>
      }
      expect(after).toContain("// keep this comment")
      expect(parsed.permission).toEqual({ bash: "ask" })
      expect(parsed.provider[providerID].options.baseURL).toBe(baseURL)
      expect(parsed.provider[providerID].options.apiKey).toBe("replacement-key")
      expect(await getAuth()).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  test("does not delete API auth entries that carry provider metadata", async () => {
    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(globalConfig, "{}\n")
    await invalidate()
    await setAuth({
      type: "api",
      key: "metadata-key",
      metadata: { accountId: "account" },
    })

    const saved = await saveApiKey({
      key: "config-key",
      persistUnverified: true,
    })
    expect(saved.status).toBe("credential_unverified")
    expect(await getAuth()).toEqual({
      type: "api",
      key: "metadata-key",
      metadata: { accountId: "account" },
    })
  })

  test.skipIf(process.platform === "win32")(
    "writes global configuration with owner-only permissions when it stores credentials",
    async () => {
      await fs.mkdir(Global.Path.config, { recursive: true })
      await fs.writeFile(globalConfig, "{}\n", { mode: 0o644 })
      await fs.chmod(globalConfig, 0o644)
      await invalidate()

      await saveApiKey({
        key: "permission-test-key",
        persistUnverified: true,
      })

      const mode = (await fs.stat(globalConfig)).mode & 0o777
      expect(mode).toBe(0o600)
    },
  )

  test("shares the same logical config lock with promise-based config writers", async () => {
    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(globalConfig, "{}\n")
    await invalidate()

    const lease = await Flock.acquire(ConfigPaths.lockKey(Global.Path.config, "adpcli"))
    let settled = false
    const pending = updateGlobal({ username: "locked" }).then(() => {
      settled = true
    })
    await Bun.sleep(50)
    expect(settled).toBe(false)
    await lease.release()
    await pending
    expect(settled).toBe(true)
  })

  test("serializes concurrent global JSONC patches without losing either update", async () => {
    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(globalConfig, "{\n  // concurrent writes\n}\n")
    await invalidate()

    await Promise.all([
      updateGlobal({ username: "alice" }),
      updateGlobal({ snapshot: false }),
    ])

    const after = await fs.readFile(globalConfig, "utf8")
    const parsed = ConfigParse.jsonc(after, globalConfig) as { username: string; snapshot: boolean }
    expect(after).toContain("// concurrent writes")
    expect(parsed.username).toBe("alice")
    expect(parsed.snapshot).toBe(false)
  })
})
