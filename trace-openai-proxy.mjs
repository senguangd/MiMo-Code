// trace-openai-proxy.mjs
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const TARGET = "http://10.176.3.4:30031"
const HOST = "127.0.0.1"
const PORT = 30032
const LOG_DIR = "./adpcli-trace-logs"

const MAX_PRINT = 1200
const MAX_LOG_TEXT = 200_000

fs.mkdirSync(LOG_DIR, { recursive: true })

const logFile = path.join(
  LOG_DIR,
  `trace-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`,
)

const logStream = fs.createWriteStream(logFile, { flags: "a" })

function now() {
  return new Date().toISOString()
}

function requestId() {
  return crypto.randomUUID().slice(0, 8)
}

function truncate(s, max = MAX_LOG_TEXT) {
  if (typeof s !== "string") return s
  return s.length <= max ? s : s.slice(0, max) + `\n... <truncated ${s.length - max} chars>`
}

function preview(s, max = MAX_PRINT) {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max) + `\n... <truncated ${s.length - max} chars>`
}

function redactHeaders(headers) {
  const out = { ...headers }
  for (const key of Object.keys(out)) {
    if (key.toLowerCase() === "authorization") {
      out[key] = "Bearer ***REDACTED***"
    }
  }
  return out
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject)
  if (!value || typeof value !== "object") return value

  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase()

    if (
      key.includes("apikey") ||
      key.includes("api_key") ||
      key === "key" ||
      key.includes("token") ||
      key.includes("secret") ||
      key === "authorization"
    ) {
      out[k] = "***REDACTED***"
    } else {
      out[k] = redactObject(v)
    }
  }
  return out
}

function writeLog(event) {
  logStream.write(JSON.stringify(event) + "\n")
}

function tryJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function simplifyMessages(messages = []) {
  return messages.map((m, idx) => {
    const out = {
      idx,
      role: m.role,
    }

    if (typeof m.content === "string") {
      out.content = truncate(m.content)
    } else if (Array.isArray(m.content)) {
      out.content = m.content.map((p) => {
        if (p?.type === "text") return { type: "text", text: truncate(p.text || "") }
        return p
      })
    } else {
      out.content = m.content
    }

    if (m.tool_calls) out.tool_calls = m.tool_calls
    if (m.reasoning_content) out.reasoning_content = truncate(m.reasoning_content)

    return out
  })
}

function extractToolSchemas(tools = []) {
  return tools.map((t, idx) => ({
    idx,
    type: t.type,
    name: t.function?.name,
    description: t.function?.description,
    parameters: t.function?.parameters,
  }))
}

function extractRequestImportant(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed

  return redactObject({
    model: parsed.model,
    stream: parsed.stream,
    temperature: parsed.temperature,
    top_p: parsed.top_p,
    max_tokens: parsed.max_tokens,
    reasoning_effort: parsed.reasoning_effort,
    response_format: parsed.response_format,
    tool_choice: parsed.tool_choice,
    parallel_tool_calls: parsed.parallel_tool_calls,
    messages: simplifyMessages(parsed.messages || []),
    tools: extractToolSchemas(parsed.tools || []),
  })
}

function printRequest(id, parsed, req) {
  console.log(`\n[${id}] → ${req.method} ${req.url}`)
  if (parsed?.model) console.log(`[${id}] model=${parsed.model}`)
  if (parsed?.stream !== undefined) console.log(`[${id}] stream=${parsed.stream}`)
  if (parsed?.messages) console.log(`[${id}] messages=${parsed.messages.length}`)
  if (parsed?.tools) {
    const names = parsed.tools.map((t) => t.function?.name).filter(Boolean)
    console.log(`[${id}] tools=${names.join(", ")}`)
  }
}

function accumulateToolCall(state, toolCallsDelta) {
  for (const tc of toolCallsDelta || []) {
    const index = tc.index ?? 0
    if (!state.toolCalls[index]) {
      state.toolCalls[index] = {
        index,
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: "",
        },
      }
    }

    const target = state.toolCalls[index]

    if (tc.id) target.id += tc.id
    if (tc.type) target.type = tc.type

    if (tc.function?.name) {
      target.function.name += tc.function.name
    }

    if (tc.function?.arguments) {
      target.function.arguments += tc.function.arguments
    }
  }
}

function parseToolArguments(toolCalls) {
  return toolCalls.map((tc) => {
    const args = tc.function?.arguments || ""
    const parsed = tryJson(args)
    return {
      ...tc,
      function: {
        ...tc.function,
        arguments: parsed ?? args,
      },
    }
  })
}

function makeResponseState() {
  return {
    content: "",
    reasoning_content: "",
    toolCalls: [],
    finish_reason: undefined,
    usage: undefined,
    raw_non_stream_chunks: [],
  }
}

function handleSseData(state, data) {
  if (data === "[DONE]") {
    state.done = true
    return
  }

  const parsed = tryJson(data)
  if (!parsed) return

  const choice = parsed.choices?.[0]
  const delta = choice?.delta || {}

  if (delta.content) state.content += delta.content
  if (delta.reasoning_content) state.reasoning_content += delta.reasoning_content
  if (delta.tool_calls) accumulateToolCall(state, delta.tool_calls)

  if (choice?.finish_reason) state.finish_reason = choice.finish_reason
  if (parsed.usage) state.usage = parsed.usage
}

function handleNonStreamChunk(state, text) {
  state.raw_non_stream_chunks.push(text)

  const parsed = tryJson(text)
  if (!parsed) return

  const choice = parsed.choices?.[0]
  const msg = choice?.message || {}

  if (msg.content) state.content += msg.content
  if (msg.reasoning_content) state.reasoning_content += msg.reasoning_content
  if (msg.tool_calls) state.toolCalls.push(...msg.tool_calls)

  if (choice?.finish_reason) state.finish_reason = choice.finish_reason
  if (parsed.usage) state.usage = parsed.usage
}

function writeSummary(id, reqInfo, state) {
  const toolCalls = parseToolArguments(state.toolCalls)

  const summary = {
    ts: now(),
    id,
    kind: "summary",
    request: reqInfo,
    response: {
      content: truncate(state.content),
      reasoning_content: truncate(state.reasoning_content),
      tool_calls: redactObject(toolCalls),
      finish_reason: state.finish_reason,
      usage: state.usage,
    },
  }

  writeLog(summary)

  console.log(`[${id}] ← finish=${state.finish_reason || "unknown"}`)
  if (toolCalls.length) {
    console.log(`[${id}] tool_calls:`)
    for (const tc of toolCalls) {
      console.log(
        `[${id}]   ${tc.function?.name} ${JSON.stringify(tc.function?.arguments).slice(0, 1000)}`,
      )
    }
  }
  if (state.content.trim()) {
    console.log(`[${id}] content:\n${preview(state.content.trim())}`)
  }
  if (state.reasoning_content.trim()) {
    console.log(`[${id}] reasoning:\n${preview(state.reasoning_content.trim())}`)
  }
}

const server = http.createServer((req, res) => {
  const id = requestId()
  const chunks = []

  req.on("data", (c) => chunks.push(c))

  req.on("end", async () => {
    const body = Buffer.concat(chunks)
    const targetUrl = new URL(req.url, TARGET)

    const bodyText = body.toString("utf8")
    const parsedReq = tryJson(bodyText)
    const reqInfo = extractRequestImportant(parsedReq)

    writeLog({
      ts: now(),
      id,
      kind: "request",
      method: req.method,
      url: req.url,
      headers: redactHeaders(req.headers),
      request: reqInfo,
    })

    printRequest(id, parsedReq, req)

    const state = makeResponseState()

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: req.headers,
        body: body.length ? body : undefined,
      })

      writeLog({
        ts: now(),
        id,
        kind: "response_headers",
        status: upstream.status,
        headers: Object.fromEntries(upstream.headers),
      })

      console.log(`[${id}] status=${upstream.status}`)

      res.writeHead(upstream.status, Object.fromEntries(upstream.headers))

      const contentType = upstream.headers.get("content-type") || ""
      const reader = upstream.body?.getReader()

      if (!reader) {
        writeSummary(id, reqInfo, state)
        res.end()
        return
      }

      const decoder = new TextDecoder()
      let sseBuffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })

        if (contentType.includes("text/event-stream")) {
          sseBuffer += text
          const lines = sseBuffer.split(/\r?\n/)
          sseBuffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            handleSseData(state, line.slice("data: ".length))
          }
        } else {
          handleNonStreamChunk(state, text)
        }

        res.write(value)
      }

      if (sseBuffer.trim()) {
        for (const line of sseBuffer.split(/\r?\n/)) {
          if (!line.startsWith("data: ")) continue
          handleSseData(state, line.slice("data: ".length))
        }
      }

      writeSummary(id, reqInfo, state)

      res.end()
    } catch (err) {
      writeLog({
        ts: now(),
        id,
        kind: "proxy_error",
        error: String(err?.stack || err),
      })

      console.error(`[${id}] proxy error`, err)
      res.statusCode = 502
      res.end(JSON.stringify({ error: "trace proxy error", detail: String(err) }))
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`Trace proxy listening on http://${HOST}:${PORT}`)
  console.log(`Forwarding to ${TARGET}`)
  console.log(`Writing logs to ${logFile}`)
})
