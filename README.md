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
| Sessions | One terminal at a time | Session tabs plus built-in history and search |
| Same sessions, models, config | Yes | Yes |

![OpenCode icon sitting in the secondary sidebar activity bar beside Copilot](assets/activitybar.png)

## What you get

- **The real OpenCode agent.** The panel talks to the OpenCode server over its HTTP API and event stream, so sessions, models, agents, tools and permissions are the same ones your CLI uses.
- **A UI built for a narrow column.** User bubbles, streamed markdown, syntax-highlighted code blocks with a copy button, collapsible reasoning, and compact tool cards with live status.
- **Working text input.** Paste with `Cmd+V` / `Ctrl+V`, multi-line prompts with `Shift+Enter`, `Enter` to send.
- **Real attachments.** Attach files, whole folders, the current editor selection, Problems diagnostics, or a screenshot with `Cmd/Ctrl+Shift+A`: a screen region on macOS, or an image pasted from the clipboard on Windows/Linux. Right-click a file or an editor tab for **Add File to Chat**, **Add Selection to Chat** and **Add Problems to Chat**, or run the same commands from the palette; every one lands as a chip in the composer. Drop files onto the composer or paste an image; the tray shows 64px previews, names and sizes, and lets you remove any item. Up to 10 attachments of 10 MB each per prompt.
- **Attachments in the history.** A screenshot or image stays in the transcript after a reload and opens a lightbox with **Open in editor**; any other file becomes a chip with its name, workspace-relative path and **Open**, and the path on a `read` / `write` tool card opens that file at the reported line while an `edit` card opens its before/after diff.
- **Tool cards you can act on.** A `read` / `write` card opens the file it touched; an `edit` opens a before/after diff with **Open file** beside it, and a shell card shows the full command, exit code and duration with **Copy command** and **Open terminal**. Output longer than 200 lines collapses behind **Show full** / **Show less**, and expanding stops at 200k characters, so a 10k-line result opens without freezing the panel.
- **Session tabs.** Open as many sessions as you need, switch with `Cmd/Ctrl+1..9`, close with `Cmd/Ctrl+W` or a middle click. Open tabs and the active tab survive a window reload.
- **A menu on every tab.** Right-click a tab to rename it in place, pin it first, archive it, fork it into a separate session, copy its session ID or delete it. Pinned tabs stay at the front and cannot be closed by accident.
- **Per-tab state.** Each tab keeps its draft, caret, scroll position, and expanded blocks, so switching chats does not lose what you were writing or reading.
- **One chat per folder.** In a multi-root workspace the header shows a folder picker: each folder has its own tabs, active session, agent, model, commands, skills and file search, and a new chat draft is remembered per folder.
- **Long chats stay fast.** The transcript loads the newest page first and pages in older messages as you scroll up, keeps a constant number of rendered messages and a `Jump to latest` button, and refreshes only the tail while the agent works.
- **Find in the chat.** `Cmd/Ctrl+F` opens a find bar over the transcript: `N/M` with `Enter` / `Shift+Enter` (or the arrows) to cycle, and matches in messages, reasoning and tool names or titles are highlighted. A jump opens a collapsed reasoning block or tool body it lands in and scrolls the match itself into view; `Escape` closes it and clears the highlight, and tool input and output are searchable behind an off-by-default **Output** toggle.
- **Session history.** Grouped by Today / Yesterday / Previous 7 days / Older, with search, one-click switching and delete.
- **New sessions in one click.** The `+` button in the header, or `Cmd+Alt+N`.
- **Searchable model picker.** Filter the server's model list by name, id or provider, then switch without leaving the composer.
- **Reasoning effort.** Pick the model's `low` / `medium` / `high` / `max` variants from the effort chip, or leave it on default.
- **Mode picker.** Switch between the primary agents the server exposes, such as Build and Plan, per session.
- **Slash commands and mentions.** Type `/` to run any server command, and `@` to search files or invoke a skill. Arrow keys, Enter, Tab and Escape work in both palettes.
- **File and skill attachments.** Selected files and skills are sent with the prompt using the OpenCode attachment API.
- **Defaults that show up.** New sessions use configured model, effort and mode defaults, and the composer shows the server defaults when a session has no explicit selection.
- **Settings that stay put.** A settings drawer controls defaults, send key, auto-scroll, timestamps, reasoning visibility, compact tools, accent color, density, font size, CLI path and server auto-start. Changes apply immediately and do not reset your draft.
- **Context meter.** The composer shows how much of the model's context window the session uses, with cumulative tokens and cost in the tooltip. It warns at 80% with a **Compact** button and compacts the active session automatically at 95%; both thresholds are configurable.
- **Review a turn's changes.** When a turn ends, a footer card shows `N files · +A −D`; **Review** opens a diff panel with collapsible files, ± highlighting, Prev/Next across loaded turns, Copy patch, and click-to-open at the first changed line.
- **Undo a turn.** The turn card and the message menu of the last user message offer Undo: confirm with the file list, then keep the revert to drop the turn or undo it to put the files and the turn back.
- **Permissions in the panel.** When the agent needs approval, a pinned card shows the tool, file or command with a risk chip and **Allow once** / **Always allow** / **Reject**; Reject takes an optional reason. Always stores a rule for the project, and the card disappears when the request is answered or expires. Settings can auto-approve read-only tools and list or delete saved rules.
- **Queue while it works.** A message sent during a turn waits in the server queue instead of blocking the composer: a strip above the composer lists the waiting prompts with **Send now**, **Edit** and **Delete**, the chip reads `N in queue`, and the queue survives tab switches and reloads. Settings switch the busy send between `queue` and `steer`.
- **Survives a server restart.** A dropped event stream reconnects on its own with an exponential backoff (1s, 2s, 4s … up to 30s), resubscribes and drops frames the server replays, so a restarted OpenCode server brings the panel back without a Reload. If the port or the password changed, the panel picks up the rewritten `service.json` by itself, and the banner appears only when `GET /api/info` is down too. A message that never reached the server keeps its draft and chips, and **Resend** in the banner repeats it.
- **Notifications when you look away.** A turn that finishes while the chat is not on screen raises a notification with **Open**; a failed turn uses an error notification, a pending permission asks for approval, and a dropped connection keeps the banner with **Retry** and **Resend** and tells you once. The OpenCode icon in the secondary sidebar shows how many chats have a new reply or a waiting request, `notifications` picks `all` / `errors` / `off`, and `notifyOnlyWhenHidden` (on by default) stays quiet while the chat is in front of you.
- **Stop button.** Interrupt a running turn without hunting for a key chord.

## Screens

![Session history](assets/panel-history.png)

![New session](assets/panel-empty.png)

## Install

Requires VS Code 1.101 or newer and the OpenCode CLI on your machine.

```bash
code --install-extension opencode-sidekick-1.2.0.vsix
```

Or in VS Code: Extensions view → `...` → **Install from VSIX**.

## Use it

1. Open the secondary sidebar with `Cmd+Option+B` (`Ctrl+Alt+B` on Windows and Linux).
2. Click the OpenCode icon.
3. Talk to your agent.

The panel opens on your most recent session for the current workspace. Use `+` for a new one, or the title to browse history.

The same chat can sit beside your code: `OpenCode: Open Chat in Editor Tab`, or **Open in editor tab** in a tab's context menu, opens one editor tab that follows the active session. Its title is the session name and its icon shows whether the agent is running, waits for an answer or is idle. Closing the tab keeps the session in the sidebar, and a window reload brings the tab back.

In a multi-root workspace the folder picker in the header switches the panel to another folder. Until you pick one by hand (and while a turn is still running) the panel follows the folder of the active editor. The OpenCode terminal and the `@` file search use the selected folder too.

The composer footer has three pickers: model, effort and mode. Type `/` at the start of a message to filter commands, or `@` anywhere to search files and skills. In a palette, use `Up` / `Down` to move, `Enter` or `Tab` to select, and `Escape` to close it. The `...` menu in the header repeats the main panel actions, including the three pickers.

Press `Cmd/Ctrl+F` to search the open chat. The find bar sits between the header and the transcript, so it never covers the composer: type to see `N/M`, use `Enter` / `Shift+Enter` or the arrows to move between matches, and `Escape` to close it and drop the highlight. Jumping to a match opens the collapsed block it lives in and brings the match into view. The query is kept when you close the bar and cleared when you switch sessions; tool input and output are only searched after you turn on **Output**.

## Commands

| Command | Shortcut |
| --- | --- |
| `OpenCode: Focus OpenCode Sidekick` | `Cmd+Alt+Shift+O` |
| `OpenCode: Open Chat in Editor Tab` | |
| `OpenCode: New Session` | `Cmd+Alt+N` |
| `OpenCode: Show Session History` | |
| `OpenCode: Open Sidekick Settings` | |
| `OpenCode: Reload OpenCode Sidekick` | |
| `OpenCode: Open OpenCode UI in Browser` | |
| `OpenCode: Open OpenCode in Integrated Terminal` | |
| `OpenCode: Attach Screenshot` | |
| `OpenCode: Add File to Chat` | |
| `OpenCode: Add Selection to Chat` | |
| `OpenCode: Add Problems to Chat` | |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencodeSidekick.defaultModel` | `""` | Default model for new sessions as `provider/model`. Empty uses the server default. |
| `opencodeSidekick.defaultEffort` | `""` | Default reasoning effort for new sessions. Empty lets the model decide. |
| `opencodeSidekick.defaultMode` | `""` | Default agent mode for new sessions. Empty uses the server default. |
| `opencodeSidekick.sendKey` | `enter` | `enter` sends with Enter; `mod-enter` sends with Cmd/Ctrl+Enter. |
| `opencodeSidekick.autoScroll` | `true` | Keep the transcript scrolled to new output. |
| `opencodeSidekick.showTimestamps` | `false` | Show message times. |
| `opencodeSidekick.reasoning` | `collapsed` | Show reasoning `collapsed`, `expanded` or `hidden`. |
| `opencodeSidekick.compactTools` | `true` | Collapse tool input and output by default. |
| `opencodeSidekick.accent` | `mint` | Accent color: `mint`, `blue`, `violet` or `amber`. |
| `opencodeSidekick.density` | `comfortable` | Spacing density: `comfortable` or `compact`. |
| `opencodeSidekick.fontSize` | `default` | Base font size: `small`, `default` or `large`. |
| `opencodeSidekick.cliPath` | `""` | Absolute path to the `opencode` executable. Empty means "first one on `PATH`". |
| `opencodeSidekick.autoStartServer` | `true` | Start the OpenCode background server when the panel opens and nothing is listening. |
| `opencodeSidekick.contextWarnPercent` | `80` | Context usage percentage that shows the **Compact** warning in the composer. |
| `opencodeSidekick.contextCompactPercent` | `95` | Context usage percentage that triggers an automatic compaction of the active session. |
| `opencodeSidekick.queueDelivery` | `queue` | A message sent while the agent works waits in the queue (`queue`) or joins the turn (`steer`). |
| `opencodeSidekick.autoAttachActiveFile` | `false` | Keep the active workspace file attached to the composer as an automatic chip; remove the chip to dismiss it until you switch files. |
| `opencodeSidekick.notifications` | `all` | Which finished turns raise a system notification: `all`, `errors` or `off`. The tab badge and the connection banner stay in every mode. |
| `opencodeSidekick.notifyOnlyWhenHidden` | `true` | Notify only when the chat that needs you is not on screen. Turn it off to notify for every finished turn, even while you watch it. |

The same settings are available in the panel: click the gear in the header, choose **Settings** from the `...` menu, or run `OpenCode: Open Sidekick Settings`.

## How it works

The extension reads the running server's endpoint and credentials from `~/.local/state/opencode/service.json`, then talks to it directly: `GET /api/session` for history, `POST /api/session/{id}/prompt` to send, `POST /api/session/{id}/command` for slash commands, `GET /api/session/{id}/message` for transcripts, and `GET /api/event` for the live stream. Models, agents, commands, skills, and free-text file search come from `GET /api/model`, `/api/agent`, `/api/command`, `/api/skill`, and `/api/fs/find`. Deltas arrive over SSE and are applied to the transcript as they stream; structural events trigger a re-read so tool cards, model, and agent changes stay accurate.

The webview is a React 19 app bundled with esbuild into `media/main.js` and inlined into the panel with a nonce-based CSP. The source follows a pragmatic Feature-Sliced Design layout (`app -> widgets -> features -> entities -> shared`); see [ARCHITECTURE.md](ARCHITECTURE.md). Everything stays on your machine. No proxy process, no iframe, no extra port.

## Notes

- If the OpenCode server restarts with new credentials, run **Reload OpenCode Sidekick**.
- The panel follows your VS Code theme for surfaces and text. The accent color is configurable in settings.
- Changing model, effort, mode or any setting updates the panel in place. Your composer draft is not cleared.
- Code that the agent writes is still handled by OpenCode itself, so its own permission prompts apply.

## License

MIT
