import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  ADPCLI_CHANNEL: process.env["ADPCLI_CHANNEL"],
  ADPCLI_BUMP: process.env["ADPCLI_BUMP"],
  ADPCLI_VERSION: process.env["ADPCLI_VERSION"],
  ADPCLI_RELEASE: process.env["ADPCLI_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.ADPCLI_CHANNEL) return env.ADPCLI_CHANNEL
  if (env.ADPCLI_BUMP) return "latest"
  if (env.ADPCLI_VERSION && !env.ADPCLI_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim()) || "latest"
})()
const IS_PREVIEW = CHANNEL !== "latest"

const SHORT_SHA = await (async () => {
  try {
    const sha = await $`git rev-parse --short HEAD`.text()
    return sha.trim()
  } catch {
    return process.env["ADPCLI_COMMIT_SHA"] ?? null
  }
})()

const VERSION = await (async () => {
  if (env.ADPCLI_VERSION) return env.ADPCLI_VERSION
  if (IS_PREVIEW) {
    if (SHORT_SHA) return `0.0.0-${CHANNEL}-${SHORT_SHA}`
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)
    return `0.0.0-${CHANNEL}-${ts}`
  }
  const version = await Bun.file(path.resolve(import.meta.dir, "../../opencode/package.json"))
    .json()
    .then((data: any) => data.version)
  const t = env.ADPCLI_BUMP?.toLowerCase()
  if (!t) return version
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.ADPCLI_RELEASE
  },
}
console.log(`adpcli script`, JSON.stringify(Script, null, 2))
