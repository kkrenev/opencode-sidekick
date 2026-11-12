/**
 * Pure multi-root model: which workspace folder the panel talks to, and which
 * open tabs each folder remembers. Kept free of the `vscode` API so the
 * selection rules and the v1 -> v2 migration can be exercised in node.
 */

export interface FolderRef {
  readonly directory: string;
  readonly name: string;
}

/** Open tabs of one workspace folder. */
export interface FolderTabs {
  readonly open: readonly string[];
  readonly active?: string;
  /**
   * Ids the user pinned. They stay at the front of the strip and refuse an
   * accidental close; only ids that are still open are kept.
   */
  readonly pinned?: readonly string[];
}

/** `opencode.sidekick.tabs.v2`: tabs are stored per folder. */
export interface StoredTabsV2 {
  readonly activeDirectory: string;
  readonly folders: Readonly<Record<string, FolderTabs>>;
}

/** `opencode.sidekick.session` in its v2 shape. */
export interface StoredSelectionV2 {
  readonly activeDirectory: string;
  readonly byDirectory: Readonly<Record<string, string>>;
}

export const EMPTY_FOLDER_TABS: FolderTabs = { open: [] };

export interface DirectoryChoice {
  /** Every folder of the workspace, in VS Code order. */
  readonly folders: readonly string[];
  /** The folder currently in use. */
  readonly current?: string;
  /** The folder of the editor that just became active. */
  readonly requested?: string;
  /** The user picked a folder by hand, so the editor no longer steers. */
  readonly pinned: boolean;
  /** A turn is still running in the current folder. */
  readonly busy: boolean;
  /** Directory used when the workspace has no folders at all. */
  readonly fallback: string;
}

/**
 * Resolves the folder the panel should talk to. A removed current folder always
 * falls back to the first remaining one; otherwise following the active editor
 * stops as soon as the user pinned a folder or a turn is still running.
 */
export function pickDirectory(choice: DirectoryChoice): string {
  const { folders, fallback } = choice;
  if (folders.length === 0) {
    return fallback;
  }
  const current = choice.current && folders.includes(choice.current) ? choice.current : folders[0];
  if (choice.pinned || choice.busy) {
    return current;
  }
  const requested = choice.requested;
  if (requested && folders.includes(requested)) {
    return requested;
  }
  return current;
}

/** Tabs of one folder; a missing folder is an empty tab set. */
export function tabsOf(state: StoredTabsV2 | undefined, directory: string): FolderTabs {
  const tabs = state?.folders[directory];
  if (!tabs) {
    return EMPTY_FOLDER_TABS;
  }
  return withPinned({ open: [...tabs.open], active: tabs.active }, tabs.pinned);
}

/** Returns a new state with the tabs of one folder replaced. */
export function writeFolderTabs(
  state: StoredTabsV2,
  directory: string,
  tabs: FolderTabs,
): StoredTabsV2 {
  return {
    activeDirectory: state.activeDirectory,
    folders: { ...state.folders, [directory]: withPinned({ open: [...tabs.open], active: tabs.active }, tabs.pinned) },
  };
}

/** True when the tab is pinned in this folder. */
export function isPinned(tabs: FolderTabs, id: string): boolean {
  return tabs.pinned?.includes(id) === true;
}

/**
 * Returns the visual order of the strip: pinned tabs first, in the order they
 * were pinned, then every other tab in its stored order.
 */
export function orderTabs(tabs: FolderTabs): string[] {
  const pinned = tabs.pinned ?? [];
  if (pinned.length === 0) {
    return [...tabs.open];
  }
  return [...pinned, ...tabs.open.filter((id) => !pinned.includes(id))];
}

/** Pins or unpins one open tab; pinning twice keeps the first position. */
export function setPinned(tabs: FolderTabs, id: string, pinned: boolean): FolderTabs {
  if (!tabs.open.includes(id)) {
    return tabs;
  }
  const current = tabs.pinned ?? [];
  const next = pinned
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((entry) => entry !== id);
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) {
    return tabs;
  }
  return withPinned({ open: [...tabs.open], active: tabs.active }, next);
}

/**
 * Normalises the persisted tabs. Understands both the v1 shape
 * (`{ directory, open, active }`) and v2. Entries of folders that are not in the
 * workspace right now are kept, so re-adding a folder restores its tabs.
 */
export function migrateTabs(
  stored: unknown,
  directories: readonly string[],
  fallback: string,
): StoredTabsV2 {
  const folders: Record<string, FolderTabs> = {};
  if (stored && typeof stored === 'object') {
    const raw = stored as Record<string, unknown>;
    if (raw.folders && typeof raw.folders === 'object') {
      for (const [directory, value] of Object.entries(raw.folders as Record<string, unknown>)) {
        if (directory.length === 0) {
          continue;
        }
        const tabs = readFolderTabs(value);
        if (tabs.open.length > 0 || tabs.active) {
          folders[directory] = tabs;
        }
      }
      return { activeDirectory: readActiveDirectory(raw, directories, fallback), folders };
    }
    const directory = typeof raw.directory === 'string' ? raw.directory : '';
    if (directory.length > 0 && directories.includes(directory)) {
      const tabs = readFolderTabs(raw);
      if (tabs.open.length > 0 || tabs.active) {
        folders[directory] = tabs;
        return { activeDirectory: directory, folders };
      }
    }
  }
  return { activeDirectory: defaultDirectory(directories, fallback), folders };
}

/** Normalises the persisted active session, v1 (`{ directory, sessionID }`) included. */
export function migrateSelection(
  stored: unknown,
  directories: readonly string[],
  fallback: string,
): StoredSelectionV2 {
  const byDirectory: Record<string, string> = {};
  if (stored && typeof stored === 'object') {
    const raw = stored as Record<string, unknown>;
    if (raw.byDirectory && typeof raw.byDirectory === 'object') {
      for (const [directory, value] of Object.entries(raw.byDirectory as Record<string, unknown>)) {
        if (directory.length > 0 && typeof value === 'string' && value.length > 0) {
          byDirectory[directory] = value;
        }
      }
      return { activeDirectory: readActiveDirectory(raw, directories, fallback), byDirectory };
    }
    const directory = typeof raw.directory === 'string' ? raw.directory : '';
    const sessionID = typeof raw.sessionID === 'string' ? raw.sessionID : '';
    if (directory.length > 0 && sessionID.length > 0 && directories.includes(directory)) {
      byDirectory[directory] = sessionID;
      return { activeDirectory: directory, byDirectory };
    }
  }
  return { activeDirectory: defaultDirectory(directories, fallback), byDirectory };
}

/** Remembered session of one folder, if any. */
export function selectionOf(
  state: StoredSelectionV2 | undefined,
  directory: string,
): string | undefined {
  return state?.byDirectory[directory];
}

/** Returns a new selection state with one folder pointing at another session. */
export function writeSelection(
  state: StoredSelectionV2,
  directory: string,
  sessionID: string,
): StoredSelectionV2 {
  return {
    activeDirectory: state.activeDirectory,
    byDirectory: { ...state.byDirectory, [directory]: sessionID },
  };
}

function readActiveDirectory(
  raw: Record<string, unknown>,
  directories: readonly string[],
  fallback: string,
): string {
  const active = typeof raw.activeDirectory === 'string' ? raw.activeDirectory : '';
  return active.length > 0 && directories.includes(active)
    ? active
    : defaultDirectory(directories, fallback);
}

function defaultDirectory(directories: readonly string[], fallback: string): string {
  return directories[0] ?? fallback;
}

function readFolderTabs(value: unknown): FolderTabs {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const open: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.open)) {
    for (const entry of raw.open) {
      if (typeof entry === 'string' && entry.length > 0 && !seen.has(entry)) {
        seen.add(entry);
        open.push(entry);
      }
    }
  }
  const active =
    typeof raw.active === 'string' && open.includes(raw.active) ? raw.active : undefined;
  const pinned: string[] = [];
  if (Array.isArray(raw.pinned)) {
    for (const entry of raw.pinned) {
      if (typeof entry === 'string' && open.includes(entry) && !pinned.includes(entry)) {
        pinned.push(entry);
      }
    }
  }
  return withPinned(active === undefined ? { open } : { open, active }, pinned);
}

/** Keeps only the pins that still point at an open tab, and only when any are left. */
function withPinned(tabs: FolderTabs, pinned: readonly string[] | undefined): FolderTabs {
  const kept = (pinned ?? []).filter((id) => tabs.open.includes(id));
  if (kept.length === 0) {
    return tabs;
  }
  return { ...tabs, pinned: kept };
}
