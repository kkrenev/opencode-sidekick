# Repository Workflow

- The repository is already initialized and has the `origin` remote.
- After each completed task, run the relevant checks first:
  - `npm run check:architecture`
  - `npm run compile`
  - the focused API/UI checks for the changed area
  - `npm run package` when the extension artifact or manifest changed
- After the checks pass, create a commit for the task. Do not leave completed work uncommitted.
- Agree the commit message with the user before creating the commit. Do not amend, squash, rebase, or force-push unless the user explicitly asks.
- Do not push unless the user explicitly asks for a push.
- Keep the webview dependency flow `app -> widgets -> features -> entities -> shared`. The architecture check must stay green.
