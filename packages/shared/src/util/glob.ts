import { glob, globIterate, globIterateSync, globSync, type GlobOptions } from "glob"
import { minimatch } from "minimatch"

export namespace Glob {
  export interface Options {
    cwd?: string
    absolute?: boolean
    include?: "file" | "all"
    dot?: boolean
    symlink?: boolean
    maxResults?: number
  }

  function toGlobOptions(options: Options): GlobOptions {
    return {
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      follow: options.symlink ?? false,
      nodir: options.include !== "all",
    }
  }

  function limit(options: Options): number | undefined {
    if (options.maxResults === undefined) return undefined
    if (!Number.isSafeInteger(options.maxResults) || options.maxResults < 0) {
      throw new RangeError("maxResults must be a non-negative integer")
    }
    return options.maxResults
  }

  function stringResult(result: unknown) {
    if (typeof result !== "string") throw new TypeError("glob returned a non-string result")
    return result
  }

  export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
    const maxResults = limit(options)
    if (maxResults === undefined) return (await glob(pattern, toGlobOptions(options))).map(stringResult)

    const results: string[] = []
    for await (const result of globIterate(pattern, toGlobOptions(options))) {
      if (results.length >= maxResults) {
        throw new Error(`glob exceeded the ${maxResults}-result limit`)
      }
      results.push(stringResult(result))
    }
    return results
  }

  export function scanSync(pattern: string, options: Options = {}): string[] {
    const maxResults = limit(options)
    if (maxResults === undefined) return globSync(pattern, toGlobOptions(options)).map(stringResult)

    const results: string[] = []
    for (const result of globIterateSync(pattern, toGlobOptions(options))) {
      if (results.length >= maxResults) {
        throw new Error(`glob exceeded the ${maxResults}-result limit`)
      }
      results.push(stringResult(result))
    }
    return results
  }

  export function match(pattern: string, filepath: string): boolean {
    return minimatch(filepath, pattern, { dot: true })
  }
}
