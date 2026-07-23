import { describe, expect, test } from "bun:test"
import path from "node:path"

const app = path.resolve(import.meta.dir, "..")
const ui = path.resolve(app, "../ui")

const text = (file: string) => Bun.file(file).text()

describe("AdpCli web branding", () => {
  test("uses AdpCli document and install metadata", async () => {
    expect(await text(path.join(app, "index.html"))).toContain("<title>AdpCli</title>")
    const manifest = await Bun.file(path.join(ui, "src/assets/favicon/site.webmanifest")).json()
    expect(manifest.name).toBe("AdpCli")
    expect(manifest.short_name).toBe("AdpCli")
  })

  test("does not load OpenCode branding for web icons", async () => {
    const index = await text(path.join(app, "index.html"))
    const entry = await text(path.join(app, "src/entry.tsx"))
    expect(index).not.toContain("favicon-v3")
    expect(entry).not.toContain("opencode.ai/favicon")
    expect(index).toContain("/adpcli-favicon.svg")
    expect(entry).toContain('icon: "/adpcli-icon-192.png"')
  })

  test("ships every referenced AdpCli icon", async () => {
    const files = [
      "adpcli-favicon-96.png",
      "adpcli-favicon.svg",
      "adpcli-favicon.ico",
      "adpcli-apple-touch-icon.png",
      "adpcli-icon-192.png",
      "adpcli-icon-512.png",
    ]
    for (const file of files) expect(Bun.file(path.join(app, "public", file)).size).toBeGreaterThan(0)
  })
})
