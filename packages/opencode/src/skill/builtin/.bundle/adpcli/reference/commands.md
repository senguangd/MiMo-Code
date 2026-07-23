# AdpCli Commands Reference

## CLI (`adp <command>`)

Invoked from the shell. `adp` with no command opens the TUI.

| Command | Purpose |
|---------|---------|
| `adp` | Launch the interactive TUI |
| `adp run` | Headless, non-interactive run (scripting/eval) |
| `adp mcp` | Manage / inspect MCP servers |
| `adp agent` | Manage agents |
| `adp models` | List available models |
| `adp providers` | List / manage providers |
| `adp account` (console) | Account / login console |
| `adp upgrade` | Update to the latest version |
| `adp uninstall` | Uninstall AdpCli |
| `adp serve` | Run the server |
| `adp stats` | Usage statistics |
| `adp export` / `adp import` | Export / import sessions |
| `adp session` | Manage sessions |
| `adp github` / `adp pr` | GitHub / pull-request integration |
| `adp generate` | Code generation entry |
| `adp plugin` (plug) | Manage plugins |
| `adp db` | Database utilities |
| `adp acp` / `adp attach` | ACP / attach to a running session |
| `adp debug` | Debug utilities |
| `adp completion` | Generate shell completion script |

Run `adp <command> --help` for flags on any command.

Notable TUI flags: `--continue`/`-c` (resume last session), `--session`/`-s`, `--model`/`-m`, `--agent`, `--never-ask`, `--trust`, and `--dangerously-skip-permissions` (auto-approve everything not explicitly denied; prompts once for confirmation — see permissions.md).

## Slash commands (inside the TUI)

| Command | Purpose |
|---------|---------|
| `/goal` | Set a stop condition; a judge model verifies it's truly met before the agent halts (prevents premature stops in autonomous work) |
| `/dream` | Scan recent traces, extract durable knowledge into project memory, prune stale entries |
| `/distill` | Detect repeated manual workflows and package high-confidence ones into skills/subagents/commands |
| `/voice` | Toggle streaming voice input (needs `sox`; Adp-logged-in users) |
| `/loop` | `[interval] <prompt>` — schedule a repeating prompt (also runs once now); maps the interval to a cron job |
| `/loops` | List scheduled cron/loop jobs; `/loops cancel <id>` stops one |
| `/rebuild` | Rebuild the conversation context now from the latest checkpoint — frees context on demand instead of waiting for the automatic overflow trigger. Keeps recent messages verbatim; earlier context collapses to the checkpoint summary. Waits (bounded) for an in-flight checkpoint writer first |
| `/connect` | Sign in to a provider (e.g. OpenRouter) |
| `/<skill-name>` | Invoke any available skill directly by name |

## Keybindings

- `Tab` — cycle primary agents (build → plan → compose).
- Other keybinds are configurable; the keybinds config module governs them.

## Notes

- The web command is currently disabled; TUI is the supported interface.
- Voice ASR (`adp-v2.5-asr`) is Adp-platform only; voice control (`adp-v2.5`) also runs on OpenRouter and compatible relays via the `voice` config (see config.md and the README voice section).
