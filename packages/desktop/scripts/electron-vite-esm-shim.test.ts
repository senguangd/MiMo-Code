import { describe, expect, test } from "bun:test"
import { relocateElectronViteEsmShim } from "./electron-vite-esm-shim"

const shim = `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`

describe("electron-vite ESM shim", () => {
  test("repairs a shim inserted inside a string literal", () => {
    const result = relocateElectronViteEsmShim(
      `import { createRequire } from "node:module";\nconst log = create({ service: "${shim}external-import" });\n`,
    )

    expect(result?.startsWith("// -- CommonJS Shims --")).toBe(true)
    expect(result).toContain('create({ service: "external-import" })')
    expect(result?.match(/\/\/ -- CommonJS Shims --/g)).toHaveLength(1)
  })

  test("moves a correctly emitted shim without changing the module body", () => {
    const body = `import value from "value";\n${shim}console.log(value);\n`
    const result = relocateElectronViteEsmShim(body)

    expect(result).toBe(`${shim.slice(1)}import value from "value";\nconsole.log(value);\n`)
  })

  test("supports the portable shim variant", () => {
    const portable = `
// -- CommonJS Shims --
import __cjs_url__ from 'node:url';
import __cjs_path__ from 'node:path';
import __cjs_mod__ from 'node:module';
const __filename = __cjs_url__.fileURLToPath(import.meta.url);
const __dirname = __cjs_path__.dirname(__filename);
const require = __cjs_mod__.createRequire(import.meta.url);
`

    expect(relocateElectronViteEsmShim(`const value = "${portable}x";\n`)).toContain('const value = "x";')
  })

  test("leaves chunks without a complete shim unchanged", () => {
    expect(relocateElectronViteEsmShim("export const value = 1\n")).toBeUndefined()
    expect(relocateElectronViteEsmShim("\n// -- CommonJS Shims --\nexport const value = 1\n")).toBeUndefined()
  })
})
