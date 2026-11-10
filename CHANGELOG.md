# Changelog

## 1.2.0

- Rebuilt the webview on React 19 with an esbuild bundle, without changing the existing session, streaming, command or mention behavior.
- Added a full settings drawer with a header gear button, menu item and `OpenCode: Open Sidekick Settings` command.
- Added new-session defaults for model, effort and mode. Server defaults are shown in the composer when a session has no explicit selection.
- Added composer, transcript, appearance and server settings: send key, auto-scroll, timestamps, reasoning visibility, compact tools, accent, density, font size, CLI path and auto-start.
- Settings apply immediately and are persisted through VS Code configuration; changing a model, effort, mode or setting no longer resets the composer draft or reloads the webview.
- Refreshed the panel visual design with settings sections, accent themes, density modes, cleaner popovers and a narrower-sidebar layout.
- Added tests covering defaults, draft preservation, settings updates and narrow layout.

## 1.1.0

- Searchable model picker with provider, id and name filtering.
- Effort picker backed by the model's variants, including `Default`.
- Mode picker for the server's primary agents, with subagents kept out of the session switcher.
- Slash command palette with local panel commands and every command reported by the server.
- `@` mention palette for files and skills, with keyboard navigation and prompt attachments.
- Fixed the header `...` menu opening off-screen.
- Fixed model, agent, command, skill and file-search requests to send the workspace as `location[directory]`.
- Session model and agent are refreshed immediately after a change.

## 1.0.0

- First release.
- OpenCode docked as a webview in the VS Code secondary sidebar.
- Native chat UI built on the OpenCode HTTP API and event stream: streamed markdown, collapsible reasoning, tool cards with live status, and code blocks with copy.
- Session history grouped by day, with search, switching and delete.
- New sessions, model picker and agent picker in the panel.
- Reliable typing and paste in the composer, `Enter` to send, `Shift+Enter` for a new line.
- Automatic connection to the local OpenCode server, including starting it when needed.
- Commands to focus the panel, start a session, open history, reload, open the UI in a browser, and fall back to the integrated terminal.
