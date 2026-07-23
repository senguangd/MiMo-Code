import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

const nitroConfig: any = (() => {
  const target = process.env.OPENCODE_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare_module",
      cloudflare: {
        nodeCompat: true,
        wrangler: {
          name: "mimo-ai-enterprise",
        },
      },
    }
  }
  return {}
})()

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidStart() as PluginOption,
    nitro({
      ...nitroConfig,
      // Shiki already provides an inlined Oniguruma loader; Nitro raw-WASM parsing cannot bind its Emscripten env imports.
      wasm: false,
      baseURL: process.env.OPENCODE_BASE_URL,
    }),
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  worker: {
    format: "es",
  },
})
