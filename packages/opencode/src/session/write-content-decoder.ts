type Expectation = "key" | "colon" | "value" | "after"
type StringRole = "key" | "content" | "value" | "nested"

export function createWriteContentDecoder() {
  let depth = 0
  let expectation: Expectation = "key"
  let role: StringRole = "nested"
  let currentKey = ""
  let key = ""
  let inString = false
  let escape: "none" | "slash" | "unicode" = "none"
  let unicode = ""
  let pendingHigh: number | undefined
  let nestedValueDepth = 0
  let primitive = false
  let invalid = false

  return {
    feed(delta: string) {
      if (invalid || !delta) return ""
      let output = ""

      const append = (value: string) => {
        if (role === "key") key += value
        if (role === "content") output += value
      }
      const flushHigh = () => {
        if (pendingHigh === undefined) return
        append(String.fromCharCode(pendingHigh))
        pendingHigh = undefined
      }
      const appendCodeUnit = (value: number) => {
        if (pendingHigh !== undefined) {
          if (value >= 0xdc00 && value <= 0xdfff) {
            append(String.fromCodePoint(0x10000 + ((pendingHigh - 0xd800) << 10) + value - 0xdc00))
            pendingHigh = undefined
            return
          }
          flushHigh()
        }
        if (value >= 0xd800 && value <= 0xdbff) {
          pendingHigh = value
          return
        }
        append(String.fromCharCode(value))
      }
      const closeString = () => {
        flushHigh()
        inString = false
        escape = "none"
        unicode = ""
        if (role === "key") {
          currentKey = key
          key = ""
          expectation = "colon"
          return
        }
        if (role === "content" || role === "value") expectation = "after"
      }
      const openString = (next: StringRole) => {
        role = next
        inString = true
        escape = "none"
        unicode = ""
        pendingHigh = undefined
        if (next === "key") key = ""
      }

      for (const char of delta) {
        if (inString) {
          if (escape === "unicode") {
            if (!/[0-9a-f]/i.test(char)) {
              invalid = true
              break
            }
            unicode += char
            if (unicode.length < 4) continue
            appendCodeUnit(Number.parseInt(unicode, 16))
            unicode = ""
            escape = "none"
            continue
          }
          if (escape === "slash") {
            if (char === "u") {
              escape = "unicode"
              unicode = ""
              continue
            }
            const escaped = {
              '"': '"',
              "\\": "\\",
              "/": "/",
              b: "\b",
              f: "\f",
              n: "\n",
              r: "\r",
              t: "\t",
            }[char]
            if (escaped === undefined) {
              invalid = true
              break
            }
            flushHigh()
            append(escaped)
            escape = "none"
            continue
          }
          if (char === "\\") {
            escape = "slash"
            continue
          }
          if (char === '"') {
            closeString()
            continue
          }
          flushHigh()
          append(char)
          continue
        }

        if (depth === 0) {
          if (/\s/.test(char)) continue
          if (char === "{") {
            depth = 1
            expectation = "key"
            continue
          }
          invalid = true
          break
        }

        if (depth > 1) {
          if (char === '"') {
            openString("nested")
            continue
          }
          if (char === "{" || char === "[") {
            depth++
            continue
          }
          if (char !== "}" && char !== "]") continue
          depth--
          if (nestedValueDepth !== 0 && depth < nestedValueDepth) {
            nestedValueDepth = 0
            expectation = "after"
          }
          continue
        }

        if (/\s/.test(char)) continue
        if (primitive) {
          if (char === ",") {
            primitive = false
            currentKey = ""
            expectation = "key"
            continue
          }
          if (char === "}") {
            primitive = false
            depth = 0
          }
          continue
        }
        if (expectation === "key") {
          if (char === '"') {
            openString("key")
            continue
          }
          if (char === "}") {
            depth = 0
            continue
          }
          invalid = true
          break
        }
        if (expectation === "colon") {
          if (char === ":") {
            expectation = "value"
            continue
          }
          invalid = true
          break
        }
        if (expectation === "value") {
          if (char === '"') {
            openString(currentKey === "content" ? "content" : "value")
            continue
          }
          if (char === "{" || char === "[") {
            depth++
            nestedValueDepth = depth
            continue
          }
          primitive = true
          continue
        }
        if (char === ",") {
          currentKey = ""
          expectation = "key"
          continue
        }
        if (char === "}") {
          depth = 0
          continue
        }
        invalid = true
        break
      }

      return output
    },
  }
}
