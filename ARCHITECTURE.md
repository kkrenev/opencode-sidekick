# Webview Architecture

The webview uses a pragmatic **Feature-Sliced Design (FSD)** layout. FSD is a good fit here because the panel is an application (not a component library) with clear business slices: sessions, messages, models, agents, commands, skills, composer, and settings.

The main rule is a one-way dependency flow:

```text
app -> widgets -> features -> entities -> shared
```

A layer may import only from layers below it. A slice may not import another slice on the same layer. This keeps the chat shell, business entities, and reusable UI independent.

## Layers

### `app`

Application composition and orchestration. This is the only layer allowed to connect all the pieces.

- `app/App.tsx` composes widgets, features, overlays, and the composer.
- `app/model/useSidekickData.ts` owns host messages and the snapshot.
- `app/model/useSidekickUi.ts` owns local UI state: drawers, popovers, history search, and toasts.
- `app/model/useSessionRuntime.ts` owns per-session draft, caret, scroll position, expanded blocks, and model/effort/mode, and syncs the active runtime to the host.
- `app/model/useComposerPalette.ts` owns slash and mention palette detection, file search, and keyboard insertion.
- `app/model/useAttachments.ts` owns pending attachments per session: picker requests, pasted and dropped files, limit checks, removal, and clearing after send.
- `app/model/useChatActions.ts` owns send, stop, model, effort, mode, settings, and session actions.
- `app/model/useSessionTabs.ts` owns tab activation, closing, and the Cmd/Ctrl+1..9 and Cmd/Ctrl+W shortcuts.
- `app/model/useLocalActions.ts` maps local slash commands to panel actions.

### `widgets`

Large self-contained UI blocks. Widgets receive data and callbacks through props; they do not reach into the app layer.

- `chat-header`
- `conversation`
- `composer`
- `session-history`
- `settings-drawer`
- `turn-diff`

### `features`

Reusable product actions. Features can read entities and shared code, and expose focused UI.

- `model-picker`
- `effort-picker`
- `mode-picker`
- `composer-palette`
- `attach-menu`
- `app-menu`
- `settings`

### `entities`

Business entities and their display logic.

- `message`
- `model`
- `agent`
- `session`

### `shared`

Framework-level and reusable code with no business dependencies.

- `api`: VS Code webview bridge and host message protocol.
- `config`: settings contract and defaults.
- `lib`: markdown, formatting, and small pure helpers.
- `types`: shared domain and UI types.
- `ui`: `Icon`, `Popover`, and low-level controls.

## Workspace folders and sessions

A multi-root workspace keeps one chat per folder. `src/shared/workspace-folders.ts` is the pure model (`pickDirectory`, `tabsOf`, `writeFolderTabs`, `migrateTabs`, `migrateSelection`) and is exercised by `npm run check:folders`, which runs as part of `npm run compile`.

- The active folder lives in `workspaceState` and `src/sidekick-view.ts` routes every directory-scoped request (sessions, models, agents, commands, skills, default model, `findFiles`, prompt attachments, the terminal cwd) through `this.directory`, which returns that folder.
- Open tabs and the active tab are stored per folder (`opencode.sidekick.tabs.v2`: `{ activeDirectory, folders: { [directory]: { open, active, pinned? } } }`); the v1 shape `{ directory, open, active }` is migrated on read and dropped when its folder left the workspace. Entries of removed folders are kept so re-adding a folder restores its tabs.
- Pins are ids in the same `FolderTabs` record: `orderTabs` puts them first in pin order, `isPinned`/`setPinned` are pure, and pins of closed tabs are dropped on read. `closeTab` refuses a pinned tab (toast), so the guard also covers `Cmd/Ctrl+W` and middle click; deleting or archiving a session removes its pin with the tab.
- A tab's context menu is `popover.kind: 'tab'` rendered by `features/tab-menu`; rename is an inline input in the header (empty or unchanged draft posts nothing), delete asks a second time inside the menu and posts `deleteSession` with `confirmed: true`, while the history drawer keeps the native modal.
- Invariants: `activeDirectory` is always one of the workspace folders, a removed folder falls back to the first remaining one, and with no folders at all the host uses the home directory and the header hides the folder picker.
- The header picker (`folders.length > 1`) sends `selectFolder`; the host persists the old folder, reloads sessions and the directory-scoped catalogs, restores that folder's tabs and posts a snapshot. Any in-flight response for a folder that is no longer active is dropped instead of being merged.
- The active editor steers the folder only until the user picks one by hand and while no turn is running in the current folder. Background stream events are routed by session id across `allTabIDs()`, so another folder's tab gets its unread and stale flags without repainting the visible chat.
- A new chat is a per-folder draft: the webview keys it as `__new__:<directory>` and carries it into the created session.

## Transcript pagination and windowing

Long sessions are loaded as cursor pages instead of the whole history, so opening a 2000-message chat costs one request and a constant number of DOM nodes.

- `src/opencode-client.ts` wraps `GET /api/session/{id}/message` with `listMessages(sessionID, { limit, order, cursor })` and returns `{ messages, cursor: { previous, next } }`.
- `src/message-pages.ts` is the host-side pure layer: `MESSAGE_PAGE_SIZE` / `MESSAGE_TAIL_SIZE`, `toAscending` for `order=desc` pages, `prependMessages` for older pages, and `mergeTail` to update the newest messages by id without dropping already loaded history.
- `src/sidekick-view.ts` keeps the cursors (`previousCursor`, `nextCursor`, `hasMoreOlder`, `loadingOlder`) for the active session only and resets them on every session switch, so a tab never reuses another tab's cursor. Structural events (`session.execution.*`, tool and step lifecycle) call `refreshTail` (30 newest messages merged by id) instead of reloading the transcript. A full `loadMessages` is kept for open/activate/new/delete/send/manual refresh.
- The snapshot exposes `history: { hasMoreOlder, loadingOlder }`, and the webview asks for the previous page with `{ type: 'loadOlder' }`.
- `widgets/conversation/lib/thread-window.ts` holds the pure windowing math: prefix-sum offsets (measured height plus thread gap per message, `THREAD_ESTIMATE` until measured), binary-search `visibleRange` with an 8-message overscan, and `rangePads` that turn the window into top and bottom padding.
- `widgets/conversation/lib/useThreadWindow.ts` measures rendered items (`[data-thread-id]`, `offsetHeight` plus margin) in a layout effect, keeps the estimate as the average of measured items, and recomputes the window from a rAF-throttled scroll listener. Chats up to `THREAD_WINDOW_THRESHOLD` (60) messages render in full.
- `Conversation` compensates the scroll position after a prepend by re-reading the anchor item's `offsetTop`, and restores a tab from `SessionRuntimeState.distanceFromBottom` (loading up to 5 older pages), because an absolute `scrollTop` no longer refers to the full history.

## Transcript search

`src/shared/chat-search.ts` is the pure matcher shared by the panel and `npm run check:chat-search`: `searchMessages` walks the regions the transcript renders (the prompt bubble, each text and reasoning body, tool name and title, and tool input/output behind `includeOutput`), matches with `new RegExp(escapeRegExp(query), 'giu')` on the original string so offsets stay valid for `İ`-style text, caps a region at `SEARCH_REGION_LIMIT` characters, and stops at `SEARCH_HIT_LIMIT` hits with a `truncated` flag. `stepHit` cycles `N/M`.

`features/chat-search/ui/ChatSearch.tsx` is a find bar in the layout flow between the header and the transcript, so it never covers the composer at 320px. `Cmd/Ctrl+F` (ignored while Settings or History are open) opens it, `Enter` / `Shift+Enter` step through hits, and `Escape` closes it. `widgets/conversation/lib/search-highlight.ts` registers `Range`s in the CSS Custom Highlight API (`chat-search`, `chat-search-active`) for the regions currently in the DOM and returns the active range; without the API the counter and the scroll still work. A jump points the thread anchor at the hit and bumps a render tick, so the virtual window renders a message outside it before the layout effect aligns it, then reports the new scroll position so `stickToBottom` does not pull the transcript back. A hit inside a collapsed reasoning block or tool body opens that body first (`toggleState`), and the active range is scrolled into view with padding, so the jump lands on the match rather than the message top.

## Tool cards

`src/shared/tool-card.ts` is the pure view model shared by the card and `npm run check:tool-card`: `toolOutputWindow` keeps the first `TOOL_OUTPUT_LINES` (200) lines while collapsed and the whole text up to `TOOL_OUTPUT_MAX_CHARS` (200k) while expanded, applies the same 200k character cap in both modes, and reports the hidden line and character counts; `formatDuration` and `exitLabel` spell the header chips. Truncation exists only in the render: `UiPart.input` and `UiPart.output` keep the full text, so `searchMessages` still scans it and a jump whose hit falls behind the window expands it through `${partId}:output-expanded` before the highlight pass. `entities/message/ui/ToolCard.tsx` shows the command with **Copy command** / **Open terminal**, the exit code and duration, and opens a `read`/`write` file at its line or an `edit` as a diff; the host answers `openEditDiff` with two untitled documents in `vscode.diff` (falling back to `openPath` when the text is missing or over the frame budget) and `openToolTerminal` with an empty panel terminal in the session or file folder. The wire status of a completed call stays `ok` and the card labels it **Done**; `streaming` / `pending` read as **Queued**, and a running call has no duration until its `completed` timestamp exists (`ran` is a start, not an end).

## Turn diff review

A finished turn leaves a footer card with its totals. `src/shared/turn-diff.ts` is the pure model (`summarizeTurnDiff`, `turnRefs`, `parsePatch`, `resolveDiffPath`) shared by the host, the card and the panel; patches are fetched only by the singleton panel, never stored in the chat snapshot. The panel asks for one turn with `from` alone (a `to` bound would extend the range to the next turn), renders at most `PATCH_LINE_LIMIT` lines per file with a truncation note, and caps the whole response at `DIFF_MAX_BYTES`.

## Permissions

`src/shared/permission.ts` is the pure model shared by the host, the card and the settings list: `readPermissionRequest` drops `metadata` (it can carry file patches and command output), `permissionRisk` / `permissionSummary` follow the terminal wording, and `upsertPermission` / `removePermission` / `filterResolved` keep the pending list by id. `npm run check:permissions` covers the client calls and these functions and runs as part of `npm run compile`.

- `src/opencode-client.ts` wraps `GET /api/session/{id}/permission`, `POST …/permission/{requestID}/reply`, `GET /api/permission/saved` and `DELETE /api/permission/saved/{id}`; a 404 reply is an `OpenCodeHttpError` with status 404, which the host reports as an expired request.
- The host keeps `permissions` per session, `permissionSending` per request and a bounded FIFO of answered ids, so a stale list or a replayed `permission.asked` frame cannot resurrect a card. `permission.asked` / `permission.replied` are routed before the active-session gate; the list is reloaded on connect, tab activation, stream reconnect, session open and the end of a turn.
- The card is pinned above the revert card (`features/permission-card`, `.permission-foot`). `Allow once` and `Reject` are always available, `Always allow` only when the request carries `save` patterns, and `Reject` is a second step with an optional reason. Nothing is removed optimistically: the reply is awaited, a failure keeps the card, and a 404 or a `permission.replied` frame removes it.
- Auto-approve is off by default and answers `once` only for a `tool` source whose action is exactly one of `read`, `glob`, `grep`, `list`, `find`; it never creates a saved rule and never applies to a request already on screen.
- Settings gains a Permissions section: the auto-approve switch and the saved rules of the active session's `projectID`, with delete only. Hidden tabs show a pending count in the header.

## Queued messages

A message sent while a turn runs waits in the server's durable session inbox instead of blocking the composer. `src/shared/inbox.ts` is the pure model shared by the host and the queue strip: `parseQueueItem` drops `payload` and keeps only the text a row shows, `withDelivery` / `withoutItem` / `upsertQueueItem` mirror the stream frames, and `queueSummary` caps the strip at 50 rows with a `+N more` line. `npm run check:inbox-api` covers the client calls and these functions and runs as part of `npm run compile`.

- `src/opencode-client.ts` wraps `GET /api/session/{id}/inbox`, `PATCH …/inbox/{inboxID}` with exactly `{ delivery }` and `DELETE …/inbox/{inboxID}`; `prompt` adds `delivery` only when the caller asks for it, so an idle send keeps its old body.
- The host keeps `queues` per session, a read epoch per session and the ids with an action in flight. The server list is the source of truth: `session.inbox.enqueued` / `delivered` / `cancelled` / `delivery.changed` move the mirror, an unknown payload falls back to a re-read, and a stale read is dropped by its epoch and the visible session.
- The list is reloaded on connect, tab activation, stream reconnect, session open, the start and end of a turn and after a send. A queued send does not touch `busy` or the turn baseline, so the running turn keeps its diff boundary.
- The strip (`widgets/composer`, `.queue-strip`) sits above the composer and offers **Send now** (`PATCH delivery: steer`), **Edit** (cancel, then the text returns to the composer) and **Delete**; the composer chip reads `N in queue`. A 404 or 409 means the item was delivered: the list is re-read and the row disappears without an error.
- `opencodeSidekick.queueDelivery` chooses `queue` (default) or `steer` for a busy send. A staged or pending revert keeps priority over the queue: `Undo` refuses to stage while rows are waiting and steering is blocked while a revert is staged.

## Editor context

Right-clicking a file or an editor tab adds the file, the selection or the Problems of the clicked file to the composer. `src/shared/editor-context.ts` is the pure model (`selectionRange`, `contextToken`, `composeContextText`, `problemsDigest`, `fileUriWithRange`, `inlineTextUri`, `parseContextRef`, `dedupeRefs`) and is exercised by `npm run check:editor-context`, which runs as part of `npm run compile`.

- A selection travels as the source `file://` URI with `?start&end` when the server would slice it (`text/plain`); other languages and virtual documents travel as a `data:text/plain;base64` URI with exactly the selected text. The chip keeps its `ContextRef`, and `composePrompt` appends the `@path:start-end` token once and gives the chip its mention range, so the agent sees the file, the range and exactly those lines.
- Problems attach the clicked file only, as one chip with the diagnostic count and no mention; the body is a temp text file capped at 200 lines with a `+N more` tail.
- `opencodeSidekick.autoAttachActiveFile` (off by default) offers one automatic chip per chat: `syncAutoContext` runs on editor change, config change, `ready` and `activateTab`, never buffers while the panel is closed, and never duplicates a manual chip of the same file. Removing the automatic chip posts `autoContextDismiss`, so it stays gone until the active editor moves.

## Editor tab

The chat can be opened as one editor tab beside the code (`opencode.sidekick.chat`), from the palette (`OpenCode: Open Chat in Editor Tab`) or a tab's context menu (`openInEditor`). Both surfaces render the same `this.session` and share one stream, so a message sent in the tab shows up in the sidebar and the other way round.

- `src/shared/chat-surface.ts` is the pure surface registry (`add`, `remove`, `markReady`, `markActive`, `ready`, `hasReady`, `active`); `active()` is the last surface the user touched, else the sidebar, else the first ready one, and never a surface whose webview is still booting. `npm run check:chat-surfaces` covers it.
- `src/chat-panel.ts` owns the singleton panel with injected `createPanel`/`html`/`onMessage`/`onReady`/`onDispose`, so it loads in a plain node process for `npm run check:chat-panel`. `show()` reveals the existing tab instead of creating a second one, and the newest `state` that arrives before the webview says `ready` is replayed once.
- `src/shared/chat-surface.ts` also owns the frame routing table (`frameScope`): shared state and chrome frames (`state`, `messages`, `busy`, `error`, `delta`, `autoContext`, `attachmentRemoved`, `openHistory`, `openSettings`, `closeHistory`) are broadcast to every ready surface, `focus` and `toast` go only to `active()`, and request-scoped frames (`attached` with a `requestId`, `attachError`, `attachDone`, `sendRejected`, `files`, a `sessions` search answer, `queueEdit`) go back to the surface that asked. `post()` applies the table, so a UI-only frame cannot land in a surface the user is not looking at and a reply cannot leak into another surface. `npm run check:chat-surfaces` covers the table.
- A host-initiated attachment is added to every surface with the same id, so removing a chip deletes the file and broadcasts `attachmentRemoved` with that id; `useAttachments` drops the chip from every tray, and the other surface no longer sends a dead `file://` URI.
- `previewUri` is no longer baked into an attachment: `withPreview(attachment, webview)` mints it per webview, so two surfaces can show the same image and a buffered attachment gets its URI only when a webview exists.
- The editor tab is as wide as the code beside it, so `body[data-surface='editor']` caps `.thread` and `.composer` at 980px and centers them; the sidebar keeps its full-width layout.
- `handle('ready')` never reconnects an established stream: when `this.client` is already set, a new surface only receives the snapshot and the buffered attachments, which is what makes the second surface cheap.
- The tab title is the session title and its icon is `resources/chat-{running,attention,idle}.svg`: running wins over a pending permission or a connection error, and idle is the fallback. The panel keeps `{ sessionID, directory }` in `PANEL_KEY`; the serializer (`onWebviewPanel:opencode.sidekick.chat`) restores the tab on that session, and closing the tab clears the key without touching the tabs or the session.

## Notifications

A finished turn or a pending permission can raise a system notification with an **Open** button. `src/shared/notification.ts` is the pure policy shared by the host and `npm run check:notifications`: `shouldNotify` walks the mode matrix (`all`, `errors`, `off`), `shouldNotifyApproval` treats a blocking request as news only in `all`, and both stay quiet when `notifyOnlyWhenHidden` is on and the user already sees the chat that needs them.

- `watched` means the window has focus and either the sidebar view (`WebviewView.visible`) or the editor tab (`WebviewPanel.active`) is the surface on screen. `chatPanel.visible` only says the tab exists, so it never decides this.
- One notification per turn: `execution.started` arms the session, and the first `succeeded` / `failed` / `interrupted` frame consumes the flag, so a reconnect, a replayed frame or the second surface cannot notify twice. `failed` uses `showErrorMessage`, the other outcomes `showInformationMessage`; `Open` activates the tab or focuses the container when the session is gone, and never creates tabs.
- The container badge is `view.badge = attentionCount(tabs)`: chats with a new reply or a pending request, recomputed on every `state` frame, tab activation, permission answer, view visibility and window focus. The editor tab has no badge API, so its status icon stays the only signal there; `notifications: off` silences the popups only.
- A dropped event stream or a failed connect shows the persistent banner with **Retry** and makes `snapshot().connected` false while the client is kept for requests; the notification is raised once per outage (`undefined -> message`) and only while the user cannot see the panel. A successful stream reconnect clears the error and brings the chat back online.
- Settings gains a Notifications section (`All` / `Errors` / `Off` plus the hidden-only switch). The editor tab's attention icon and the tab dots keep working in every mode.

## Import policy

Imports use explicit file paths rather than global barrel files. This keeps the esbuild bundle tree-shakeable and avoids a large `index.ts` surface that hides dependencies. A slice may add its own public `index.ts` later if it needs to hide internals.

Forbidden:

- `shared` importing `entities`, `features`, `widgets`, or `app`.
- `entities` importing `features`, `widgets`, or `app`.
- `features` importing `widgets` or `app`.
- `widgets` importing `app`.
- Cross-imports between unrelated feature slices.

Run `npm run check:architecture` to enforce these rules. It is part of `npm run compile` and fails the build on an upward or cross-slice import.

## Why not a flat `components` folder

A flat components folder works for small demos, but this panel already has conversation rendering, session lifecycle, model and agent selection, settings, command parsing, file search, and host-protocol state. Splitting by technical type would put unrelated components together and make the dependency graph hard to read. FSD keeps each change close to its business meaning and limits the blast radius.

## References

- Feature-Sliced Design overview: <https://feature-sliced.design/docs/get-started/overview>
- Bulletproof React project structure: <https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md>
