<h1 align="center">AdpCli</h1>

<p align="center"><strong>Adp Cli: Where Models and Agents Co-Evolve</strong></p>

<p align="center">
  <a href="https://adp.xiaomi.com/coder">Website</a> | <a href="https://adp.xiaomi.com/en/blog/adp-cli-long-horizon">Blog</a> | <a href="https://github.com/XiaomiAdp/Adp-Cli">GitHub</a>
</p>

---

AdpCli is a terminal-native AI coding assistant. It can read and write code, run commands, manage Git, and use a persistent memory system to keep a deep understanding of your project across sessions while continuously improving itself.

Adp Auto is built in as a free-for-limited-time channel, so you can start with zero configuration. AdpCli also supports connecting to any mainstream LLM provider API.

---

## Quick Start

```bash
# One-line install (macOS / Linux)
curl -fsSL https://cli.adp.grcbtest/install | bash

# One-line install (Windows PowerShell)
powershell -ep Bypass -c "irm https://cli.adp.grcbtest/install.ps1 | iex"

# Or install via npm (all platforms)
# Mirror registries (e.g. cnpm/taobao) may have delayed platform package sync
npm install -g @adp-ai/cli --registry https://registry.npmjs.org

# Run
adp
```

The first launch guides you through configuration automatically. Supported options:
- **Adp Auto (free for a limited time)** — anonymous channel, zero configuration
- **Xiaomi Adp Platform** — OAuth login
- **Import from Claude Code** — migrate existing authentication in one step
- **Custom Provider** — add any OpenAI-compatible API in the TUI

---

## Core Features

- **Multiple Agents** — build (default), plan (read-only analysis), compose (specs-driven orchestration); press `Tab` to switch
- **Persistent Memory** — cross-session project knowledge, checkpoints, and task progress powered by SQLite FTS5
- **Intelligent Context Management** — automatic checkpoints, context reconstruction, and budgeted injection to stay within model limits
- **Task Tracking** — tree-shaped task system integrated with the checkpoint system
- **Subagent System** — parallel subagents with lifecycle tracking, cancellation, and background execution
- **Goal / Stop Condition** — judge model prevents premature stops during autonomous work
- **Compose Mode** — structured workflow for specs-driven development with built-in skills
- **Voice Input** — real-time streaming voice input powered by TenVAD and Adp ASR
- **Dream & Distill** — extract knowledge into memory (`/dream`) and discover reusable workflows (`/distill`)

For detailed documentation, configuration options, and troubleshooting, see the [GitHub repository](https://github.com/XiaomiAdp/Adp-Cli).

---

## License

Source code is licensed under the [MIT License](https://github.com/XiaomiAdp/Adp-Cli/blob/main/LICENSE).

Use of AdpCli is also subject to the [Use Restrictions](https://github.com/XiaomiAdp/Adp-Cli/blob/main/USE_RESTRICTIONS.md).
Use of Xiaomi Adp-hosted services is subject to the [Adp Terms of Service](https://platform.xiaomiadp.com/docs/terms/user-agreement).
Use of the Adp name, logo, and trademarks is subject to the Adp Trademark Policy.
