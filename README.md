# OpenCode Sidekick

**The OpenCode agent, docked in the VS Code secondary sidebar.** Your editor keeps its full width, OpenCode sits right next to it, in the same panel where Copilot Chat and Codex live.

![OpenCode Sidekick chat panel](assets/panel-chat.png)

## The problem it solves

The official opencode extension opens its terminal with `ViewColumn.Beside`. That forces the editor to split into two columns every time you want to talk to your agent: half the screen is code, half is a terminal, and your tabs get squeezed into whatever space is left.

OpenCode Sidekick declares its own container in `secondarySidebar`, so OpenCode opens in the right-hand panel that VS Code already toggles with `Cmd+Option+B`. The editor area is never split, and the panel is a real chat UI instead of a terminal emulator squeezed into a column.

| | opencode (official) | OpenCode Sidekick |
| --- | --- | --- |
| Where it opens | Terminal in a new editor column | Webview in the secondary sidebar |
| Editor layout | Split into two columns | Untouched |
| Typing, pasting, code blocks | TUI inside a terminal | Native textarea and markdown |
| Sessions | One terminal at a time | Built-in history, search and new sessions |
| Same sessions, models, config | Yes | Yes |

![OpenCode icon sitting in the secondary sidebar activity bar beside Copilot](assets/activitybar.png)

## What you get

- **The real OpenCode agent.** The panel talks to the OpenCode server over its HTTP API and event stream, so sessions, models, agents, tools and permissions are the same ones your CLI uses.
- **A UI built for a narrow column.** User bubbles, streamed markdown, syntax-highlighted code blocks with a copy button, collapsible reasoning, and compact tool cards with live status.
- **Working text input.** Paste with `Cmd+V` / `Ctrl+V`, multi-line prompts with `Shift+Enter`, `Enter` to send.
- **Session history.** Grouped by Today / Yesterday / Previous 7 days / Older, with search, one-click switching and delete.
- **New sessions in one click.** The `+` button in the header, or `Cmd+Alt+N`.
- **Model and agent pickers.** Every model and agent the server reports, switchable per session.
- **Stop button.** Interrupt a running turn without hunting for a key chord.

## Screens

![Session history](assets/panel-history.png)

![New session](assets/panel-empty.png)

## Install

Requires VS Code 1.101 or newer and the OpenCode CLI on your machine.

```bash
code --install-extension opencode-sidekick-1.0.0.vsix
```

Or in VS Code: Extensions view → `...` → **Install from VSIX**.

## Use it

1. Open the secondary sidebar with `Cmd+Option+B` (`Ctrl+Alt+B` on Windows and Linux).
2. Click the OpenCode icon.
3. Talk to your agent.

The panel opens on your most recent session for the current workspace. Use `+` for a new one, or the title to browse history.

## Commands

| Command | Shortcut |
| --- | --- |
| `OpenCode: Focus OpenCode Sidekick` | `Cmd+Alt+Shift+O` |
| `OpenCode: New Session` | `Cmd+Alt+N` |
| `OpenCode: Show Session History` | |
| `OpenCode: Reload OpenCode Sidekick` | |
| `OpenCode: Open OpenCode UI in Browser` | |
| `OpenCode: Open OpenCode in Integrated Terminal` | |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencodeSidekick.cliPath` | `""` | Absolute path to the `opencode` executable. Empty means "first one on `PATH`". |
| `opencodeSidekick.autoStartServer` | `true` | Start the OpenCode background server when the panel opens and nothing is listening. |

## How it works

The extension reads the running server's endpoint and credentials from `~/.local/state/opencode/service.json`, then talks to it directly: `GET /api/session` for history, `POST /api/session/{id}/prompt` to send, `GET /api/session/{id}/message` for transcripts, and `GET /api/event` for the live stream. Deltas arrive over SSE and are applied to the transcript as they stream; structural events trigger a re-read so tool cards stay accurate.

Everything stays on your machine. No proxy process, no iframe, no extra port.

## Notes

- If the OpenCode server restarts with new credentials, run **Reload OpenCode Sidekick**.
- The panel follows your VS Code theme for surfaces and text, with a mint accent that matches the icon.
- Code that the agent writes is still handled by OpenCode itself, so its own permission prompts apply.

## License

MIT
