import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import {
  CorsMiddleware,
  createOriginPolicy,
  OriginMiddleware,
  SecurityHeadersMiddleware,
} from "../../src/server/middleware"

function app(cors: string[] = []) {
  const origins = createOriginPolicy(cors)
  return new Hono()
    .use(SecurityHeadersMiddleware)
    .use(CorsMiddleware(origins))
    .use(OriginMiddleware(origins))
    .post("/write", (c) => c.json({ ok: true }))
}

describe("OriginMiddleware", () => {
  test("allows non-browser clients without an Origin header", async () => {
    expect((await app().request("/write", { method: "POST" })).status).toBe(200)
  })

  test("allows built-in local and desktop origins", async () => {
    for (const origin of [
      "https://opencode.ai",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://[::1]:4173",
      "tauri://localhost",
      "https://tauri.localhost",
    ]) {
      expect((await app().request("/write", { method: "POST", headers: { Origin: origin } })).status).toBe(200)
    }
  })

  test("allows and normalizes explicitly configured origins", async () => {
    const configured = app(["https://console.example.com:443/", "oc://renderer"])
    expect(
      (
        await configured.request("/write", {
          method: "POST",
          headers: { Origin: "https://console.example.com" },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await configured.request("/write", {
          method: "POST",
          headers: { Origin: "oc://renderer" },
        })
      ).status,
    ).toBe(200)
  })

  test("sets CORS response headers only for allowed origins", async () => {
    const allowed = await app(["https://console.example.com"]).request("/write", {
      method: "OPTIONS",
      headers: {
        Origin: "https://console.example.com",
        "Access-Control-Request-Method": "POST",
      },
    })
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://console.example.com")

    const rejected = await app(["https://console.example.com"]).request("/write", {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
      },
    })
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("rejects malformed configured origins at startup", () => {
    for (const origin of [
      "console.example.com",
      " https://console.example.com",
      "https://user:password@console.example.com",
      "https://console.example.com/path",
      "https://console.example.com?token=secret",
      "https://console.example.com#fragment",
    ]) {
      expect(() => createOriginPolicy([origin])).toThrow("Invalid CORS origin")
    }
  })

  test("rejects cross-site browser requests that omit Origin", async () => {
    const response = await app().request("/write", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "  Cross-Site  " },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  test("marks responses as non-sniffable", async () => {
    const response = await app().request("/write", { method: "POST" })
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })

  test("rejects untrusted, unlisted subdomain, and lookalike browser origins", async () => {
    for (const origin of [
      "https://attacker.example",
      "https://dev.opencode.ai",
      "https://customer.opencode.ai",
      "https://opencode.ai.attacker.example",
      "http://localhost.attacker.example:3000",
    ]) {
      const response = await app().request("/write", { method: "POST", headers: { Origin: origin } })
      expect(response.status).toBe(403)
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }
  })
})
