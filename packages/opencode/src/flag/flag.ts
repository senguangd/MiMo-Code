import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function nonNegativeNumber(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

const ADPCLI_EXPERIMENTAL = truthy("ADPCLI_EXPERIMENTAL")

// Defaults to false. When enabled, adpcli runs in pure-adp mode:
//   — does NOT inherit Claude Code's settings (CLAUDE.md, ~/.claude/skills, etc.)
//   — does NOT pick up provider API keys from environment variables
//   — falls back to the adp-auto model as the default
// Set ADPCLI_ADP_ONLY=true to disable .claude inheritance and env-based
// provider auto-detection.
const ADPCLI_ADP_ONLY = truthy("ADPCLI_ADP_ONLY")
const ADPCLI_DISABLE_CLAUDE_CODE_ENV = truthy("ADPCLI_DISABLE_CLAUDE_CODE")
const ADPCLI_DISABLE_CLAUDE_CODE = ADPCLI_ADP_ONLY || ADPCLI_DISABLE_CLAUDE_CODE_ENV

const ADPCLI_DISABLE_EXTERNAL_SKILLS = truthy("ADPCLI_DISABLE_EXTERNAL_SKILLS")
const ADPCLI_DISABLE_CLAUDE_CODE_SKILLS =
  ADPCLI_DISABLE_EXTERNAL_SKILLS || ADPCLI_DISABLE_CLAUDE_CODE || truthy("ADPCLI_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["ADPCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  ADPCLI_AUTO_SHARE: truthy("ADPCLI_AUTO_SHARE"),
  ADPCLI_AUTO_HEAP_SNAPSHOT: truthy("ADPCLI_AUTO_HEAP_SNAPSHOT"),
  ADPCLI_GIT_BASH_PATH: process.env["ADPCLI_GIT_BASH_PATH"],
  ADPCLI_CONFIG: process.env["ADPCLI_CONFIG"],
  ADPCLI_CONFIG_CONTENT: process.env["ADPCLI_CONFIG_CONTENT"],

  ADPCLI_DISABLE_AUTOUPDATE: truthy("ADPCLI_DISABLE_AUTOUPDATE"),

  // Defaults to false (rotation enabled). When enabled, the active log file is
  // never archived to <name>.log.<stamp> on hitting MAX_FILE_SIZE — it grows in
  // place. Useful when an external tool tails/manages the single log file.
  ADPCLI_DISABLE_LOG_ROTATION: truthy("ADPCLI_DISABLE_LOG_ROTATION"),

  // Defaults to true (analytics enabled). Set ADPCLI_ENABLE_ANALYSIS=false
  // to opt out of POSTing model_call/tool_call/agent_request metrics.
  ADPCLI_ENABLE_ANALYSIS: !falsy("ADPCLI_ENABLE_ANALYSIS"),
  ADPCLI_ALWAYS_NOTIFY_UPDATE: truthy("ADPCLI_ALWAYS_NOTIFY_UPDATE"),
  ADPCLI_DISABLE_PRUNE: truthy("ADPCLI_DISABLE_PRUNE"),
  ADPCLI_DISABLE_TERMINAL_TITLE: truthy("ADPCLI_DISABLE_TERMINAL_TITLE"),
  ADPCLI_SHOW_TTFD: truthy("ADPCLI_SHOW_TTFD"),
  ADPCLI_PERMISSION: process.env["ADPCLI_PERMISSION"],

  // Defaults to false. When false, the bash tool intercepts irreversible
  // deletion commands (rm, rmdir, unlink, shred, del, erase, rd, remove-item,
  // and git destructive subcommands like reset --hard / clean -f / branch -D /
  // worktree remove / push --force / stash drop|clear / tag -d) and forces an
  // extra permission prompt with permission="bash_delete" — separate from the
  // normal bash-permission ask so it can't be silently pre-approved by a broad
  // `bash: allow` rule. Set ADPCLI_AUTO_APPROVE_DELETE=true to trust the
  // model with deletes and skip the second confirmation.
  ADPCLI_AUTO_APPROVE_DELETE: truthy("ADPCLI_AUTO_APPROVE_DELETE"),
  // Set by the TUI's --dangerously-skip-permissions flag. When truthy, an
  // allow-all base ruleset is injected UNDER the user's config permission so
  // every tool auto-approves unless the user explicitly denied it.
  ADPCLI_DANGEROUSLY_SKIP_PERMISSIONS: truthy("ADPCLI_DANGEROUSLY_SKIP_PERMISSIONS"),
  ADPCLI_DISABLE_DEFAULT_PLUGINS: truthy("ADPCLI_DISABLE_DEFAULT_PLUGINS"),
  ADPCLI_DISABLE_LSP_DOWNLOAD: truthy("ADPCLI_DISABLE_LSP_DOWNLOAD"),
  ADPCLI_ENABLE_EXPERIMENTAL_MODELS: truthy("ADPCLI_ENABLE_EXPERIMENTAL_MODELS"),
  ADPCLI_DISABLE_AUTOCOMPACT: truthy("ADPCLI_DISABLE_AUTOCOMPACT"),
  ADPCLI_DISABLE_MODELS_FETCH: truthy("ADPCLI_DISABLE_MODELS_FETCH"),
  ADPCLI_DISABLE_MOUSE: truthy("ADPCLI_DISABLE_MOUSE"),
  ADPCLI_OUTPUT_LENGTH_CONTINUATION_LIMIT: number("ADPCLI_OUTPUT_LENGTH_CONTINUATION_LIMIT") ?? 3,
  ADPCLI_INVALID_OUTPUT_CONTINUATION_LIMIT: number("ADPCLI_INVALID_OUTPUT_CONTINUATION_LIMIT") ?? 2,
  ADPCLI_TEXT_TOOL_CALL_RETRY_LIMIT: number("ADPCLI_TEXT_TOOL_CALL_RETRY_LIMIT") ?? 2,
  // Empty/no-op tool-call loop guard: number of soft nudges (remind → replan)
  // before the harness hard-halts the turn. N consecutive empty steps beyond
  // this many recovery attempts terminates the turn. Mirrors TEXT_NGRAM_MAX_RECOVERY.
  ADPCLI_EMPTY_STEP_MAX_RECOVERY: number("ADPCLI_EMPTY_STEP_MAX_RECOVERY") ?? 2,

  // Consecutive-block repetition detection for streamed reasoning + text.
  // A block of at least N tokens repeating REPEAT_THRESHOLD times consecutively
  // within the last WINDOW_TOKENS tokens triggers recovery (remind → replan → terminate).
  ADPCLI_TEXT_NGRAM_N: number("ADPCLI_TEXT_NGRAM_N") ?? 4,
  ADPCLI_TEXT_REPEAT_THRESHOLD: number("ADPCLI_TEXT_REPEAT_THRESHOLD") ?? 20,
  ADPCLI_TEXT_WINDOW_TOKENS: number("ADPCLI_TEXT_WINDOW_TOKENS") ?? 500,

  // Caps applied to image attachments before a prompt is sent.
  // ADPCLI_MAX_PROMPT_IMAGES (default undefined = no count limit) bounds how
  // many images may be sent per request (oldest excess images are dropped).
  // ADPCLI_MAX_PROMPT_IMAGE_SIZE overrides the default per-image byte cap
  // (DEFAULT_MAX_IMAGE_BYTES ~4.5 MB, kept under the provider 5 MB hard limit);
  // oversized images are recompressed under the cap, or stripped to a text
  // placeholder when they can't be compressed. Values must be positive integers.
  ADPCLI_MAX_PROMPT_IMAGES: number("ADPCLI_MAX_PROMPT_IMAGES"),
  ADPCLI_MAX_PROMPT_IMAGE_SIZE: number("ADPCLI_MAX_PROMPT_IMAGE_SIZE"),
  ADPCLI_ADP_ONLY,
  ADPCLI_DISABLE_PROVIDER_ENV: ADPCLI_ADP_ONLY || truthy("ADPCLI_DISABLE_PROVIDER_ENV"),
  ADPCLI_DISABLE_CLAUDE_CODE,
  get ADPCLI_DISABLE_CLAUDE_CODE_MCP() {
    // MCP compatibility stays on in adp-only mode so users can reuse Claude Code
    // MCP servers without inheriting prompts, skills, or provider env keys.
    return ADPCLI_DISABLE_CLAUDE_CODE_ENV || truthy("ADPCLI_DISABLE_CLAUDE_CODE_MCP")
  },
  ADPCLI_DISABLE_CLAUDE_CODE_PROMPT: ADPCLI_DISABLE_CLAUDE_CODE || truthy("ADPCLI_DISABLE_CLAUDE_CODE_PROMPT"),
  // Defaults to false (enabled): markdown commands under ~/.claude/commands and
  // {project}/.claude/commands load as slash commands. Independent of the
  // adp-only master switch. Set ADPCLI_DISABLE_CLAUDE_CODE_COMMANDS=true to disable.
  ADPCLI_DISABLE_CLAUDE_CODE_COMMANDS: truthy("ADPCLI_DISABLE_CLAUDE_CODE_COMMANDS"),
  ADPCLI_DISABLE_CLAUDE_CODE_SKILLS,
  ADPCLI_DISABLE_EXTERNAL_SKILLS,
  ADPCLI_DISABLE_CODEX_SKILLS: ADPCLI_DISABLE_EXTERNAL_SKILLS || truthy("ADPCLI_DISABLE_CODEX_SKILLS"),
  ADPCLI_DISABLE_OPENCODE_SKILLS: ADPCLI_DISABLE_EXTERNAL_SKILLS || truthy("ADPCLI_DISABLE_OPENCODE_SKILLS"),

  // Defaults to false. When enabled, skill-source commands appear in the `/`
  // autocomplete dropdown alongside user commands and MCP prompts. Skills are
  // surfaced in `/` completion by default; set ADPCLI_DISABLE_SLASH_SKILLS=1
  // to hide them and fall back to the `/skills` picker + model-driven
  // invocation only.
  ADPCLI_DISABLE_SLASH_SKILLS: truthy("ADPCLI_DISABLE_SLASH_SKILLS"),
  ADPCLI_FAKE_VCS: process.env["ADPCLI_FAKE_VCS"],

  // When enabled, skips all git subprocess calls during project discovery
  // (which git, rev-parse --git-common-dir, rev-parse --show-toplevel) and
  // branch detection. The project is treated as a non-git directory rooted at
  // the working directory. Use to avoid touching git in restricted/sandboxed
  // environments or where git startup probing is undesirable.
  ADPCLI_DISABLE_GIT: truthy("ADPCLI_DISABLE_GIT"),
  ADPCLI_SERVER_PASSWORD: process.env["ADPCLI_SERVER_PASSWORD"],
  ADPCLI_SERVER_USERNAME: process.env["ADPCLI_SERVER_USERNAME"],
  ADPCLI_ENABLE_QUESTION_TOOL: truthy("ADPCLI_ENABLE_QUESTION_TOOL"),

  // Defaults to false. Set ADPCLI_ENABLE_TRY_BEST_HANDOFF=true (or 1) to
  // enable try-best loop detection, automatic turn pausing, and handoff UI.
  ADPCLI_ENABLE_TRY_BEST_HANDOFF: truthy("ADPCLI_ENABLE_TRY_BEST_HANDOFF"),

  // Defaults to false. The edit tool does pure exact-string matching with
  // explicit error signals. Set ADPCLI_ENABLE_FUZZY_EDIT=true to opt into the
  // legacy multi-stage fuzzy fallback chain (line-trimmed / block-anchor /
  // whitespace-normalized / indentation-flexible / etc.) when old_string fails
  // to match exactly.
  ADPCLI_ENABLE_FUZZY_EDIT: truthy("ADPCLI_ENABLE_FUZZY_EDIT"),

  // Experimental
  ADPCLI_EXPERIMENTAL,
  ADPCLI_EXPERIMENTAL_FILEWATCHER: Config.boolean("ADPCLI_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  ADPCLI_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("ADPCLI_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  ADPCLI_EXPERIMENTAL_ICON_DISCOVERY: ADPCLI_EXPERIMENTAL || truthy("ADPCLI_EXPERIMENTAL_ICON_DISCOVERY"),
  ADPCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("ADPCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  ADPCLI_ENABLE_EXA:
    truthy("ADPCLI_ENABLE_EXA") ||
    truthy("OPENCODE_ENABLE_EXA") ||
    ADPCLI_EXPERIMENTAL ||
    truthy("ADPCLI_EXPERIMENTAL_EXA") ||
    truthy("OPENCODE_EXPERIMENTAL_EXA"),
  ADPCLI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("ADPCLI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  // Token-efficient post-cleanse: strip ANSI / fold \r progress bars / redact
  // secrets / elide super-long lines from bash tool output before it is
  // returned to the model. Only applies when the output fits inline — if the
  // output spills to a truncation file, cleaning is skipped so the on-disk
  // archive stays raw. Off by default. Set to 1/true to opt in.
  ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY: truthy("ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY"),
  // Tunables for the token-efficient post-cleanse pipeline (see
  // src/tool/bash_token_efficient_pipeline.ts). Positive integers only;
  // unset / non-positive values fall back to the documented defaults.
  //   MAX_LINE_CHARS   threshold above which a single line is elided  (default 500)
  //   LINE_HEAD_KEEP   chars kept from the head of an elided line     (default 160)
  //   NEVER_WORSE_MARGIN  bytes the cleaned output must beat the raw  (default 0)
  ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_MAX_LINE_CHARS: number("ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_MAX_LINE_CHARS") ?? 500,
  ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_LINE_HEAD_KEEP: number("ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_LINE_HEAD_KEEP") ?? 160,
  ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_NEVER_WORSE_MARGIN: number("ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_NEVER_WORSE_MARGIN") ?? 0,
  // Heuristic (shape-based) filter pipeline for bash output. Runs AFTER the
  // common pipeline, only when the common pipeline is enabled AND this flag is
  // explicitly opted in. Each shape (gitdiff / pytest / npm / make /
  // stacktrace / tsc / kubectl / json / md / gostest) recognises a command
  // pattern or body fingerprint and rewrites the body to strip predictable
  // noise. Off by default. Set to 1/true to opt in.
  ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_HEURISTIC: truthy("ADPCLI_EXPERIMENTAL_TOKEN_EFFICIENCY_HEURISTIC"),
  ADPCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("ADPCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  ADPCLI_EXPERIMENTAL_OXFMT: ADPCLI_EXPERIMENTAL || truthy("ADPCLI_EXPERIMENTAL_OXFMT"),
  ADPCLI_EXPERIMENTAL_LSP_TY: truthy("ADPCLI_EXPERIMENTAL_LSP_TY"),
  ADPCLI_EXPERIMENTAL_LSP_TOOL: ADPCLI_EXPERIMENTAL || truthy("ADPCLI_EXPERIMENTAL_LSP_TOOL"),
  // Defaults to OFF (opt-in): the Orchestrator primary mode — a general
  // coordinator that delegates to child sessions via the `session` tool, with a
  // global singleton workspace and child permission-approval routing. Enable with
  // ADPCLI_EXPERIMENTAL_ORCHESTRATOR=true (or the umbrella ADPCLI_EXPERIMENTAL).
  ADPCLI_EXPERIMENTAL_ORCHESTRATOR: ADPCLI_EXPERIMENTAL || truthy("ADPCLI_EXPERIMENTAL_ORCHESTRATOR"),
  // Defaults to true: dynamic workflow + built-in deep-research are on by default.
  // Set ADPCLI_EXPERIMENTAL_WORKFLOW_TOOL=false to opt out. The env-var name is
  // kept for backwards compat (long-running experiments still pass it as `1`).
  ADPCLI_EXPERIMENTAL_WORKFLOW_TOOL: !falsy("ADPCLI_EXPERIMENTAL_WORKFLOW_TOOL"),
  // Defaults to true: cron + self-paced loop scheduling are on by default.
  // Set ADPCLI_EXPERIMENTAL_CRON=false to opt out. Runtime kill switch is
  // ADPCLI_DISABLE_CRON (checked live every tick).
  ADPCLI_EXPERIMENTAL_CRON: !falsy("ADPCLI_EXPERIMENTAL_CRON"),
  // Keepalive contract for self-paced loops (spec [S8]). Budget = how many
  // "forget" turns the model gets before the loop is declared model_stopped;
  // delay seconds = the auto-arm horizon used for the keepalive fire. Budget
  // accepts 0 (end immediately on the first turn without a re-arm) for tests
  // and aggressive policies. Both are getters so tests can flip the env var
  // between cases without restarting the process.
  get ADPCLI_LOOP_KEEPALIVE_BUDGET() {
    return nonNegativeNumber("ADPCLI_LOOP_KEEPALIVE_BUDGET") ?? 1
  },
  get ADPCLI_LOOP_KEEPALIVE_DELAY_S() {
    return number("ADPCLI_LOOP_KEEPALIVE_DELAY_S") ?? 1200
  },
  ADPCLI_EXPERIMENTAL_MARKDOWN: !falsy("ADPCLI_EXPERIMENTAL_MARKDOWN"),
  ADPCLI_MODELS_URL: process.env["ADPCLI_MODELS_URL"],
  ADPCLI_MODELS_PATH: process.env["ADPCLI_MODELS_PATH"],
  ADPCLI_DISABLE_EMBEDDED_WEB_UI: truthy("ADPCLI_DISABLE_EMBEDDED_WEB_UI"),
  ADPCLI_DB: process.env["ADPCLI_DB"],

  // Defaults to true — all channels share a single adpcli.db. The per-channel
  // DB isolation (adpcli-{channel}.db) is unnecessary for adpcli since we
  // don't ship multiple release channels yet. Use ADPCLI_HOME to isolate dev
  // environments instead. Set ADPCLI_DISABLE_CHANNEL_DB=false to restore
  // per-channel isolation.
  ADPCLI_DISABLE_CHANNEL_DB: !falsy("ADPCLI_DISABLE_CHANNEL_DB"),
  ADPCLI_SKIP_MIGRATIONS: truthy("ADPCLI_SKIP_MIGRATIONS"),
  ADPCLI_STRICT_CONFIG_DEPS: truthy("ADPCLI_STRICT_CONFIG_DEPS"),

  ADPCLI_WORKSPACE_ID: process.env["ADPCLI_WORKSPACE_ID"],
  ADPCLI_EXPERIMENTAL_HTTPAPI: truthy("ADPCLI_EXPERIMENTAL_HTTPAPI"),
  ADPCLI_EXPERIMENTAL_WORKSPACES: ADPCLI_EXPERIMENTAL || truthy("ADPCLI_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.

  // Disables compose-agent-internal skills (e.g. compose:plan, compose:review,
  // compose:tdd). These are hidden workflow-orchestration skills only visible
  // to the compose agent and are NOT part of builtin skills.
  get ADPCLI_DISABLE_COMPOSE_SKILLS() {
    return truthy("ADPCLI_DISABLE_COMPOSE_SKILLS")
  },
  // Disables user-facing builtin skills shipped with the binary (e.g.
  // evolve). Does not affect compose skills — the two sets are
  // independent and non-overlapping.
  get ADPCLI_DISABLE_BUILTIN_SKILLS() {
    return truthy("ADPCLI_DISABLE_BUILTIN_SKILLS")
  },
  // Disables the built-in official skills (docx, pdf, pptx, xlsx,
  // html-to-video-pipeline) while keeping the rest of the builtin bundle
  // available. Defaults to false (all skills are extracted and loaded). Set
  // ADPCLI_DISABLE_OFFICIAL_SKILLS=true to skip them.
  get ADPCLI_DISABLE_OFFICIAL_SKILLS() {
    return truthy("ADPCLI_DISABLE_OFFICIAL_SKILLS")
  },
  get ADPCLI_DISABLE_PROJECT_CONFIG() {
    return truthy("ADPCLI_DISABLE_PROJECT_CONFIG")
  },
  get ADPCLI_TUI_CONFIG() {
    return process.env["ADPCLI_TUI_CONFIG"]
  },
  get ADPCLI_CONFIG_DIR() {
    return process.env["ADPCLI_CONFIG_DIR"]
  },
  get ADPCLI_HOME() {
    return process.env["ADPCLI_HOME"]
  },
  get ADPCLI_PURE() {
    return truthy("ADPCLI_PURE")
  },
  get ADPCLI_PLUGIN_META_FILE() {
    return process.env["ADPCLI_PLUGIN_META_FILE"]
  },
  get ADPCLI_CLIENT() {
    return process.env["ADPCLI_CLIENT"] ?? "cli"
  },
}
