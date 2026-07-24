import { describe, expect, test } from "bun:test"
import { createWriteContentDecoder } from "../../src/session/write-content-decoder"

function decode(input: string, chunks: number[]) {
  const decoder = createWriteContentDecoder()
  const output: string[] = []
  let offset = 0
  for (const size of chunks) {
    output.push(decoder.feed(input.slice(offset, offset + size)))
    offset += size
  }
  output.push(decoder.feed(input.slice(offset)))
  return output.join("")
}

describe("createWriteContentDecoder", () => {
  test("decodes content correctly across every two-chunk boundary", () => {
    const content = '第一行\nquote " slash \ emoji 🚀 tab\t end'
    const input = JSON.stringify({ content, file_path: "/tmp/demo.txt" })
    for (let split = 0; split <= input.length; split++) {
      expect(decode(input, [split])).toBe(content)
    }
  })

  test("decodes one character at a time", () => {
    const content = Array.from({ length: 30 }, (_, index) => "第" + (index + 1) + "行中文内容").join("\n")
    const input = JSON.stringify({ file_path: "/tmp/demo.txt", content })
    expect(decode(input, Array.from({ length: input.length }, () => 1))).toBe(content)
  })

  test("ignores nested content keys and text that mentions content", () => {
    const input = JSON.stringify({
      metadata: { content: "wrong" },
      file_path: "/tmp/demo.txt",
      content: 'right value with "content" inside',
    })
    expect(decode(input, [7, 3, 11, 2, 1, 9])).toBe('right value with "content" inside')
  })

  test("decodes escaped surrogate pairs split across chunks", () => {
    const input = '{"content":"before \uD83D\uDE80 after","file_path":"x"}'
    expect(decode(input, Array.from({ length: input.length }, () => 1))).toBe("before 🚀 after")
  })

  test("fails closed on malformed input without throwing", () => {
    const decoder = createWriteContentDecoder()
    expect(decoder.feed('{"content":"safe' + String.fromCharCode(92) + "q")).toBe("safe")
    expect(decoder.feed('more"}')).toBe("")
  })
})
