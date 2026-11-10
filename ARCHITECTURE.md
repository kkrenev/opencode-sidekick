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
- `app/model/useSidekickUi.ts` owns local UI state: drawers, popovers, draft, toasts, toggles.
- `app/model/useComposerPalette.ts` owns slash and mention palette detection, file search, and keyboard insertion.
- `app/model/useChatActions.ts` owns send, stop, model, effort, mode, settings, and session actions.
- `app/model/useLocalActions.ts` maps local slash commands to panel actions.

### `widgets`

Large self-contained UI blocks. Widgets receive data and callbacks through props; they do not reach into the app layer.

- `chat-header`
- `conversation`
- `composer`
- `session-history`
- `settings-drawer`

### `features`

Reusable product actions. Features can read entities and shared code, and expose focused UI.

- `model-picker`
- `effort-picker`
- `mode-picker`
- `composer-palette`
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
