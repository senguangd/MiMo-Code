const marker = "\n// -- CommonJS Shims --\n"
const ending = "const require = __cjs_mod__.createRequire(import.meta.url);\n"

export function relocateElectronViteEsmShim(code: string) {
  const start = code.indexOf(marker)
  if (start === -1) return

  const last = code.indexOf(ending, start)
  if (last === -1) return

  const end = last + ending.length
  return code.slice(start + 1, end) + code.slice(0, start) + code.slice(end)
}

export function electronViteEsmShimPlugin() {
  return {
    name: "opencode:electron-vite-esm-shim",
    enforce: "post" as const,
    renderChunk(code: string) {
      const result = relocateElectronViteEsmShim(code)
      if (!result) return null
      return {
        code: result,
        map: null,
      }
    },
  }
}
