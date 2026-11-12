import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { ChatEditorPanel, type ChatPanelStatus } from './chat-panel';
import { TurnDiffPanel, type TurnDiffFetchRequest, type TurnDiffPayload } from './diff-panel';
import { mapMessages, UiMessage, UiPart } from './message-map';
import {
  MESSAGE_PAGE_SIZE,
  MESSAGE_TAIL_SIZE,
  mergeTail,
  prependMessages,
  toAscending,
} from './message-pages';
import {
  AgentAttachment,
  AgentEntry,
  CommandEntry,
  FileAttachment,
  ModelEntry,
  ModelSelection,
  OpenCodeClient,
  OpenCodeHttpError,
  PromptAttachments,
  RawMessage,
  SessionSummary,
  SkillAttachment,
  SkillEntry,
  StreamEvent,
} from './opencode-client';
import { connect, OpenCodeEndpoint } from './opencode-endpoint';
import { resolveOpenSession } from './session-open';
import {
  isSettingKey,
  readSettings,
  resetUiSettings,
  SidekickSettings,
  writeSetting,
} from './settings';
import { BINARY_EXTENSIONS, IMAGE_EXTENSIONS } from './shared/attachment-kind';
import {
  SurfaceRegistry,
  frameScope,
  type SurfaceKind,
  type SurfaceState,
} from './shared/chat-surface';
import { resolveOpenTarget } from './shared/open-target';
import type { SessionRuntimeState } from './shared/session-runtime';
import { DELTA_BUFFER_LIMIT, DeltaChunk } from './shared/session-stream';
import {
  attachmentFitsLimit,
  composeContextText,
  contextToken,
  fileUriWithRange,
  inlineTextUri,
  parseContextRef,
  problemsDigest,
  selectionRange,
  type ContextRef,
  type ProblemItem,
} from './shared/editor-context';
import {
  contextLimit,
  RawTokenCounts,
  readCompactionTimes,
  readTokens,
  shouldAutoCompact,
  TokenBreakdown,
  UsageLevel,
  usageAfterCompaction,
  usageLevel,
  usagePercent,
} from './shared/context-usage';
import {
  canAlwaysAllow,
  filterResolved,
  isAutoApprovable,
  mergePermissionList,
  PermissionDecision,
  PermissionRequest,
  readPermissionRequest,
  rememberResolved,
  removePermission,
  SavedPermission,
  upsertPermission,
} from './shared/permission';
import {
  canEditQueueItem,
  parseQueueItem,
  QueueDelivery,
  QueueItem,
  queueReadIsCurrent,
  upsertQueueItem,
  withDelivery,
  withoutItem,
} from './shared/inbox';
import {
  formatTranscriptMarkdown,
  messageText,
  TRANSCRIPT_LIMIT_BYTES,
  TRANSCRIPT_MESSAGE_LIMIT,
  type TranscriptTruncation,
} from './shared/transcript-markdown';
import {
  DIFF_CONTEXT,
  DIFF_MAX_BYTES,
  decideRevert,
  diffCacheKey,
  firstUserMessageAfter,
  patchBytes,
  readRevert,
  resolveDiffPath,
  revertSummary,
  summarizeTurnDiff,
  truncateMessagesAt,
  turnRefs,
  TURN_DIFF_CACHE_LIMIT,
  type TurnDiffInit,
  type TurnDiffSummary,
  type TurnRef,
} from './shared/turn-diff';
import {
  FolderRef,
  FolderTabs,
  isPinned,
  migrateSelection,
  migrateTabs,
  orderTabs,
  pickDirectory,
  selectionOf,
  setPinned,
  StoredSelectionV2,
  StoredTabsV2,
  tabsOf,
  writeFolderTabs,
  writeSelection,
} from './shared/workspace-folders';

export const VIEW_ID = 'opencode.sidekick';

const SESSION_KEY = 'opencode.sidekick.session';
const TABS_KEY = 'opencode.sidekick.tabs.v2';
const LEGACY_TABS_KEY = 'opencode.sidekick.tabs.v1';
const COMPACTIONS_KEY = 'opencode.sidekick.compactions.v1';
/** Session the editor tab follows, restored by the panel serializer. */
const PANEL_KEY = 'opencode.sidekick.chatPanel.v1';
const SIDEBAR_SURFACE_ID = 'sidebar';
const CHAT_SURFACE_ID = 'editor';
const REFRESH_DEBOUNCE_MS = 320;
const AUTO_COMPACT_COOLDOWN_MS = 30_000;
const AUTO_COMPACT_TIMEOUT_MS = 180_000;
const NOTICE_LIMIT = 20;
const ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_LIMIT_COUNT = 10;
const ATTACHMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SCREENSHOT_TIMEOUT_MS = 120_000;
const SCREENSHOT_PASTE_HINT =
  'VS Code cannot capture or read images from the clipboard. Copy the screenshot, then press Ctrl+V in the OpenCode composer.';
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpe?g|gif|webp|bmp));base64,/i;
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,/i;
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

const execFileAsync = promisify(execFile);

type AttachmentKind = 'image' | 'file' | 'folder' | 'selection' | 'problems';

interface HostAttachment {
  readonly id: string;
  readonly name: string;
  readonly uri: string;
  readonly previewUri?: string;
  readonly kind: AttachmentKind;
  readonly size: number;
  readonly description?: string;
  /** Editor context the attachment stands for; drives the prompt mention. */
  readonly context?: ContextRef;
}

/** A chip file plus the context that produced it; `context` never reaches the server. */
interface ContextFileAttachment extends FileAttachment {
  readonly context?: ContextRef;
}

/** One live chat webview: the sidebar view or the editor tab. */
interface Surface extends SurfaceState {
  readonly webview: vscode.Webview;
}

/** Request-scoped channel back to the surface that sent a message. */
interface SurfaceReply {
  /** The webview the frame renders in, so `previewUri` is minted for it. */
  readonly webview: vscode.Webview;
  send(message: Record<string, unknown>): void;
}

/** What the serializer needs to bring the editor tab back on its session. */
interface StoredPanelTarget {
  readonly sessionID: string;
  readonly directory: string;
}

/** v1 shapes, read once and migrated by `src/shared/workspace-folders.ts`. */
interface StoredTabsV1 {
  readonly directory: string;
  readonly open: readonly string[];
  readonly active?: string;
}

interface StoredSelectionV1 {
  readonly directory: string;
  readonly sessionID: string;
}

interface SessionTab {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  readonly missing: boolean;
  readonly unread: boolean;
  readonly stale: boolean;
  /** Pinned tabs stay first and refuse an accidental close. */
  readonly pinned: boolean;
  /** Pending permission requests of a hidden tab. */
  readonly permissions: number;
}

/**
 * The host-owned transcript cache of one session. Background sessions keep
 * their pages here so activating a tab never needs a full re-read.
 */
interface Transcript {
  messages: UiMessage[];
  olderCursor?: string;
  newerCursor?: string;
  hasMoreOlder: boolean;
}

interface DefaultSelection {
  readonly model?: ModelSelection;
  readonly effort?: string;
  readonly mode?: string;
}

/** Context usage of one session; `used` never comes from the cumulative totals. */
interface SessionUsageState {
  used: number | null;
  cost?: number;
  tokens?: TokenBreakdown;
  /** Set when a compaction ended: older assistant tokens are no longer the context. */
  compactedAt?: number;
  lastCompaction?: { readonly reason: 'auto' | 'manual'; readonly at: number };
}

/** In-memory system plaque of one session, rendered outside the transcript. */
interface UiNoticeState {
  readonly id: string;
  readonly kind: 'compaction' | 'revert' | 'permission';
  /** Compaction only: whether the server ran it on its own. */
  readonly reason?: 'auto' | 'manual';
  readonly at: number;
  readonly text: string;
}

export class SidekickViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  /** Sidebar and editor tab: both render `this.session` and share the stream. */
  private readonly surfaces = new SurfaceRegistry<Surface>();
  private client: OpenCodeClient | undefined;
  private endpoint: OpenCodeEndpoint | undefined;
  private connecting: Promise<void> | undefined;
  private stopStream: (() => void) | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private sessionRefreshTimer: NodeJS.Timeout | undefined;
  private session: SessionSummary | undefined;
  private sessions: SessionSummary[] = [];
  private folders: readonly vscode.WorkspaceFolder[] = [];
  private activeDirectory: string;
  private directoryPinned = false;
  private tabsState: StoredTabsV2;
  private selection: StoredSelectionV2;
  private folderSubscriptions: vscode.Disposable[] = [];
  private tabSessions = new Map<string, SessionSummary>();
  private tabMissing = new Set<string>();
  private tabRunning = new Set<string>();
  private tabUnread = new Set<string>();
  private tabStale = new Set<string>();
  private forking = new Set<string>();
  private runtimes = new Map<string, SessionRuntimeState>();
  private usageBySession = new Map<string, SessionUsageState>();
  private notices = new Map<string, UiNoticeState[]>();
  private compacting = new Set<string>();
  /** Auto-compaction already ran for the current high-usage episode. */
  private autoCompactSpent = new Set<string>();
  private lastAutoCompactAt = new Map<string, number>();
  private compactionTimers = new Map<string, NodeJS.Timeout>();
  private compactionTimes: Record<string, number> = {};
  private transcripts = new Map<string, Transcript>();
  private pendingDeltas = new Map<string, DeltaChunk[]>();
  private sessionTailTimers = new Map<string, NodeJS.Timeout>();
  private tailRequests = new Map<string, number>();
  private loadingOlder = false;
  private models: ModelEntry[] = [];
  private agents: AgentEntry[] = [];
  private commands: CommandEntry[] = [];
  private skills: SkillEntry[] = [];
  private defaultModel: ModelSelection | undefined;
  private settings: SidekickSettings = readSettings();
  private configSubscription: vscode.Disposable | undefined;
  private pendingSettings = false;
  private pendingAttachments: HostAttachment[] = [];
  private capturing = false;
  /** URI of the automatic file chip currently offered, if any. */
  private autoContextUri: string | undefined;
  /** Files whose automatic chip the user removed; kept until the editor moves. */
  private autoContextDismissed = new Set<string>();
  private loading = false;
  private busy = false;
  private lastError: string | undefined;
  /** User message that started the current or last turn of a session. */
  private turnStarts = new Map<string, string>();
  /** User message id before the turn was sent; `null` when there was none. */
  private turnBaselines = new Map<string, string | null>();
  /** Computed totals per `(sessionID, from)`; patches never live here. */
  private turnDiffs = new Map<
    string,
    { readonly summary: TurnDiffSummary; readonly at: number }
  >();
  private latestTurnDiff = new Map<string, string>();
  /** A diff request of this session is in flight. */
  private turnDiffPending = new Set<string>();
  /** Staged revert of a session: the boundary turn and the files it changed. */
  private reverts = new Map<string, TurnDiffSummary>();
  /** A stage, commit or clear request of this session is in flight. */
  private revertPending = new Set<string>();
  /** Bumped on every local revert transition; older responses must not apply. */
  private revertEpoch = 0;
  /** Pending permission requests per session, in arrival order. */
  private permissions = new Map<string, PermissionRequest[]>();
  /** Request ids with a reply in flight; the card stays but its buttons lock. */
  private permissionSending = new Set<string>();
  /** Server inbox per session; the panel never keeps a queue of its own. */
  private queues = new Map<string, QueueItem[]>();
  /** Read epoch per session: a stale list must not overwrite a newer one. */
  private queueRequests = new Map<string, number>();
  /** Inbox ids with a steer, edit or cancel in flight. */
  private queuePending = new Map<string, Set<string>>();
  /** Sessions whose queue was read at least once; an empty map is not a baseline. */
  private queueLoaded = new Set<string>();
  /** Answered ids; a stale list or a replayed frame must not resurrect them. */
  private permissionResolved = new Set<string>();
  private savedPermissions: SavedPermission[] = [];
  private savedPermissionsError: string | undefined;
  /** Shown instead of the list when there is no project to scope it to. */
  private savedPermissionsHint: string | undefined;
  private diffPanel: TurnDiffPanel;
  private diffPanelDirectory: string | undefined;
  private readonly chatPanel: ChatEditorPanel;
  private readonly chatIcons: Readonly<Record<ChatPanelStatus, vscode.Uri>>;
  /** Session the editor tab shows; a change of it is persisted for restore. */
  private panelSessionID: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.folders = vscode.workspace.workspaceFolders ?? [];
    const directories = this.folderDirectories();
    const fallback = os.homedir();
    this.tabsState = migrateTabs(
      this.context.workspaceState.get<StoredTabsV2 | StoredTabsV1>(TABS_KEY) ??
        this.context.workspaceState.get<StoredTabsV1>(LEGACY_TABS_KEY),
      directories,
      fallback,
    );
    this.activeDirectory = this.tabsState.activeDirectory;
    this.selection = migrateSelection(
      this.context.workspaceState.get<StoredSelectionV2 | StoredSelectionV1>(SESSION_KEY),
      directories,
      fallback,
    );
    this.compactionTimes = readCompactionTimes(
      this.context.workspaceState.get<Record<string, unknown>>(COMPACTIONS_KEY),
    );
    this.folderSubscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.onFoldersChanged();
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.onActiveEditorChanged(editor);
      }),
    ];
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('opencodeSidekick')) {
        return;
      }
      this.settings = readSettings();
      this.post({ type: 'state', state: this.snapshot() });
      void this.syncAutoContext();
    });
    this.diffPanel = new TurnDiffPanel({
      extensionUri: this.context.extensionUri,
      fetchDiff: (sessionID, request) => this.fetchTurnDiff(sessionID, request),
      openFile: (file, line) => this.openDiffFile(file, line),
      copy: (text) => this.writeClipboard(text),
    });
    this.chatIcons = {
      idle: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'chat-idle.svg'),
      running: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'chat-running.svg'),
      attention: vscode.Uri.joinPath(
        this.context.extensionUri,
        'resources',
        'chat-attention.svg',
      ),
    };
    this.chatPanel = new ChatEditorPanel({
      extensionUri: this.context.extensionUri,
      globalStorageUri: this.context.globalStorageUri,
      html: (webview) => this.html(webview, 'editor'),
      createPanel: (viewType, title, column, options) =>
        vscode.window.createWebviewPanel(viewType, title, column, options),
      onMessage: (message) => {
        const webview = this.chatPanel.webview;
        if (!webview) {
          return;
        }
        this.surfaces.markActive(CHAT_SURFACE_ID);
        void this.handle(
          { id: CHAT_SURFACE_ID, kind: 'editor', ready: true, webview },
          message,
        );
      },
      onReady: () => {
        this.surfaces.markReady(CHAT_SURFACE_ID);
        this.surfaces.markActive(CHAT_SURFACE_ID);
      },
      onDispose: () => {
        this.surfaces.remove(CHAT_SURFACE_ID);
        this.panelSessionID = undefined;
        void this.context.workspaceState.update(PANEL_KEY, undefined);
      },
    });
  }

  /** Folder the panel talks to; every directory-scoped request uses it. */
  get directory(): string {
    return this.activeDirectory;
  }

  private folderDirectories(): string[] {
    return this.folders.map((folder) => folder.uri.fsPath);
  }

  private folderRefs(): FolderRef[] {
    return this.folders.map((folder) => ({ directory: folder.uri.fsPath, name: folder.name }));
  }

  private refreshFolders(): void {
    this.folders = vscode.workspace.workspaceFolders ?? [];
  }

  /** Tabs of the folder in use, or an empty set for a folder without tabs. */
  private get tabIDs(): readonly string[] {
    return tabsOf(this.tabsState, this.activeDirectory).open;
  }

  private writeTabs(directory: string, tabs: FolderTabs): void {
    this.tabsState = writeFolderTabs(this.tabsState, directory, tabs);
  }
  /** Every open tab of the workspace, whichever folder it belongs to. */
  private allTabIDs(): string[] {
    const ids: string[] = [];
    for (const tabs of Object.values(this.tabsState.folders)) {
      ids.push(...tabs.open);
    }
    return ids;
  }

  private hasTab(id: string): boolean {
    return Object.values(this.tabsState.folders).some((tabs) => tabs.open.includes(id));
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    const surface: Surface = {
      id: SIDEBAR_SURFACE_ID,
      kind: 'sidebar',
      ready: false,
      webview: view.webview,
    };
    this.surfaces.add(surface);
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, this.context.globalStorageUri],
    };
    try {
      view.webview.html = await this.html(view.webview, 'sidebar');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      view.webview.html = `<html><body><pre>OpenCode Sidekick failed to load: ${message.replace(/</g, '&lt;')}</pre></body></html>`;
    }
    view.onDidDispose(() => {
      this.surfaces.remove(SIDEBAR_SURFACE_ID);
    });
    view.webview.onDidReceiveMessage((message) => {
      this.surfaces.markActive(SIDEBAR_SURFACE_ID);
      void this.handle(surface, message as { type: string; [key: string]: unknown });
    });
  }

  browserUrl(): string | undefined {
    if (!this.endpoint) {
      return undefined;
    }
    return `${this.endpoint.url}/?auth_token=${encodeURIComponent(this.endpoint.credential)}`;
  }

  async newSession(options: { autoContext?: boolean } = {}): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    const directory = this.directory;
    try {
      const session = await client.createSession(directory);
      if (this.activeDirectory !== directory) {
        // The user switched folders while the session was being created: keep it
        // in the tab set of its own folder instead of stealing the visible chat.
        this.openTab(session, directory);
        await this.persistTabs();
        this.post({ type: 'state', state: this.snapshot() });
        return;
      }
      this.session = session;
      this.openTab(session);
      this.transcripts.delete(session.id);
      this.pendingDeltas.delete(session.id);
      this.tailRequests.delete(session.id);
      this.busy = false;
      await this.applyNewSessionDefaults(session);
      await this.persistSession(session.id);
      await this.persistTabs();
      await this.loadSessions();
      this.post({ type: 'state', state: this.snapshot() });
      this.postUi({ type: 'focus', target: 'composer' });
      if (options.autoContext !== false) {
        // A fresh chat starts with an empty tray; offer the active file again.
        this.autoContextUri = undefined;
        void this.syncAutoContext();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  async showHistory(): Promise<void> {
    await this.loadSessions();
    this.post({ type: 'state', state: this.snapshot() });
    // Both surfaces can show the drawer, and a palette command may focus the
    // sidebar while the panel was the last surface touched.
    this.post({ type: 'openHistory' });
  }

  /**
   * Opens the chat as an editor tab beside the code. The tab is a singleton:
   * a second call reveals it and moves it to the session that is now active.
   */
  async openChatInEditor(sessionID?: string): Promise<void> {
    const id = sessionID ?? this.session?.id;
    if (!id) {
      void vscode.window.showWarningMessage(
        'Open a chat in OpenCode Sidekick first, then open it in an editor tab.',
      );
      return;
    }
    if (this.hasTab(id)) {
      await this.activateTab(id);
    }
    const title = this.tabSessions.get(id)?.title || this.session?.title || 'Untitled';
    try {
      await this.chatPanel.show({ sessionID: id, title, column: vscode.ViewColumn.Beside });
    } catch (error) {
      void vscode.window.showErrorMessage(describeError(error));
      return;
    }
    const webview = this.chatPanel.webview;
    if (webview) {
      this.surfaces.add({
        id: CHAT_SURFACE_ID,
        kind: 'editor',
        ready: this.chatPanel.isReady,
        webview,
      });
    }
    this.surfaces.markActive(CHAT_SURFACE_ID);
    await this.persistPanelTarget(id);
    this.syncChatChrome();
  }

  /**
   * The serializer hands back the panel after a window reload. The webview
   * state is empty, so the session comes from `PANEL_KEY`; a session that is
   * gone leaves the tab on the current chat instead of closing it.
   */
  async restoreChatPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const stored =
      readPanelTarget(state) ??
      readPanelTarget(this.context.workspaceState.get<StoredPanelTarget>(PANEL_KEY));
    try {
      await this.chatPanel.restore(panel, stored?.sessionID);
    } catch (error) {
      void vscode.window.showErrorMessage(describeError(error));
      return;
    }
    const webview = this.chatPanel.webview;
    if (webview) {
      this.surfaces.add({
        id: CHAT_SURFACE_ID,
        kind: 'editor',
        ready: this.chatPanel.isReady,
        webview,
      });
    }
    this.surfaces.markActive(CHAT_SURFACE_ID);
    if (!this.client) {
      await this.connectAndLoad();
    }
    if (stored?.directory && this.folderDirectories().includes(stored.directory)) {
      if (stored.directory !== this.activeDirectory) {
        await this.selectDirectory(stored.directory);
      }
    }
    if (stored?.sessionID && this.hasTab(stored.sessionID)) {
      await this.activateTab(stored.sessionID);
    } else {
      this.post({ type: 'state', state: this.snapshot() });
    }
    this.syncChatChrome();
  }

  /**
   * Command-palette screenshot: the capture itself is interactive, so the
   * attachment waits in `pendingAttachments` if the panel is still loading.
   */
  async attachScreenshot(): Promise<void> {
    if (process.platform !== 'darwin') {
      this.showScreenshotPasteHint();
      return;
    }
    try {
      const attachment = await this.captureScreenshot();
      if (attachment) {
        this.deliverAttachment(attachment);
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'screencapture could not start.';
      this.reportAttachError(`Attach screenshot failed: ${reason}`);
    }
  }

  async attachSelectionFromCommand(
    editor?: vscode.TextEditor,
    uri?: vscode.Uri,
  ): Promise<void> {
    try {
      if (!editor && uri) {
        // The clicked tab is not the active editor, so it has no live selection.
        this.deliverAttachment(await this.attachFileUri(uri));
        return;
      }
      this.deliverAttachment(await this.captureSelection(editor));
    } catch (error) {
      this.reportAttachError(describeError(error));
    }
  }

  /** Right-click / palette: attach the whole file the command was invoked on. */
  async addFileToChat(uri?: vscode.Uri): Promise<void> {
    try {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        this.reportAttachError('Open a file to add it to the chat.');
        return;
      }
      this.deliverAttachment(await this.attachFileUri(target));
    } catch (error) {
      this.reportAttachError(describeError(error));
    }
  }

  /** Right-click / palette: attach the diagnostics of the clicked file. */
  async addProblemsToChat(uri?: vscode.Uri): Promise<void> {
    try {
      this.deliverAttachment(await this.attachProblemsFor(uri));
    } catch (error) {
      this.reportAttachError(describeError(error));
    }
  }

  /**
   * Command-palette copy of the newest assistant answer. Reads the cached
   * transcript and only falls back to a load when nothing is cached yet.
   */
  async copyLastAnswer(): Promise<void> {
    if (!(await this.ensureConnected())) {
      void vscode.window.showWarningMessage('OpenCode Sidekick is not connected yet.');
      return;
    }
    if (!this.session) {
      void vscode.window.showWarningMessage('Open a chat in OpenCode Sidekick first.');
      return;
    }
    if (this.activeMessages().length === 0) {
      await this.loadMessages();
    }
    const last = [...this.activeMessages()]
      .reverse()
      .find((message) => message.role === 'assistant' && messageText(message).length > 0);
    if (!last) {
      void vscode.window.showWarningMessage('There is no answer to copy yet.');
      return;
    }
    if (await this.writeClipboard(messageText(last))) {
      vscode.window.setStatusBarMessage('Copied last answer', 3000);
    }
  }

  /**
   * Command-palette markdown export of the whole session. It walks the server
   * cursor instead of the panel cache, so a session the panel never scrolled
   * through still copies in full.
   */
  async copyTranscript(): Promise<void> {
    if (!(await this.ensureConnected())) {
      void vscode.window.showWarningMessage('OpenCode Sidekick is not connected yet.');
      return;
    }
    const client = this.client;
    const session = this.session;
    if (!client || !session) {
      void vscode.window.showWarningMessage('Open a chat in OpenCode Sidekick first.');
      return;
    }
    try {
      const pages: UiMessage[][] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let read = 0;
      let bytes = 0;
      let truncated: TranscriptTruncation | undefined;
      while (true) {
        const page = await client.listMessages(session.id, {
          limit: 200,
          order: 'desc',
          ...(cursor ? { cursor } : {}),
        });
        const batch = mapMessages(toAscending(page.messages), this.folderDirectories());
        if (batch.length > 0) {
          pages.unshift(batch);
          read += page.messages.length;
          bytes += batch.reduce((sum, message) => sum + messageText(message).length, 0);
        }
        const next = page.cursor?.next;
        // A repeated cursor would loop forever; stop like an exhausted one.
        if (!next || page.messages.length === 0 || seen.has(next)) {
          break;
        }
        seen.add(next);
        if (read >= TRANSCRIPT_MESSAGE_LIMIT) {
          truncated = 'messages';
          break;
        }
        if (bytes >= TRANSCRIPT_LIMIT_BYTES) {
          truncated = 'bytes';
          break;
        }
        cursor = next;
      }
      // A message can sit on two pages; the map keeps the first (ascending)
      // position and the newest copy of each id, like `mergeTail`.
      const ordered = new Map<string, UiMessage>();
      for (const batch of pages) {
        for (const message of batch) {
          ordered.set(message.id, message);
        }
      }
      const all = [...ordered.values()];
      const messages =
        all.length > TRANSCRIPT_MESSAGE_LIMIT ? all.slice(-TRANSCRIPT_MESSAGE_LIMIT) : all;
      if (messages.length < all.length) {
        truncated ??= 'messages';
      }
      const markdown = formatTranscriptMarkdown(messages, {
        title: session.title,
        truncated,
      });
      if (await this.writeClipboard(markdown)) {
        vscode.window.setStatusBarMessage('Copied conversation', 3000);
      }
    } catch (error) {
      void vscode.window.showWarningMessage(describeError(error));
    }
  }

  /** Copy the active editor selection as `path:start-end` plus a fence. */
  async copySelectionWithReference(): Promise<void> {
    try {
      const payload = await this.selectionPayload();
      if (await this.writeClipboard(payload.markdown)) {
        vscode.window.setStatusBarMessage(`Copied ${payload.range}`, 3000);
      }
    } catch (error) {
      this.reportAttachError(describeError(error));
    }
  }

  openSettings(): void {
    if (!this.anyReady()) {
      this.pendingSettings = true;
      return;
    }
    this.post({ type: 'openSettings' });
  }

  async reload(): Promise<void> {
    await this.connectAndLoad();
  }

  dispose(): void {
    this.stopStream?.();
    this.stopStream = undefined;
    this.configSubscription?.dispose();
    this.configSubscription = undefined;
    for (const subscription of this.folderSubscriptions) {
      subscription.dispose();
    }
    this.folderSubscriptions = [];
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.sessionRefreshTimer) {
      clearTimeout(this.sessionRefreshTimer);
      this.sessionRefreshTimer = undefined;
    }
    for (const timer of this.sessionTailTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionTailTimers.clear();
    for (const timer of this.compactionTimers.values()) {
      clearTimeout(timer);
    }
    this.compactionTimers.clear();
    this.diffPanel.dispose();
    this.chatPanel.dispose();
    this.client = undefined;
    this.endpoint = undefined;
  }

  /**
   * Registers a session as a tab. `revertEpoch` is the epoch its payload was
   * requested in; `null` keeps the staged card untouched, which is what a
   * cached copy used as a fallback needs.
   */
  private openTab(
    session: SessionSummary,
    directory = this.activeDirectory,
    revertEpoch: number | null = this.revertEpoch,
  ): void {
    this.rememberTab(session, revertEpoch);
    const tabs = tabsOf(this.tabsState, directory);
    if (!tabs.open.includes(session.id)) {
      this.writeTabs(directory, {
        open: [...tabs.open, session.id],
        active: tabs.active,
        pinned: tabs.pinned,
      });
    }
  }

  private rememberTab(session: SessionSummary, revertEpoch: number | null = this.revertEpoch): void {
    this.tabSessions.set(session.id, session);
    this.tabMissing.delete(session.id);
    if (session.running) {
      this.tabRunning.add(session.id);
    } else {
      this.tabRunning.delete(session.id);
    }
    if (revertEpoch !== null) {
      this.applySessionRevert(session, revertEpoch);
    }
  }

  /**
   * Mirrors `Session.Info.revert` into the chat state. `revert` is optional on
   * the wire and absence means the session has no staged revert, so an answer
   * requested after the last transition also removes a card left by an earlier
   * payload; otherwise a reload would block Send and Compact for good.
   *
   * `revertEpoch` is the epoch the response was requested in: a stage, commit or
   * clear that happened while it was in flight makes the payload stale, and a
   * stale payload must not add or remove the card.
   */
  private applySessionRevert(session: SessionSummary, revertEpoch: number): void {
    const decision = decideRevert(session.revert, session.id, revertEpoch, this.revertEpoch);
    if (decision.action === 'stale') {
      // The response was requested before a revert transition: its revert is
      // stale, and the cached copy must not keep it either.
      this.forgetSessionRevert(session.id);
      return;
    }
    if (decision.action === 'clear') {
      this.reverts.delete(session.id);
      return;
    }
    this.reverts.set(session.id, decision.summary);
  }

  /**
   * Drops a revert from the cached session copies, so a refresh that started
   * before the commit cannot put the finished card back.
   */
  private forgetSessionRevert(sessionID: string): void {
    const cached = this.tabSessions.get(sessionID);
    if (cached?.revert) {
      this.tabSessions.set(sessionID, { ...cached, revert: undefined });
    }
    if (this.session?.id === sessionID && this.session.revert) {
      this.session = { ...this.session, revert: undefined };
    }
  }

  private removeTab(id: string): string | undefined {
    const tabs = tabsOf(this.tabsState, this.activeDirectory);
    const index = tabs.open.indexOf(id);
    if (index === -1) {
      return undefined;
    }
    const open = tabs.open.filter((_, cursor) => cursor !== index);
    this.writeTabs(this.activeDirectory, {
      open,
      active: tabs.active === id ? undefined : tabs.active,
      pinned: tabs.pinned,
    });
    this.tabSessions.delete(id);
    this.tabMissing.delete(id);
    this.tabRunning.delete(id);
    this.tabUnread.delete(id);
    this.tabStale.delete(id);
    this.runtimes.delete(id);
    this.transcripts.delete(id);
    this.pendingDeltas.delete(id);
    this.tailRequests.delete(id);
    this.usageBySession.delete(id);
    this.notices.delete(id);
    this.compacting.delete(id);
    this.autoCompactSpent.delete(id);
    this.lastAutoCompactAt.delete(id);
    this.turnStarts.delete(id);
    this.turnBaselines.delete(id);
    this.turnDiffPending.delete(id);
    this.latestTurnDiff.delete(id);
    this.reverts.delete(id);
    this.revertPending.delete(id);
    for (const request of this.permissions.get(id) ?? []) {
      this.permissionSending.delete(request.id);
    }
    this.permissions.delete(id);
    this.queues.delete(id);
    this.queueRequests.delete(id);
    this.queuePending.delete(id);
    this.queueLoaded.delete(id);
    const diffPrefix = `${id}\u0000`;
    for (const key of [...this.turnDiffs.keys()]) {
      if (key.startsWith(diffPrefix)) {
        this.turnDiffs.delete(key);
      }
    }
    const compactionTimer = this.compactionTimers.get(id);
    if (compactionTimer) {
      clearTimeout(compactionTimer);
      this.compactionTimers.delete(id);
    }
    const timer = this.sessionTailTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.sessionTailTimers.delete(id);
    }
    return open[Math.min(index, open.length - 1)];
  }

  /**
   * Rebuilds the tab set of one folder from its stored ids and the sessions that
   * still exist. `undefined` means the connect path should fall back to the most
   * recent session: either the folder has no record at all, or no stored session
   * could be resolved, in which case the stored layout is kept for a later try.
   */
  private async restoreTabs(directory = this.activeDirectory): Promise<FolderTabs | undefined> {
    const stored = tabsOf(this.tabsState, directory);
    if (stored.open.length === 0 && stored.active === undefined) {
      return undefined;
    }
    const known = new Map(this.sessions.map((entry) => [entry.id, entry]));
    const open: string[] = [];
    let failed = 0;
    const revertEpoch = this.revertEpoch;
    for (const id of stored.open) {
      let session = known.get(id);
      if (!session) {
        if (!this.client) {
          failed += 1;
          continue;
        }
        try {
          session = await this.client.getSession(id);
          known.set(id, session);
        } catch {
          // Either the session was deleted, or the server is unreachable.
          failed += 1;
          continue;
        }
      }
      open.push(id);
      this.rememberTab(session, revertEpoch);
    }
    if (stored.open.length > 0 && failed === stored.open.length) {
      // Nothing could be verified: keep the stored layout for the next attempt
      // instead of wiping tabs that a restart of the server took away.
      return undefined;
    }
    const active = stored.active && open.includes(stored.active) ? stored.active : undefined;
    this.writeTabs(directory, { open, active, pinned: stored.pinned });
    return { open, active, pinned: stored.pinned };
  }

  private tabEntries(): SessionTab[] {
    const tabs = tabsOf(this.tabsState, this.activeDirectory);
    return orderTabs(tabs).map((id) => {
      const cached = this.tabSessions.get(id);
      return {
        id,
        title: cached ? cached.title || 'Untitled' : 'Missing session',
        running:
          this.tabRunning.has(id) ||
          cached?.running === true ||
          (id === this.session?.id && this.busy),
        missing: this.tabMissing.has(id),
        unread: this.tabUnread.has(id),
        stale: this.tabStale.has(id),
        pinned: isPinned(tabs, id),
        permissions: this.pendingPermissions(id).length,
      };
    });
  }

  private async persistTabs(): Promise<void> {
    this.tabsState = writeFolderTabs(
      { ...this.tabsState, activeDirectory: this.activeDirectory },
      this.activeDirectory,
      {
        open: this.tabIDs,
        active: this.session?.id,
        pinned: tabsOf(this.tabsState, this.activeDirectory).pinned,
      },
    );
    await this.context.workspaceState.update(TABS_KEY, this.tabsState);
  }

  private async reconcileTabs(directory = this.activeDirectory): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      const known = new Set(
        (await this.client.listSessions(directory)).map((entry) => entry.id),
      );
      for (const id of tabsOf(this.tabsState, directory).open) {
        if (!known.has(id)) {
          this.tabMissing.add(id);
          this.tabRunning.delete(id);
        }
      }
    } catch {
      // Keep the current tab state when the server cannot list sessions.
    }
  }

  private async activateTab(id: string): Promise<void> {
    if (!this.tabIDs.includes(id)) {
      return;
    }
    const cached = this.tabSessions.get(id) ?? this.sessions.find((entry) => entry.id === id);
    if (!cached) {
      this.tabMissing.add(id);
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    this.session = cached;
    this.busy = this.tabRunning.has(id) || cached.running;
    // A dropped stream or an overflowed delta buffer leaves this tab behind the
    // server, so the flag has to be read before the notice is cleared.
    const stale = this.tabStale.has(id);
    this.tabUnread.delete(id);
    const seeded = this.hasTranscript(id);
    // Paint the cached transcript right away: the tab switch must not wait on
    // the network and must not drop the pages the user already scrolled to.
    this.post({ type: 'state', state: this.snapshot() });
    if (seeded && !stale) {
      this.applyBufferedDeltas(id);
      this.post({ type: 'state', state: this.snapshot() });
    } else {
      const refreshed = await this.refreshTail(id);
      if (this.session?.id !== id) {
        return;
      }
      if (!refreshed) {
        this.tabStale.add(id);
      }
      this.applyBufferedDeltas(id);
      this.post({ type: 'state', state: this.snapshot() });
    }
    const cachedUsage = this.usageBySession.get(id);
    if (cachedUsage) {
      // A background tab may have crossed the threshold while it was hidden.
      this.maybeAutoCompact(id, this.usageLevelOf(id, cachedUsage.used));
    }
    // Requests that arrived while the tab was hidden are only in the server
    // list; the cards appear as soon as this tab is on screen.
    void this.loadPermissions(id);
    void this.loadQueue(id);
    await this.persistSession(id);
    await this.persistTabs();
    // Each chat keeps its own tray, so the automatic chip is offered again.
    this.autoContextUri = undefined;
    void this.syncAutoContext();
  }

  private hasTranscript(id: string): boolean {
    const entry = this.transcripts.get(id);
    return (
      entry !== undefined &&
      (entry.messages.length > 0 ||
        entry.olderCursor !== undefined ||
        entry.newerCursor !== undefined)
    );
  }

  private clearTabNotice(id: string): void {
    this.tabUnread.delete(id);
    this.tabStale.delete(id);
  }

  private transcriptFor(id: string): Transcript {
    let entry = this.transcripts.get(id);
    if (!entry) {
      entry = { messages: [], hasMoreOlder: false };
      this.transcripts.set(id, entry);
    }
    return entry;
  }

  private activeMessages(): UiMessage[] {
    const id = this.session?.id;
    return (id && this.transcripts.get(id)?.messages) || [];
  }

  private bufferDelta(sessionID: string, chunk: DeltaChunk): void {
    const buffer = this.pendingDeltas.get(sessionID);
    if (!buffer) {
      this.pendingDeltas.set(sessionID, [chunk]);
      return;
    }
    if (buffer.length >= DELTA_BUFFER_LIMIT) {
      // The buffer fell behind: stop buffering and let activation re-read the
      // tail from the server instead of replaying an incomplete history.
      this.pendingDeltas.delete(sessionID);
      this.tabStale.add(sessionID);
      return;
    }
    buffer.push(chunk);
  }

  private applyBufferedDeltas(sessionID: string): void {
    const buffer = this.pendingDeltas.get(sessionID);
    this.pendingDeltas.delete(sessionID);
    if (!buffer || buffer.length === 0) {
      return;
    }
    const entry = this.transcriptFor(sessionID);
    entry.messages = applyDeltaChunks(
      entry.messages,
      buffer,
      this.tabSessions.get(sessionID)?.agent,
    );
  }

  /** Closes a tab unless it is pinned; pinned tabs need an explicit unpin. */
  private async closeTab(id: string): Promise<void> {
    if (isPinned(tabsOf(this.tabsState, this.activeDirectory), id)) {
      this.postUi({ type: 'toast', text: 'Pinned — unpin to close' });
      return;
    }
    await this.dropTab(id);
  }

  /** Removes a tab and keeps the panel on a neighbour when it was the active one. */
  private async dropTab(id: string): Promise<void> {
    const wasActive = this.session?.id === id;
    const nextID = this.removeTab(id);
    if (!wasActive) {
      await this.persistTabs();
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    if (nextID && this.tabIDs.includes(nextID)) {
      await this.activateTab(nextID);
      return;
    }
    this.session = undefined;
    this.busy = false;
    await this.persistTabs();
    this.post({ type: 'state', state: this.snapshot() });
  }

  /** Renames a session on the server, then refreshes the strip and the history. */
  private async renameSession(id: string, title: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const updated = await client.updateSession(id, { title });
      // The patch returns no `time.busy`, so keep the run state the tab already has.
      const running = this.tabRunning.has(id) || (this.session?.id === id && this.busy);
      const next = { ...updated, running };
      this.tabSessions.set(id, next);
      if (this.session?.id === id) {
        this.session = next;
      }
      await this.loadSessions();
      this.post({ type: 'state', state: this.snapshot() });
    } catch (error) {
      this.fail(error);
    }
  }

  private async pinTab(id: string, pinned: boolean): Promise<void> {
    const tabs = tabsOf(this.tabsState, this.activeDirectory);
    if (!tabs.open.includes(id)) {
      return;
    }
    this.writeTabs(this.activeDirectory, setPinned(tabs, id, pinned));
    await this.persistTabs();
    this.post({ type: 'state', state: this.snapshot() });
  }

  /** Moves a session to the archive and closes its tab; a running turn stops first. */
  private async archiveSession(id: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      if (this.tabRunning.has(id) || (this.session?.id === id && this.busy)) {
        await client.interrupt(id);
      }
      await client.updateSession(id, { archived: true });
      this.tabRunning.delete(id);
      this.forgetCompaction(id);
      await this.loadSessions();
      await this.dropTab(id);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Copies a session into a new tab; the original session is left untouched. */
  private async forkSession(id: string): Promise<void> {
    const client = this.client;
    if (!client || this.forking.has(id)) {
      return;
    }
    this.forking.add(id);
    try {
      const fork = await client.forkSession(id);
      this.transcripts.delete(fork.id);
      this.pendingDeltas.delete(fork.id);
      this.tailRequests.delete(fork.id);
      this.openTab(fork);
      this.session = fork;
      this.busy = fork.running;
      await this.persistSession(fork.id);
      await this.persistTabs();
      await this.loadSessions();
      await this.loadMessages();
      this.post({ type: 'state', state: this.snapshot() });
    } catch (error) {
      this.fail(error);
    } finally {
      this.forking.delete(id);
    }
  }


  /**
   * A palette command can open the panel and ask for a connection while the
   * webview `ready` frame is doing the same, so concurrent calls share one
   * attempt instead of opening two event streams.
   */
  private async connectAndLoad(): Promise<void> {
    const running = this.connecting;
    if (running) {
      await running;
      return;
    }
    const attempt = this.doConnectAndLoad();
    this.connecting = attempt;
    try {
      await attempt;
    } finally {
      if (this.connecting === attempt) {
        this.connecting = undefined;
      }
    }
  }

  private async doConnectAndLoad(): Promise<void> {
    this.loading = true;
    void this.pruneAttachments();
    try {
      this.endpoint = await connect();
      this.client = new OpenCodeClient(this.endpoint);
      this.lastError = undefined;
      this.stopStream?.();
      this.stopStream = this.client.subscribe(
        (event) => this.onEvent(event),
        () => this.onStreamReconnect(),
      );

      await Promise.all([
        this.loadModels(),
        this.loadAgents(),
        this.loadCommands(),
        this.loadSkills(),
        this.loadDefaultModel(),
        this.loadSessions(),
      ]);

      const directory = this.activeDirectory;
      const storedTabs = await this.restoreTabs(directory);
      if (this.activeDirectory !== directory) {
        return;
      }
      const preferred = this.preferredSession(storedTabs);
      this.session = preferred;
      this.busy =
        this.session !== undefined &&
        (this.tabRunning.has(this.session.id) || this.session.running);
      await this.loadMessages();
      await this.persistTabs();
      await this.loadPermissions();
      await this.loadQueue();
      this.post({ type: 'state', state: this.snapshot() });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.client = undefined;
      this.post({ type: 'state', state: this.snapshot() });
    } finally {
      this.loading = false;
    }
    // A capture that finished while the panel was loading waits until `state`
    // has gone out, so the chip lands in the chat the panel just restored.
    this.flushPendingAttachments();
  }

  /**
   * Picks the session the panel opens for the active folder: the remembered tab
   * first, then the last session used in that folder, then the newest one.
   */
  private preferredSession(stored: FolderTabs | undefined): SessionSummary | undefined {
    if (stored) {
      const activeID =
        stored.active && stored.open.includes(stored.active) ? stored.active : stored.open[0];
      if (!activeID) {
        return undefined;
      }
      return this.sessions.find((entry) => entry.id === activeID) ?? this.tabSessions.get(activeID);
    }
    const remembered = selectionOf(this.selection, this.activeDirectory);
    const preferred =
      (remembered ? this.sessions.find((entry) => entry.id === remembered) : undefined) ??
      this.sessions[0];
    if (preferred) {
      this.openTab(preferred);
    }
    return preferred;
  }

  /**
   * Switches the panel to another workspace folder: the tabs of the old folder
   * stay persisted, the new folder reloads its own sessions, models, agents,
   * commands, skills and file search.
   */
  private async selectDirectory(directory: string, options?: { pinned?: boolean }): Promise<void> {
    if (options?.pinned) {
      this.directoryPinned = true;
    }
    // The request wins over the current folder here: this method is reached from
    // a manual picker, from the editor follow rule and from folder removal, and
    // every caller has already applied its own pin and busy guards. An unknown
    // directory still falls back to the current folder.
    const target = pickDirectory({
      folders: this.folderDirectories(),
      current: this.activeDirectory,
      requested: directory,
      pinned: false,
      busy: false,
      fallback: os.homedir(),
    });
    await this.persistTabs();
    if (target === this.activeDirectory) {
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    this.activeDirectory = target;
    this.session = undefined;
    this.busy = false;
    this.sessions = [];
    this.selection = { ...this.selection, activeDirectory: target };
    if (!this.client) {
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    await Promise.all([
      this.loadModels(),
      this.loadAgents(),
      this.loadCommands(),
      this.loadSkills(),
      this.loadDefaultModel(),
      this.loadSessions(),
    ]);
    if (this.activeDirectory !== target) {
      return;
    }
    const storedTabs = await this.restoreTabs(target);
    if (this.activeDirectory !== target) {
      return;
    }
    this.session = this.preferredSession(storedTabs);
    this.busy =
      this.session !== undefined &&
      (this.tabRunning.has(this.session.id) || this.session.running);
    if (this.session) {
      await this.persistSession(this.session.id);
    }
    await this.loadMessages();
    await this.loadPermissions();
    await this.loadQueue();
    if (this.activeDirectory !== target) {
      return;
    }
    await this.persistTabs();
    this.post({ type: 'state', state: this.snapshot() });
    // A capture that finished during the folder switch waited for this state.
    this.flushPendingAttachments();
    // The new chat has its own tray; offer the automatic chip there.
    this.autoContextUri = undefined;
    void this.syncAutoContext();
  }

  private async onFoldersChanged(): Promise<void> {
    this.refreshFolders();
    const next = pickDirectory({
      folders: this.folderDirectories(),
      current: this.activeDirectory,
      pinned: this.directoryPinned,
      busy: this.busy,
      fallback: os.homedir(),
    });
    await this.selectDirectory(next, { pinned: this.directoryPinned });
  }

  /** Follows the active editor until the user picks a folder by hand. */
  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    const uri = editor?.document.uri;
    if (!uri) {
      void this.syncAutoContext(undefined);
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      // Outside every folder there is no automatic chip, but the old one goes.
      void this.syncAutoContext(editor);
      return;
    }
    const requested = folder.uri.fsPath;
    if (requested === this.activeDirectory) {
      void this.syncAutoContext(editor);
      return;
    }
    const next = pickDirectory({
      folders: this.folderDirectories(),
      current: this.activeDirectory,
      requested,
      pinned: this.directoryPinned,
      busy: this.busy,
      fallback: os.homedir(),
    });
    if (next !== this.activeDirectory) {
      // `selectDirectory` offers the chip once the new chat is active.
      void this.selectDirectory(next);
      return;
    }
    void this.syncAutoContext(editor);
  }

  private async loadModels(directory = this.activeDirectory): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const models = await client.listModels(directory);
      if (this.activeDirectory === directory) {
        this.models = models;
      }
    } catch {
      if (this.activeDirectory === directory) {
        this.models = [];
      }
    }
  }

  private async loadAgents(directory = this.activeDirectory): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const agents = await client.listAgents(directory);
      if (this.activeDirectory === directory) {
        this.agents = agents;
      }
    } catch {
      if (this.activeDirectory === directory) {
        this.agents = [];
      }
    }
  }

  private async loadCommands(directory = this.activeDirectory): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const commands = await client.listCommands(directory);
      if (this.activeDirectory === directory) {
        this.commands = commands;
      }
    } catch {
      if (this.activeDirectory === directory) {
        this.commands = [];
      }
    }
  }

  private async loadSkills(directory = this.activeDirectory): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const skills = await client.listSkills(directory);
      if (this.activeDirectory === directory) {
        this.skills = skills;
      }
    } catch {
      if (this.activeDirectory === directory) {
        this.skills = [];
      }
    }
  }

  private async loadDefaultModel(directory = this.activeDirectory): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const model = await client.getDefaultModel(directory);
      if (this.activeDirectory === directory) {
        this.defaultModel = model;
      }
    } catch {
      if (this.activeDirectory === directory) {
        this.defaultModel = undefined;
      }
    }
  }

  private async loadSessions(search?: string, directory = this.activeDirectory): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    // A commit or clear that lands while the list is in flight wins over it.
    const revertEpoch = this.revertEpoch;
    try {
      const sessions = await client.listSessions(directory, search);
      if (this.activeDirectory !== directory) {
        return;
      }
      this.sessions = sessions;
      for (const session of sessions) {
        if (this.hasTab(session.id)) {
          this.rememberTab(session, revertEpoch);
        }
      }
    } catch (error) {
      if (this.activeDirectory === directory) {
        this.fail(error);
      }
    }
  }

  private resetCursors(sessionID: string | undefined): void {
    if (sessionID) {
      const entry = this.transcripts.get(sessionID);
      if (entry) {
        entry.olderCursor = undefined;
        entry.newerCursor = undefined;
        entry.hasMoreOlder = false;
      }
      // Invalidate in-flight tail merges of this session only.
      this.tailRequests.set(sessionID, (this.tailRequests.get(sessionID) ?? 0) + 1);
    }
    this.loadingOlder = false;
  }

  private async loadMessages(): Promise<void> {
    const client = this.client;
    const session = this.session;
    if (!client || !session) {
      return;
    }
    this.resetCursors(session.id);
    try {
      const page = await client.listMessages(session.id, {
        limit: MESSAGE_PAGE_SIZE,
        order: 'desc',
      });
      if (this.session?.id !== session.id) {
        return;
      }
      const entry = this.transcriptFor(session.id);
      entry.messages = mapMessages(toAscending(page.messages), this.folderDirectories());
      // A desc page returns `next` for the older page and `previous` for the
      // newer one; the client cannot combine `order` with `cursor`.
      entry.olderCursor = page.cursor?.next;
      entry.newerCursor = page.cursor?.previous;
      entry.hasMoreOlder = page.messages.length > 0 && Boolean(entry.olderCursor);
      // Server text is authoritative: buffered stream chunks are redundant now.
      this.pendingDeltas.delete(session.id);
      this.trackUsage(session.id, page.messages);
      // The send path reloads messages while the turn is running; the first
      // user message after the send baseline is the start of this turn even
      // when `execution.started` arrived before the page landed.
      if (this.busy && this.session?.id === session.id) {
        this.captureTurnStart(session.id, entry.messages);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private async loadOlder(): Promise<void> {
    const client = this.client;
    const session = this.session;
    const cursor = session ? this.transcripts.get(session.id)?.olderCursor : undefined;
    if (!client || !session || !cursor || this.loadingOlder) {
      return;
    }
    this.loadingOlder = true;
    this.post({ type: 'state', state: this.snapshot() });
    try {
      const page = await client.listMessages(session.id, {
        limit: MESSAGE_PAGE_SIZE,
        cursor,
      });
      if (this.session?.id !== session.id) {
        return;
      }
      const entry = this.transcriptFor(session.id);
      entry.messages = prependMessages(entry.messages, mapMessages(toAscending(page.messages), this.folderDirectories()));
      entry.olderCursor = page.cursor?.next;
      entry.hasMoreOlder = page.messages.length > 0 && Boolean(entry.olderCursor);
      this.post({ type: 'messages', messages: entry.messages });
    } catch (error) {
      this.fail(error);
    } finally {
      this.loadingOlder = false;
      if (this.session?.id === session.id) {
        this.post({ type: 'state', state: this.snapshot() });
      }
    }
  }

  private nextTailRequest(sessionID: string): number {
    const requestID = (this.tailRequests.get(sessionID) ?? 0) + 1;
    this.tailRequests.set(sessionID, requestID);
    return requestID;
  }

  /**
   * Merges the newest messages of one session into its cached transcript.
   * Never re-reads the whole conversation: older pages, cursors and the scroll
   * position stay intact.
   */
  private async refreshTail(sessionID = this.session?.id): Promise<boolean> {
    const client = this.client;
    if (!client || !sessionID) {
      return false;
    }
    const requestID = this.nextTailRequest(sessionID);
    try {
      const page = await client.listMessages(sessionID, {
        limit: MESSAGE_TAIL_SIZE,
        order: 'desc',
      });
      if (this.tailRequests.get(sessionID) !== requestID) {
        return false;
      }
      const entry = this.transcriptFor(sessionID);
      entry.messages = mergeTail(entry.messages, mapMessages(toAscending(page.messages), this.folderDirectories()));
      entry.newerCursor = page.cursor?.previous;
      if (entry.olderCursor === undefined) {
        entry.olderCursor = page.cursor?.next;
      }
      if (entry.messages.length > 0 && entry.olderCursor !== undefined) {
        entry.hasMoreOlder = true;
      }
      // The merged page already carries the text of the chunks it covers; the
      // remaining chunks were produced after that server snapshot and stay
      // buffered for activation.
      const merged = new Set(page.messages.map((message) => message.id));
      const buffered = this.pendingDeltas.get(sessionID);
      if (buffered) {
        const remaining = buffered.filter((chunk) => !merged.has(chunk.messageID));
        if (remaining.length > 0) {
          this.pendingDeltas.set(sessionID, remaining);
        } else {
          this.pendingDeltas.delete(sessionID);
        }
      }
      this.tabStale.delete(sessionID);
      this.trackUsage(sessionID, page.messages);
      // While the turn runs, the newest user message of the transcript is the
      // message the turn is diffed against.
      if (this.tabRunning.has(sessionID) || (sessionID === this.session?.id && this.busy)) {
        this.captureTurnStart(sessionID, entry.messages);
      }
      return true;
    } catch (error) {
      if (this.tailRequests.get(sessionID) === requestID) {
        if (sessionID === this.session?.id) {
          this.fail(error);
        } else if (this.hasTab(sessionID)) {
          this.tabStale.add(sessionID);
        }
      }
      return false;
    }
  }

  /** Summary of the newest computed turn of a session, or null. */
  private latestTurnSummary(sessionID = this.session?.id): TurnDiffSummary | null {
    if (!sessionID) {
      return null;
    }
    const key = this.latestTurnDiff.get(sessionID);
    if (!key) {
      return null;
    }
    return this.turnDiffs.get(key)?.summary ?? null;
  }

  /**
   * Records the first user message of the current turn. A steering message
   * that arrives while the turn runs must not replace the start.
   */
  private captureTurnStart(sessionID: string, messages: readonly UiMessage[]): void {
    const baseline = this.turnBaselines.get(sessionID);
    const start =
      baseline === undefined
        ? lastUserMessageID(messages)
        : firstUserMessageAfter(messages, baseline);
    if (start) {
      this.turnStarts.set(sessionID, start);
    }
  }

  /**
   * A finished turn is reviewable when it added a user message. A slash
   * command starts a turn without one, so its diff would repeat the previous
   * user message.
   */
  private turnIsReviewable(sessionID: string): boolean {
    const baseline = this.turnBaselines.get(sessionID);
    if (baseline === undefined) {
      return true;
    }
    const latest = lastUserMessageID(this.transcripts.get(sessionID)?.messages);
    return (latest ?? null) !== baseline;
  }

  /**
   * Fetches the diff of the turn that just ended and caches its totals. The
   * patches are only fetched by the panel, never stored in the chat snapshot.
   */
  private async computeTurnDiff(sessionID: string): Promise<void> {
    const client = this.client;
    if (!client || this.turnDiffPending.has(sessionID)) {
      return;
    }
    // A new turn already started: its diff does not exist yet.
    if (this.tabRunning.has(sessionID) || (this.session?.id === sessionID && this.busy)) {
      return;
    }
    if (!this.turnIsReviewable(sessionID)) {
      return;
    }
    const messages = this.transcripts.get(sessionID)?.messages ?? [];
    const baseline = this.turnBaselines.get(sessionID);
    // The turn starts at the first user message after the send baseline, not
    // at a steering message that arrived while the turn was already running.
    const start =
      (baseline === undefined
        ? this.turnStarts.get(sessionID)
        : firstUserMessageAfter(messages, baseline)) ??
      this.turnStarts.get(sessionID) ??
      turnRefs(messages).at(-1)?.id;
    if (!start) {
      return;
    }
    const key = diffCacheKey(sessionID, start);
    if (this.turnDiffs.has(key)) {
      this.latestTurnDiff.set(sessionID, key);
      return;
    }
    this.turnDiffPending.add(sessionID);
    try {
      const files = await client.sessionDiff(sessionID, {
        from: start,
        context: DIFF_CONTEXT,
      });
      const summary = summarizeTurnDiff(files, sessionID, start);
      this.turnDiffs.set(key, { summary, at: Date.now() });
      this.latestTurnDiff.set(sessionID, key);
      this.evictTurnDiffs();
    } catch (error) {
      // The card of a failed request must not describe the previous turn.
      this.latestTurnDiff.delete(sessionID);
      if (sessionID === this.session?.id) {
        this.fail(error);
      }
    } finally {
      this.turnDiffPending.delete(sessionID);
    }
  }

  private evictTurnDiffs(): void {
    if (this.turnDiffs.size <= TURN_DIFF_CACHE_LIMIT) {
      return;
    }
    const keep = new Set(this.latestTurnDiff.values());
    const candidates = [...this.turnDiffs.entries()]
      .filter(([key]) => !keep.has(key))
      .sort((left, right) => left[1].at - right[1].at);
    let excess = this.turnDiffs.size - TURN_DIFF_CACHE_LIMIT;
    for (const [key] of candidates) {
      if (excess <= 0) {
        break;
      }
      this.turnDiffs.delete(key);
      excess -= 1;
    }
  }

  /** Drops every cached total of a session; a revert invalidates all of them. */
  private invalidateTurnDiffs(sessionID: string): void {
    this.latestTurnDiff.delete(sessionID);
    const prefix = `${sessionID}\u0000`;
    for (const key of [...this.turnDiffs.keys()]) {
      if (key.startsWith(prefix)) {
        this.turnDiffs.delete(key);
      }
    }
  }

  /**
   * Why a revert action cannot start. The server rejects a stage while the turn
   * runs (409), and a second stage would silently move the existing one.
   */
  private revertBlocked(sessionID: string): string | undefined {
    if (!this.client) {
      return 'OpenCode is not connected.';
    }
    if (this.tabRunning.has(sessionID) || (sessionID === this.session?.id && this.busy)) {
      return 'Stop the turn first';
    }
    if (this.revertPending.has(sessionID)) {
      return 'Wait for the current revert to finish';
    }
    return undefined;
  }

  /**
   * Why sending or compacting cannot start. Both would make the server commit
   * the staged revert, and the stage may already be restoring files.
   */
  private revertInputBlock(sessionID: string): string | undefined {
    if (this.revertPending.has(sessionID)) {
      return 'Wait for the current revert to finish';
    }
    if (this.reverts.has(sessionID)) {
      return 'Keep or undo the revert first';
    }
    return undefined;
  }

  /** Pending requests of a session, without the ones answered anywhere. */
  private pendingPermissions(sessionID: string): PermissionRequest[] {
    return filterResolved(this.permissions.get(sessionID) ?? [], this.permissionResolved);
  }

  private setPendingPermissions(
    sessionID: string,
    list: readonly PermissionRequest[],
  ): void {
    if (list.length === 0) {
      this.permissions.delete(sessionID);
      return;
    }
    this.permissions.set(sessionID, [...list]);
  }

  private forgetPermissions(sessionID: string): void {
    for (const request of this.permissions.get(sessionID) ?? []) {
      this.permissionSending.delete(request.id);
    }
    this.permissions.delete(sessionID);
  }

  /** Drops a request answered here or in another client. */
  private resolvePermission(sessionID: string, requestID: string): void {
    rememberResolved(this.permissionResolved, requestID);
    this.setPendingPermissions(
      sessionID,
      removePermission(this.permissions.get(sessionID) ?? [], requestID),
    );
  }

  /**
   * Replaces the pending list of a session with the server one. The stream is
   * the fast path, but a request that expired, was answered in the terminal or
   * arrived while the tab was hidden only shows up here.
   *
   * The read is not allowed to erase a card that arrived after it started: the
   * ids known before the request are captured, and anything newer survives the
   * merge.
   */
  private async loadPermissions(sessionID = this.session?.id): Promise<void> {
    const client = this.client;
    if (!client || !sessionID || !this.hasTab(sessionID)) {
      return;
    }
    const knownBefore = new Set(
      (this.permissions.get(sessionID) ?? []).map((request) => request.id),
    );
    try {
      const list = await client.listSessionPermissions(sessionID);
      const server = filterResolved(list, this.permissionResolved);
      this.setPendingPermissions(
        sessionID,
        mergePermissionList(server, this.pendingPermissions(sessionID), knownBefore),
      );
      this.post({ type: 'state', state: this.snapshot() });
    } catch {
      // Keep the cards the stream reported; the next activation retries.
    }
  }

  /** Inbox rows of a session; the strip renders the visible one only. */
  private queueFor(sessionID: string): readonly QueueItem[] {
    return this.queues.get(sessionID) ?? [];
  }

  private setQueue(sessionID: string, list: readonly QueueItem[]): void {
    this.queueLoaded.add(sessionID);
    if (list.length === 0) {
      this.queues.delete(sessionID);
      return;
    }
    this.queues.set(sessionID, [...list]);
  }

  private setQueuePending(sessionID: string, inboxID: string, pending: boolean): void {
    let set = this.queuePending.get(sessionID);
    if (!pending) {
      set?.delete(inboxID);
      if (set && set.size === 0) {
        this.queuePending.delete(sessionID);
      }
      return;
    }
    if (!set) {
      set = new Set();
      this.queuePending.set(sessionID, set);
    }
    set.add(inboxID);
  }

  /** Every mutation of the mirror invalidates a list read that started before. */
  private bumpQueueEpoch(sessionID: string): number {
    const next = (this.queueRequests.get(sessionID) ?? 0) + 1;
    this.queueRequests.set(sessionID, next);
    return next;
  }

  /**
   * Replaces the queue of a session with the server list. Only the visible
   * session applies a response, and only when no inbox frame or local action
   * bumped the epoch since the read started: a slow list must not resurrect a
   * delivered row or undo a steer.
   */
  private async loadQueue(sessionID = this.session?.id): Promise<void> {
    const client = this.client;
    if (!client || !sessionID || !this.hasTab(sessionID)) {
      return;
    }
    const epoch = this.bumpQueueEpoch(sessionID);
    try {
      const list = await client.inbox(sessionID);
      const current = this.queueRequests.get(sessionID) ?? 0;
      if (!queueReadIsCurrent(epoch, current) || this.session?.id !== sessionID) {
        return;
      }
      this.setQueue(sessionID, list);
    } catch {
      // Keep the rows the stream reported; the next activation retries.
    }
  }

  /** A delivered or cancelled id is gone; the server no longer lists it. */
  private inboxGone(error: unknown): boolean {
    return (
      error instanceof OpenCodeHttpError && (error.status === 404 || error.status === 409)
    );
  }

  /** Sends a queued prompt now: `steer` wakes the running turn. */
  private async queueSteer(inboxID: string): Promise<void> {
    const client = this.client;
    const sessionID = this.session?.id;
    if (!client || !sessionID || inboxID.length === 0) {
      return;
    }
    const item = this.queueFor(sessionID).find((entry) => entry.id === inboxID);
    if (!item || item.type !== 'user') {
      return;
    }
    const blocked = this.revertInputBlock(sessionID);
    if (blocked) {
      // Steering a prompt would make the server commit the staged revert.
      this.postUi({ type: 'toast', text: blocked });
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    this.bumpQueueEpoch(sessionID);
    this.setQueuePending(sessionID, inboxID, true);
    this.setQueue(sessionID, withDelivery(this.queueFor(sessionID), inboxID, 'steer'));
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.inboxDelivery(sessionID, inboxID, 'steer');
    } catch (error) {
      await this.loadQueue(sessionID);
      if (this.inboxGone(error)) {
        this.postUi({ type: 'toast', text: 'Already delivered' });
      } else {
        this.fail(error);
      }
    } finally {
      this.setQueuePending(sessionID, inboxID, false);
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  /** Deletes a queued prompt; a delivered one answers 409 or 404. */
  private async queueCancel(inboxID: string): Promise<void> {
    const client = this.client;
    const sessionID = this.session?.id;
    if (!client || !sessionID || inboxID.length === 0) {
      return;
    }
    // A stale click after a tab switch must not delete another session's item.
    if (!this.queueFor(sessionID).some((entry) => entry.id === inboxID)) {
      return;
    }
    this.bumpQueueEpoch(sessionID);
    this.setQueuePending(sessionID, inboxID, true);
    this.setQueue(sessionID, withoutItem(this.queueFor(sessionID), inboxID));
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.inboxCancel(sessionID, inboxID);
    } catch (error) {
      await this.loadQueue(sessionID);
      if (!this.inboxGone(error)) {
        this.fail(error);
      }
    } finally {
      this.setQueuePending(sessionID, inboxID, false);
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  /**
   * Edits a queued prompt: the server has no text update, so the item is
   * cancelled and its text goes back into the composer. Attachments are not
   * part of the list and cannot be restored; the user resends them.
   */
  private async queueEdit(reply: SurfaceReply, inboxID: string): Promise<void> {
    const client = this.client;
    const sessionID = this.session?.id;
    if (!client || !sessionID || inboxID.length === 0) {
      return;
    }
    const item = this.queueFor(sessionID).find((entry) => entry.id === inboxID);
    if (!item || item.type !== 'user') {
      return;
    }
    if (!canEditQueueItem(item)) {
      // An attachment-only prompt has no text to put back; cancelling it here
      // would look like a silent delete.
      this.postUi({ type: 'toast', text: 'Nothing to edit' });
      return;
    }
    this.bumpQueueEpoch(sessionID);
    this.setQueuePending(sessionID, inboxID, true);
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.inboxCancel(sessionID, inboxID);
      this.setQueue(sessionID, withoutItem(this.queueFor(sessionID), inboxID));
      reply.send({ type: 'queueEdit', text: item.text ?? '' });
    } catch (error) {
      await this.loadQueue(sessionID);
      if (this.inboxGone(error)) {
        // The prompt already ran; putting its text back would duplicate it.
        this.postUi({ type: 'toast', text: 'Already delivered' });
      } else {
        this.fail(error);
      }
    } finally {
      this.setQueuePending(sessionID, inboxID, false);
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  /**
   * Answers a request and waits for the server: the card is only dropped when
   * the reply landed, so a failed request leaves the buttons usable.
   */
  private async replyPermission(
    sessionID: string,
    requestID: string,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void> {
    const client = this.client;
    if (!client || sessionID.length === 0 || requestID.length === 0) {
      return;
    }
    if (this.permissionSending.has(requestID)) {
      return;
    }
    const request = this.pendingPermissions(sessionID).find((entry) => entry.id === requestID);
    if (!request) {
      return;
    }
    if (decision === 'always' && !canAlwaysAllow(request)) {
      // The webview disables the button, but the frame is not trusted: an
      // empty rule must not be created by a hand-made reply.
      this.postUi({ type: 'toast', text: 'This request has no rule to save' });
      return;
    }
    this.permissionSending.add(requestID);
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.replyPermission(
        sessionID,
        requestID,
        decision,
        decision === 'reject' ? message : undefined,
      );
      this.resolvePermission(sessionID, requestID);
      if (decision === 'always') {
        this.postUi({ type: 'toast', text: 'Saved for this project' });
        void this.loadSavedPermissions();
      }
    } catch (error) {
      if (error instanceof OpenCodeHttpError && error.status === 404) {
        // The request expired or another client answered it first.
        this.resolvePermission(sessionID, requestID);
        this.postUi({ type: 'toast', text: 'This request has expired' });
      } else {
        // The reply did not land: keep the card so the user can retry.
        this.fail(error);
      }
    } finally {
      this.permissionSending.delete(requestID);
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  /**
   * Answers a read-only tool request on its own when the setting is on. Only
   * `once` is ever sent: an automatic answer never creates a saved rule, and
   * the setting is not applied retroactively to requests already on screen.
   */
  private maybeAutoApprove(request: PermissionRequest): void {
    if (!this.settings.permissionsAutoApproveSafe || !isAutoApprovable(request)) {
      return;
    }
    const client = this.client;
    if (!client || this.permissionSending.has(request.id)) {
      return;
    }
    void (async () => {
      this.permissionSending.add(request.id);
      this.post({ type: 'state', state: this.snapshot() });
      try {
        await client.replyPermission(request.sessionID, request.id, 'once');
        this.resolvePermission(request.sessionID, request.id);
        const resource = request.resources[0] ?? '';
        const shown = resource.length > 120 ? `${resource.slice(0, 119)}…` : resource;
        this.pushNotice(request.sessionID, {
          id: `permission-${request.id}`,
          kind: 'permission',
          at: Date.now(),
          text:
            shown.length > 0
              ? `Auto-approved ${request.action} ${shown}`
              : `Auto-approved ${request.action}`,
        });
      } catch (error) {
        if (error instanceof OpenCodeHttpError && error.status === 404) {
          this.resolvePermission(request.sessionID, request.id);
        } else {
          // The card stays: an automatic answer that failed is the user's call.
          this.fail(error);
        }
      } finally {
        this.permissionSending.delete(request.id);
        this.post({ type: 'state', state: this.snapshot() });
      }
    })();
  }

  /** Saved rules of the active project, shown in Settings. */
  private async loadSavedPermissions(): Promise<void> {
    const client = this.client;
    const projectID = this.session?.projectID;
    if (!projectID) {
      // The endpoint without a project returns every project's rules, so the
      // panel asks for nothing until there is a session to scope the list to.
      this.savedPermissions = [];
      this.savedPermissionsError = undefined;
      this.savedPermissionsHint = this.session
        ? 'This session has no project rules'
        : 'Open a session to see this project\'s rules';
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    if (!client) {
      this.savedPermissions = [];
      this.savedPermissionsError = undefined;
      this.savedPermissionsHint = 'OpenCode is not connected';
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    this.savedPermissionsHint = undefined;
    try {
      this.savedPermissions = await client.listSavedPermissions(projectID);
      this.savedPermissionsError = undefined;
    } catch (error) {
      // Keep the last known list: a failed read must not look like "no rules".
      this.savedPermissionsError = error instanceof Error ? error.message : String(error);
    }
    this.post({ type: 'state', state: this.snapshot() });
  }

  private async deleteSavedPermission(id: string): Promise<void> {
    const client = this.client;
    if (!client || id.length === 0) {
      return;
    }
    // The id comes from the webview: only a rule this panel loaded for the
    // active project may be deleted. A stale or hand-made frame is ignored.
    if (!this.savedPermissions.some((rule) => rule.id === id)) {
      return;
    }
    try {
      await client.deleteSavedPermission(id);
      this.savedPermissions = this.savedPermissions.filter((rule) => rule.id !== id);
      this.savedPermissionsError = undefined;
    } catch (error) {
      this.savedPermissionsError = error instanceof Error ? error.message : String(error);
    }
    this.post({ type: 'state', state: this.snapshot() });
  }

  /**
   * Confirmed Undo of the last turn. The stage already restores the files to
   * the state before it, so the boundary stays staged until the user keeps the
   * result or undoes the revert.
   */
  private async undoTurn(sessionID = this.session?.id): Promise<void> {
    const client = this.client;
    if (!client || !sessionID) {
      return;
    }
    // A staged revert already owns the files, and its stage cleared the turn
    // card: report the staged state before looking for a turn to undo.
    if (this.reverts.has(sessionID)) {
      this.postUi({ type: 'toast', text: 'Finish the staged revert first' });
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    const blocked = this.revertBlocked(sessionID);
    if (blocked) {
      this.postUi({ type: 'toast', text: blocked });
      return;
    }
    // A queued prompt would be delivered into the staged revert and make the
    // server commit it, so the queue has to be resolved before staging.
    if (this.queueFor(sessionID).length > 0) {
      this.postUi({ type: 'toast', text: 'Send or delete the queued messages first' });
      return;
    }
    const summary = this.latestTurnSummary(sessionID);
    if (!summary) {
      this.postUi({ type: 'toast', text: 'There is no turn to undo' });
      return;
    }
    this.revertPending.add(sessionID);
    this.post({ type: 'state', state: this.snapshot() });
    try {
      const revert = await client.revertStage(sessionID, summary.from);
      this.reverts.set(
        sessionID,
        revertSummary(revert, sessionID) ?? summarizeTurnDiff([], sessionID, summary.from),
      );
      // Any list or session read started before the stage has no revert in it;
      // it must neither drop this card nor restore an older one.
      this.revertEpoch += 1;
      // The files on disk belong to the previous turn now: the cached totals of
      // the reverted turn would describe a state that no longer exists.
      this.invalidateTurnDiffs(sessionID);
    } catch (error) {
      this.reportRevertFailure(error, sessionID, 'stage');
    } finally {
      this.revertPending.delete(sessionID);
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  /** Keeps the staged revert: the turn is dropped and the plaque stays. */
  private async keepRevert(sessionID = this.session?.id): Promise<void> {
    const client = this.client;
    const revert = sessionID ? this.reverts.get(sessionID) : undefined;
    if (!client || !sessionID || !revert) {
      return;
    }
    const blocked = this.revertBlocked(sessionID);
    if (blocked) {
      this.postUi({ type: 'toast', text: blocked });
      return;
    }
    this.revertPending.add(sessionID);
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.revertCommit(sessionID);
      this.reverts.delete(sessionID);
      this.revertEpoch += 1;
      this.forgetSessionRevert(sessionID);
      this.invalidateTurnDiffs(sessionID);
      // The turn that started here is gone: the next diff starts from the
      // following turn instead of the removed boundary.
      this.turnStarts.delete(sessionID);
      this.turnBaselines.delete(sessionID);
      const entry = this.transcripts.get(sessionID);
      if (entry) {
        // `mergeTail` never removes messages, so the cache is cut at the
        // boundary and the visible transcript is then re-read in full.
        entry.messages = [...truncateMessagesAt(entry.messages, revert.from)];
      }
      if (sessionID === this.session?.id) {
        await this.loadMessages();
      } else if (this.hasTab(sessionID)) {
        this.transcripts.delete(sessionID);
        this.tabStale.add(sessionID);
      }
      this.pushNotice(sessionID, {
        id: `revert-${revert.from}`,
        kind: 'revert',
        at: Date.now(),
        text: revertNoticeText(revert),
      });
    } catch (error) {
      this.reportRevertFailure(error, sessionID, 'commit');
    } finally {
      this.revertPending.delete(sessionID);
      this.post({ type: 'state', state: this.snapshot() });
      if (sessionID === this.session?.id) {
        this.post({ type: 'messages', messages: this.activeMessages() });
      }
    }
  }

  /** Drops the staged revert; the files go back to the end of the turn. */
  private async cancelRevert(sessionID = this.session?.id): Promise<void> {
    const client = this.client;
    if (!client || !sessionID || !this.reverts.has(sessionID)) {
      return;
    }
    const blocked = this.revertBlocked(sessionID);
    if (blocked) {
      this.postUi({ type: 'toast', text: blocked });
      return;
    }
    this.revertPending.add(sessionID);
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.revertClear(sessionID);
      this.reverts.delete(sessionID);
      this.revertEpoch += 1;
      this.forgetSessionRevert(sessionID);
      this.invalidateTurnDiffs(sessionID);
      // The turn is on disk again, so its card has to be measured again.
      await this.computeTurnDiff(sessionID);
    } catch (error) {
      this.reportRevertFailure(error, sessionID, 'clear');
    } finally {
      this.revertPending.delete(sessionID);
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  /**
   * Turns a failed revert request into a message the user can act on. The
   * staged card is only dropped when the server says it no longer exists.
   */
  private reportRevertFailure(
    error: unknown,
    sessionID: string,
    phase: 'stage' | 'commit' | 'clear',
  ): void {
    const status = error instanceof OpenCodeHttpError ? error.status : 0;
    if (status === 404) {
      this.reverts.delete(sessionID);
      this.revertEpoch += 1;
      this.forgetSessionRevert(sessionID);
      if (phase === 'stage') {
        this.latestTurnDiff.delete(sessionID);
      }
      // A stage answers 404 for an unknown message; commit and clear only for
      // an unknown session.
      this.postUi({
        type: 'toast',
        text:
          phase === 'stage'
            ? 'That turn is no longer available'
            : 'This session no longer exists',
      });
      return;
    }
    if (status === 409) {
      this.postUi({ type: 'toast', text: 'Stop the turn first' });
      return;
    }
    if (status === 0 || status >= 500) {
      if (phase === 'stage') {
        // The request may have reached the server and restored the files
        // without us hearing back, so the Undo card of that turn is not safe.
        this.invalidateTurnDiffs(sessionID);
      }
      this.postUi({
        type: 'toast',
        text: 'Files may be partially changed, check Source Control',
      });
      return;
    }
    this.fail(error);
  }

  /** Directory the diff paths of a session are relative to. */
  private sessionDirectory(sessionID: string): string {
    if (this.session?.id === sessionID && this.session.directory) {
      return this.session.directory;
    }
    return this.tabSessions.get(sessionID)?.directory ?? this.directory;
  }

  /** Opens the singleton diff panel on one turn of a session. */
  private async showTurnDiff(sessionID: string, from?: string): Promise<void> {
    if (this.session?.id !== sessionID && !this.hasTab(sessionID)) {
      return;
    }
    const messages =
      this.session?.id === sessionID
        ? this.activeMessages()
        : this.transcripts.get(sessionID)?.messages ?? [];
    const turns: TurnRef[] = turnRefs(messages);
    const requested = from && turns.some((turn) => turn.id === from) ? from : undefined;
    const start = requested ?? this.latestTurnSummary(sessionID)?.from ?? turns.at(-1)?.id;
    if (!start) {
      void vscode.window.showWarningMessage('This turn has no changes to review.');
      return;
    }
    const session = this.session?.id === sessionID ? this.session : this.tabSessions.get(sessionID);
    const init: TurnDiffInit = {
      sessionID,
      title: `Changes — ${session?.title || 'session'}`,
      directory: this.sessionDirectory(sessionID),
      turns,
      from: start,
    };
    this.diffPanelDirectory = init.directory;
    try {
      await this.diffPanel.show(init);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Could not open the changes panel: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Patches of one turn for the panel, capped before they cross the wire. */
  private async fetchTurnDiff(
    sessionID: string,
    request: TurnDiffFetchRequest,
  ): Promise<TurnDiffPayload> {
    const client = this.client;
    if (!client) {
      throw new Error('OpenCode is not connected.');
    }
    const files = await client.sessionDiff(sessionID, {
      from: request.from,
      context: DIFF_CONTEXT,
    });
    const tooLarge = patchBytes(files) > DIFF_MAX_BYTES;
    return {
      files: tooLarge ? files.map((file) => ({ ...file, patch: '' })) : files,
      truncated: tooLarge || files.some((file) => file.more === true),
      tooLarge,
    };
  }

  /** Opens a changed file at its first changed line. */
  private async openDiffFile(file: string, line: number): Promise<void> {
    const directory = this.diffPanelDirectory ?? this.directory;
    const target = resolveDiffPath(directory, file);
    if (!target) {
      void vscode.window.showWarningMessage(`Cannot open ${file}: it is outside the workspace.`);
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      const position = new vscode.Position(Math.max(0, Math.floor(line) - 1), 0);
      await vscode.window.showTextDocument(document, {
        selection: new vscode.Range(position, position),
        preview: true,
      });
    } catch {
      void vscode.window.showWarningMessage(`Cannot open ${file}: it may have been deleted.`);
    }
  }

  /**
   * Opens a transcript attachment at its line. The panel only sends what the
   * frame showed, so a `file:` URI wins and a relative path resolves against
   * the chat directory; anything outside the workspace or the attachments
   * folder is refused instead of being opened.
   */
  private async openPath(uri: string, value: string, line?: number): Promise<void> {
    const label = value.length > 0 ? value : uri;
    let target = value;
    if (uri.length > 0) {
      if (!/^file:/i.test(uri)) {
        void vscode.window.showWarningMessage(`Cannot open ${label}: only files can be opened.`);
        return;
      }
      try {
        target = vscode.Uri.parse(uri).fsPath;
      } catch {
        void vscode.window.showWarningMessage(`Cannot open ${label}: the path is not a file.`);
        return;
      }
    }
    const resolved = resolveOpenTarget(
      [...this.folderDirectories(), this.attachmentsDirectory()],
      this.directory,
      target,
      line,
    );
    if (!resolved) {
      void vscode.window.showWarningMessage(`Cannot open ${label}: it is outside the workspace.`);
      return;
    }
    const file = vscode.Uri.file(resolved.fsPath);
    try {
      if (BINARY_EXTENSIONS.includes(path.extname(resolved.fsPath).toLowerCase())) {
        await vscode.commands.executeCommand('vscode.open', file);
        return;
      }
      const document = await vscode.workspace.openTextDocument(file);
      const targetLine = Math.min(resolved.line, Math.max(1, document.lineCount));
      const position = new vscode.Position(targetLine - 1, 0);
      await vscode.window.showTextDocument(document, {
        selection: new vscode.Range(position, position),
        preview: true,
      });
    } catch {
      void vscode.window.showWarningMessage(`Cannot open ${label}: it may have been deleted.`);
    }
  }

  /**
   * A preview URI only works in the webview that minted it, and only for a file
   * the webview is allowed to serve: the attachments folder is a local resource
   * root, a workspace file is not, so the panel falls back to a file chip there.
   */
  private previewUri(webview: vscode.Webview, uri: string): string | undefined {
    if (!/^file:/i.test(uri)) {
      return undefined;
    }
    let fsPath: string;
    try {
      fsPath = vscode.Uri.parse(uri).fsPath;
    } catch {
      return undefined;
    }
    const root = path.resolve(this.attachmentsDirectory());
    const target = path.resolve(fsPath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      return undefined;
    }
    return webview.asWebviewUri(vscode.Uri.file(target)).toString();
  }

  private usageState(sessionID: string): SessionUsageState {
    let state = this.usageBySession.get(sessionID);
    if (!state) {
      state = { used: null, compactedAt: this.compactionTimes[sessionID] };
      this.usageBySession.set(sessionID, state);
    }
    return state;
  }

  private sessionModel(sessionID: string): ModelSelection | undefined {
    if (this.session?.id === sessionID) {
      return this.session.model;
    }
    return this.tabSessions.get(sessionID)?.model;
  }

  private contextLimitOf(sessionID: string): number | undefined {
    return contextLimit(this.models, this.sessionModel(sessionID), this.defaultModel);
  }

  private usageLevelOf(sessionID: string, used: number | null): UsageLevel {
    return usageLevel(
      used,
      this.contextLimitOf(sessionID),
      this.settings.contextWarnPercent,
      this.settings.contextCompactPercent,
    );
  }

  /**
   * Recomputes the context size of one session from a server message page and
   * fires the automatic compaction when the episode crosses the threshold.
   * Never called from `loadOlder`: an older page cannot change the newest turn.
   */
  private trackUsage(sessionID: string, messages: readonly RawMessage[]): void {
    const state = this.usageState(sessionID);
    const usage = usageAfterCompaction(toAscending(messages), state.compactedAt);
    if (usage) {
      const wasCompacted = state.compactedAt !== undefined;
      state.used = usage.used;
      state.compactedAt = undefined;
      if (wasCompacted) {
        // A newer completed turn measured the compacted context again.
        this.forgetCompaction(sessionID);
      }
    } else {
      // After a compaction only a newer completed turn can restore the number.
      state.used = null;
    }
    const level = this.usageLevelOf(sessionID, state.used);
    if (level !== 'compact' && state.compactedAt === undefined) {
      this.autoCompactSpent.delete(sessionID);
    }
    this.maybeAutoCompact(sessionID, level);
  }

  private maybeAutoCompact(sessionID: string, level: UsageLevel): void {
    // A compaction prompt during a staged or in-flight revert would silently
    // commit it, or race the restore the stage is already applying.
    if (this.revertPending.has(sessionID) || this.reverts.has(sessionID)) {
      return;
    }
    const last = this.lastAutoCompactAt.get(sessionID) ?? 0;
    if (
      !shouldAutoCompact({
        level,
        active: sessionID === this.session?.id,
        busy: this.busy,
        compacting: this.compacting.has(sessionID),
        spent: this.autoCompactSpent.has(sessionID),
        sinceLastMs: Date.now() - last,
        cooldownMs: AUTO_COMPACT_COOLDOWN_MS,
      })
    ) {
      return;
    }
    // One automatic pass per high-usage episode: a session first seen above
    // the threshold still gets its compaction, but never a second one until
    // `used` drops below it.
    this.autoCompactSpent.add(sessionID);
    this.lastAutoCompactAt.set(sessionID, Date.now());
    void this.requestCompact();
  }

  /** Sends one compaction request for the visible session. */
  private async requestCompact(): Promise<void> {
    const client = this.client;
    const session = this.session;
    if (!client || !session || this.busy || this.compacting.has(session.id)) {
      return;
    }
    if (this.reverts.has(session.id) || this.revertPending.has(session.id)) {
      // The server would commit the staged revert before compacting.
      this.postUi({
        type: 'toast',
        text: this.revertInputBlock(session.id) ?? 'Keep or undo the revert first',
      });
      return;
    }
    // The server identifies the durable compaction request by a message id.
    const requestID = `msg_${randomUUID()}`;
    this.compacting.add(session.id);
    this.autoCompactSpent.add(session.id);
    this.armCompactionTimeout(session.id);
    this.post({ type: 'state', state: this.snapshot() });
    try {
      await client.compact(session.id, requestID);
    } catch (error) {
      this.finishCompaction(session.id);
      this.lastAutoCompactAt.set(session.id, Date.now());
      this.autoCompactSpent.delete(session.id);
      this.post({ type: 'state', state: this.snapshot() });
      this.fail(error);
    }
  }

  private armCompactionTimeout(sessionID: string): void {
    const pending = this.compactionTimers.get(sessionID);
    if (pending) {
      clearTimeout(pending);
    }
    const timer = setTimeout(() => {
      this.compactionTimers.delete(sessionID);
      if (!this.compacting.has(sessionID)) {
        return;
      }
      // The stream never reported the end: never leave the composer locked.
      this.finishCompaction(sessionID);
      this.post({ type: 'state', state: this.snapshot() });
      this.postUi({ type: 'toast', text: 'Compaction did not report back' });
    }, AUTO_COMPACT_TIMEOUT_MS);
    this.compactionTimers.set(sessionID, timer);
  }

  private finishCompaction(sessionID: string): void {
    this.compacting.delete(sessionID);
    const timer = this.compactionTimers.get(sessionID);
    if (timer) {
      clearTimeout(timer);
      this.compactionTimers.delete(sessionID);
    }
  }

  private forgetCompaction(sessionID: string): void {
    if (this.compactionTimes[sessionID] === undefined) {
      return;
    }
    delete this.compactionTimes[sessionID];
    void this.persistCompactions();
  }

  private async persistCompactions(): Promise<void> {
    const value = Object.keys(this.compactionTimes).length > 0 ? this.compactionTimes : undefined;
    await this.context.workspaceState.update(COMPACTIONS_KEY, value);
  }

  /**
   * Stable identity of one compaction occurrence. The id or time from the
   * event wins; the summary text keeps a replayed frame from adding a second
   * plaque.
   */
  private compactionKey(
    sessionID: string,
    data: Record<string, unknown> | undefined,
    text: string,
  ): string {
    const explicit =
      typeof data?.id === 'string'
        ? data.id
        : typeof data?.inputID === 'string'
          ? data.inputID
          : undefined;
    if (explicit) {
      return explicit;
    }
    const reason = typeof data?.reason === 'string' ? data.reason : 'manual';
    const time = eventTimestamp(data?.time);
    if (time !== undefined) {
      return `${sessionID}:${reason}:${time}`;
    }
    // The summary text is identical on a replayed frame and differs between
    // compactions of the same session.
    return `${sessionID}:${reason}:${text}`;
  }

  private applyUsageTotals(
    sessionID: string | undefined,
    data: Record<string, unknown> | undefined,
  ): void {
    if (!sessionID || !data) {
      return;
    }
    const state = this.usageState(sessionID);
    const cost = finiteOptionalNumber(data.cost);
    const tokens =
      data.tokens && typeof data.tokens === 'object'
        ? readTokens(data.tokens as RawTokenCounts)
        : undefined;
    if (cost !== undefined) {
      state.cost = cost;
    }
    if (tokens) {
      state.tokens = tokens;
    }
    if (this.session?.id === sessionID) {
      this.session = {
        ...this.session,
        cost: cost ?? this.session.cost,
        tokens: tokens ?? this.session.tokens,
      };
    }
  }

  private pushNotice(sessionID: string, notice: UiNoticeState): void {
    const current = this.notices.get(sessionID) ?? [];
    // A reconnected stream may replay the same ended frame.
    if (current.some((entry) => entry.id === notice.id)) {
      return;
    }
    this.notices.set(sessionID, [...current, notice].slice(-NOTICE_LIMIT));
  }

  private usageSnapshot(): Record<string, unknown> {
    const id = this.session?.id;
    const state = id ? this.usageBySession.get(id) : undefined;
    const used = state?.used ?? null;
    const limit = id ? this.contextLimitOf(id) : undefined;
    const compactedAt = state?.compactedAt ?? (id ? this.compactionTimes[id] : undefined);
    return {
      used,
      limit,
      percent: usagePercent(used, limit),
      level: id ? this.usageLevelOf(id, used) : 'unknown',
      compacting: id ? this.compacting.has(id) : false,
      compacted: compactedAt !== undefined,
      tokens: this.session?.tokens ?? state?.tokens,
      cost: this.session?.cost ?? state?.cost,
      lastCompaction: state?.lastCompaction,
    };
  }

  /**
   * The event stream came back after a drop. Only the visible session is
   * re-read; every other tab keeps its cache and is marked stale until the
   * user opens it.
   */
  private onStreamReconnect(): void {
    if (!this.client) {
      return;
    }
    const activeID = this.session?.id;
    for (const id of this.allTabIDs()) {
      if (id !== activeID) {
        this.tabStale.add(id);
      }
    }
    this.post({ type: 'state', state: this.snapshot() });
    if (!activeID) {
      return;
    }
    void (async () => {
      await this.refreshTail(activeID);
      await this.loadPermissions(activeID);
      await this.loadQueue(activeID);
      await this.loadSessions();
      if (this.session?.id !== activeID) {
        return;
      }
      const fresh = this.sessions.find((entry) => entry.id === activeID);
      if (fresh) {
        this.session = fresh;
      }
      this.post({ type: 'state', state: this.snapshot() });
    })();
  }

  private scheduleSessionTail(sessionID: string, computeDiff = false): void {
    if (!this.hasTab(sessionID)) {
      return;
    }
    const pending = this.sessionTailTimers.get(sessionID);
    if (pending) {
      clearTimeout(pending);
    }
    const timer = setTimeout(() => {
      this.sessionTailTimers.delete(sessionID);
      void this.refreshTail(sessionID).then(async () => {
        if (computeDiff) {
          if (this.turnIsReviewable(sessionID)) {
            this.latestTurnDiff.delete(sessionID);
          }
          await this.computeTurnDiff(sessionID);
        }
        if (this.session?.id === sessionID) {
          this.post({ type: 'messages', messages: this.activeMessages() });
          if (computeDiff) {
            this.post({ type: 'state', state: this.snapshot() });
          }
        }
      });
    }, REFRESH_DEBOUNCE_MS);
    this.sessionTailTimers.set(sessionID, timer);
  }

  /**
   * Fresh `Session.Info` for an explicit open. The caller decides which epoch
   * to apply it in; a failure returns `undefined` so a cached copy can stand in.
   */
  private async freshSession(sessionID: string): Promise<SessionSummary | undefined> {
    if (!this.client) {
      return undefined;
    }
    try {
      return await this.client.getSession(sessionID);
    } catch {
      return undefined;
    }
  }

  private async refreshSession(): Promise<void> {
    if (!this.client || !this.session) {
      return;
    }
    const revertEpoch = this.revertEpoch;
    try {
      this.session = await this.client.getSession(this.session.id);
      this.rememberTab(this.session, revertEpoch);
    } catch {
      // The next event or manual reload will reconcile the session.
    }
  }

  private scheduleSessionRefresh(delay = 350): void {
    if (this.sessionRefreshTimer) {
      clearTimeout(this.sessionRefreshTimer);
    }
    this.sessionRefreshTimer = setTimeout(() => {
      this.sessionRefreshTimer = undefined;
      void this.refreshSession().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
    }, delay);
  }

  private async ensureSession(): Promise<SessionSummary | undefined> {
    if (this.session) {
      return this.session;
    }
    await this.newSession();
    return this.session;
  }

  private computeDefaults(): DefaultSelection {
    const configured = parseModelSetting(this.settings.defaultModel);
    const configuredEntry = configured
      ? this.models.find(
          (entry) => entry.id === configured.id && entry.providerID === configured.providerID,
        )
      : undefined;
    const model = configuredEntry ? configured : this.defaultModel;
    const primary = this.agents.filter((agent) => !agent.hidden && agent.mode === 'primary');
    const mode =
      this.settings.defaultMode ||
      primary.find((agent) => agent.id === 'build')?.id ||
      primary[0]?.id;
    let effort = this.settings.defaultEffort || undefined;
    if (!effort && model && mode) {
      const agent = this.agents.find((entry) => entry.id === mode);
      if (
        agent?.model &&
        agent.model.id === model.id &&
        agent.model.providerID === model.providerID
      ) {
        effort = agent.model.variant;
      }
    }
    return { model, mode, effort };
  }

  private async applyNewSessionDefaults(session: SessionSummary): Promise<void> {
    if (!this.client) {
      return;
    }
    const explicitModel = this.settings.defaultModel.trim().length > 0;
    const explicitEffort = this.settings.defaultEffort.trim().length > 0;
    const explicitMode = this.settings.defaultMode.trim().length > 0;
    if (!explicitModel && !explicitEffort && !explicitMode) {
      return;
    }
    const defaults = this.computeDefaults();
    try {
      let next = session;
      if ((explicitModel || explicitEffort) && defaults.model) {
        const model = {
          id: defaults.model.id,
          providerID: defaults.model.providerID,
          variant: explicitEffort ? this.settings.defaultEffort : undefined,
        };
        await this.client.selectModel(session.id, model);
        next = { ...next, model };
      }
      if (explicitMode && defaults.mode) {
        await this.client.selectAgent(session.id, defaults.mode);
        next = { ...next, agent: defaults.mode };
      }
      if (this.session?.id === session.id) {
        this.session = next;
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private async applySetting(key: string, value: unknown): Promise<void> {
    if (!isSettingKey(key)) {
      return;
    }
    try {
      await writeSetting(key, value);
      this.settings = readSettings();
      this.post({ type: 'state', state: this.snapshot() });
      void this.syncAutoContext();
    } catch (error) {
      this.fail(error);
    }
  }

  private async applyModel(selection: ModelSelection): Promise<void> {
    if (!this.client) {
      return;
    }
    const session = await this.ensureSession();
    if (!session) {
      return;
    }
    try {
      await this.client.selectModel(session.id, selection);
      if (this.session?.id === session.id) {
        this.session = { ...this.session, model: selection };
      }
      this.post({ type: 'state', state: this.snapshot() });
      this.scheduleSessionRefresh();
    } catch (error) {
      this.fail(error);
    }
  }

  private async applyAgent(agent: string): Promise<void> {
    if (!this.client || agent.length === 0) {
      return;
    }
    const session = await this.ensureSession();
    if (!session) {
      return;
    }
    try {
      await this.client.selectAgent(session.id, agent);
      if (this.session?.id === session.id) {
        this.session = { ...this.session, agent };
      }
      this.post({ type: 'state', state: this.snapshot() });
      this.scheduleSessionRefresh();
    } catch (error) {
      this.fail(error);
    }
  }

  private matchCommand(text: string): { name: string; args: string } | undefined {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) {
      return undefined;
    }
    const name = match[1];
    if (!this.commands.some((command) => command.name === name)) {
      return undefined;
    }
    return { name, args: match[2] ?? '' };
  }

  /**
   * Appends the context tokens of the chips to the typed text and gives each
   * chip its mention range, so a selection arrives as `path:start-end` and a
   * file as `@path` without the user typing anything. The mention is computed
   * once, over the final text.
   */
  private async composePrompt(
    text: string,
    explicit: readonly ContextFileAttachment[],
  ): Promise<{
    text: string;
    attachments: PromptAttachments;
    files: FileAttachment[];
  }> {
    const refs = explicit
      .map((file) => file.context)
      .filter((context): context is ContextRef => context !== undefined);
    const composed = composeContextText(text, refs);
    const attachments = await this.parseAttachments(composed.text);
    const files = mergeFiles(
      attachments.files ?? [],
      explicit.map((file) => {
        const token = file.context ? contextToken(file.context) : undefined;
        const mention = token ? composed.mentions.get(token) : undefined;
        return {
          uri: file.uri,
          name: file.name,
          ...(mention ? { mention } : {}),
        };
      }),
    );
    return { text: composed.text, attachments, files };
  }

  private async parseAttachments(text: string): Promise<PromptAttachments> {
    const skills: SkillAttachment[] = [];
    const agents: AgentAttachment[] = [];
    const files: FileAttachment[] = [];
    const seenSkills = new Set<string>();
    const seenAgents = new Set<string>();
    const seenFiles = new Set<string>();
    const pattern = /(^|[\s(])@([A-Za-z0-9_.:/-]+)/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const token = match[2];
      const start = match.index + match[1].length;
      const end = start + token.length + 1;
      const mention = { start, end, text: text.slice(start, end) };

      const skill = this.skills.find((entry) => entry.id === token || entry.name === token);
      if (skill) {
        if (!seenSkills.has(skill.id)) {
          seenSkills.add(skill.id);
          skills.push({ id: skill.id, mention });
        }
        continue;
      }

      const agent = this.agents.find((entry) => entry.id === token || entry.name === token);
      if (agent && !agent.hidden) {
        if (!seenAgents.has(agent.id)) {
          seenAgents.add(agent.id);
          agents.push({ name: agent.id, mention });
        }
        continue;
      }

      const file = await this.resolveFile(token);
      if (file && !seenFiles.has(file.uri)) {
        seenFiles.add(file.uri);
        files.push({ ...file, mention });
      }
    }

    return { skills, agents, files };
  }

  private async resolveFile(token: string): Promise<{ uri: string; name: string } | undefined> {
    const relative = token.replace(/^\.\//, '');
    if (relative.length === 0) {
      return undefined;
    }
    const root = path.resolve(this.directory);
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      return undefined;
    }
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { uri: vscode.Uri.file(absolute).toString(), name: relative };
  }

  private attachmentsDirectory(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'attachments');
  }

  private async ensureAttachmentsDirectory(): Promise<string> {
    const directory = this.attachmentsDirectory();
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  private async storeAttachment(bytes: Buffer, name: string): Promise<vscode.Uri> {
    const directory = await this.ensureAttachmentsDirectory();
    const target = path.join(directory, `${randomUUID()}-${sanitizeFileName(name)}`);
    await fs.writeFile(target, bytes);
    return vscode.Uri.file(target);
  }

  private attachmentReply(
    uri: vscode.Uri,
    name: string,
    kind: AttachmentKind,
    size: number,
    description?: string,
    context?: ContextRef,
  ): HostAttachment {
    // No `previewUri` here: it can only be minted by the webview that shows the
    // chip, so `withPreview` adds it per surface right before the frame goes out.
    return {
      id: randomUUID(),
      name,
      uri: uri.toString(),
      kind,
      size,
      description,
      ...(context ? { context } : {}),
    };
  }

  private postAttachment(
    reply: SurfaceReply,
    requestId: string,
    attachment: HostAttachment,
  ): void {
    if (requestId.length === 0) {
      return;
    }
    reply.send({
      type: 'attached',
      requestId,
      attachment: this.withPreview(attachment, reply.webview),
    });
  }

  private postAttachError(reply: SurfaceReply, requestId: string, message: string): void {
    if (requestId.length === 0) {
      return;
    }
    reply.send({ type: 'attachError', requestId, message });
  }

  private postAttachDone(reply: SurfaceReply, requestId: string): void {
    if (requestId.length === 0) {
      return;
    }
    reply.send({ type: 'attachDone', requestId });
  }

  private async runAttach(
    reply: SurfaceReply,
    requestId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.postAttachError(reply, requestId, describeError(error));
    } finally {
      this.postAttachDone(reply, requestId);
    }
  }

  /**
   * Hands a host-initiated attachment to every live surface. The frame carries
   * no requestId: the webview appends it to the chat named by `sessionID`, and a
   * closed, loading or still-booting surface keeps it in the buffer until
   * `ready` and the first `state` have gone out.
   */
  private deliverAttachment(attachment: HostAttachment): void {
    if (!this.anyReady() || this.loading) {
      this.pendingAttachments.push(attachment);
      if (this.pendingAttachments.length > ATTACHMENT_LIMIT_COUNT) {
        this.pendingAttachments.shift();
      }
      return;
    }
    this.postAttached(attachment);
    this.postUi({ type: 'focus', target: 'composer' });
  }

  /**
   * Offers the active workspace file as the automatic chip. Never buffers: the
   * chip only exists while the panel is live, and a dismissed file stays
   * dismissed until the active editor moves to another one.
   */
  private async syncAutoContext(
    editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor,
  ): Promise<void> {
    if (!this.anyReady()) {
      return;
    }
    const uri = editor?.document.uri;
    const file =
      uri && uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(uri) ? uri : undefined;
    if (!this.settings.autoAttachActiveFile || !file) {
      // Clear unconditionally: a chat may still show a chip from before the
      // URI was reset (tab switch, new chat), and the webview is idempotent.
      this.autoContextUri = undefined;
      this.postAutoContext(undefined);
      return;
    }
    const key = file.toString();
    if (key === this.autoContextUri || this.autoContextDismissed.has(key)) {
      return;
    }
    // A different active file makes an earlier dismissal stale.
    this.autoContextDismissed.clear();
    try {
      const attachment = await this.attachFileUri(file);
      // The panel may have closed, or the editor moved on, while the stat ran.
      if (!this.anyReady()) {
        return;
      }
      if (vscode.window.activeTextEditor?.document.uri.toString() !== key) {
        return;
      }
      this.autoContextUri = key;
      this.postAutoContext(attachment);
    } catch {
      // Never leave the previous file's chip pretending to be the new one.
      if (vscode.window.activeTextEditor?.document.uri.toString() !== key) {
        return;
      }
      this.autoContextUri = undefined;
      this.postAutoContext(undefined);
    }
  }

  private postAutoContext(attachment: HostAttachment | undefined): void {
    // The automatic chip is always a file, so it needs no per-webview preview.
    this.postEach(() => ({
      type: 'autoContext',
      autoContext: attachment ?? null,
      directory: this.activeDirectory,
      ...(this.session ? { sessionID: this.session.id } : {}),
    }));
  }

  /** Flushes attachments captured while every surface was closed, loading or booting. */
  private flushPendingAttachments(): void {
    // Without a live webview the buffer must survive: the next `ready` delivers it.
    if (this.pendingAttachments.length === 0 || !this.anyReady()) {
      return;
    }
    const queued = this.pendingAttachments;
    this.pendingAttachments = [];
    for (const attachment of queued) {
      this.postAttached(attachment);
    }
    this.postUi({ type: 'focus', target: 'composer' });
  }

  /**
   * Names the chat the attachment belongs to, so the panel does not have to
   * infer it from whatever `state` frame it has processed so far.
   */
  private postAttached(attachment: HostAttachment): void {
    this.postEach((webview) => ({
      type: 'attached',
      attachment: this.withPreview(attachment, webview),
      ...(this.session ? { sessionID: this.session.id } : {}),
    }));
  }

  /**
   * A `previewUri` is only valid in the webview that minted it, so it is added
   * per surface and never cached on the attachment.
   */
  private withPreview(attachment: HostAttachment, webview: vscode.Webview): HostAttachment {
    if (attachment.kind !== 'image' || attachment.previewUri) {
      return attachment;
    }
    return {
      ...attachment,
      previewUri: webview.asWebviewUri(vscode.Uri.parse(attachment.uri)).toString(),
    };
  }

  private reportAttachError(message: string): void {
    if (this.anyReady()) {
      this.postUi({ type: 'toast', text: message });
      return;
    }
    void vscode.window.showErrorMessage(message);
  }

  /** Writes the clipboard and reports a failure instead of faking success. */
  private async writeClipboard(text: string): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(text);
      return true;
    } catch {
      this.reportAttachError('Could not copy to the clipboard.');
      return false;
    }
  }

  /** Palette commands run before the panel exists; connect once on demand. */
  private async ensureConnected(): Promise<boolean> {
    if (!this.client) {
      await this.connectAndLoad();
    }
    return this.client !== undefined;
  }

  private focusComposer(): void {
    if (this.anyReady()) {
      this.postUi({ type: 'focus', target: 'composer' });
    }
  }

  private showScreenshotPasteHint(): void {
    void vscode.window.showInformationMessage(SCREENSHOT_PASTE_HINT);
    this.focusComposer();
  }

  /**
   * Runs the macOS interactive capture into a temp PNG. `undefined` means the
   * user cancelled: `screencapture` exits with status 1 and prints nothing.
   */
  private async captureScreenshot(): Promise<HostAttachment | undefined> {
    if (this.capturing) {
      void vscode.window.showInformationMessage('A screenshot is already being captured.');
      return undefined;
    }
    this.capturing = true;
    let directory: string | undefined;
    try {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-shot-'));
      const target = path.join(directory, 'screenshot.png');
      try {
        await execFileAsync('screencapture', ['-i', target], {
          timeout: SCREENSHOT_TIMEOUT_MS,
        });
      } catch (error) {
        const failure = describeCaptureFailure(error);
        if (failure === undefined) {
          return undefined;
        }
        throw new Error(failure);
      }
      const bytes = await fs.readFile(target).catch(() => undefined);
      if (!bytes || bytes.byteLength === 0) {
        return undefined;
      }
      if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) {
        throw new Error('The screenshot is larger than 10 MB.');
      }
      const name = screenshotFileName();
      const uri = await this.storeAttachment(bytes, name);
      return this.attachmentReply(uri, name, 'image', bytes.byteLength);
    } finally {
      this.capturing = false;
      if (directory) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private postSendRejected(
    reply: SurfaceReply,
    text: string,
    attachments: readonly unknown[],
    message: string,
    sessionID: string | undefined,
  ): void {
    reply.send({
      type: 'sendRejected',
      message,
      text,
      attachments,
      // A queued send that failed leaves the running turn untouched, so the
      // webview must not drop its busy state with the optimistic bubble.
      busy: this.busy,
      ...(sessionID === undefined ? {} : { sessionID }),
    });
    this.post({ type: 'state', state: this.snapshot() });
  }

  private async attachFiles(reply: SurfaceReply, requestId: string): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: 'Attach',
      title: 'Attach files',
    });
    if (!selection || selection.length === 0) {
      return;
    }
    for (const uri of selection.slice(0, ATTACHMENT_LIMIT_COUNT)) {
      const name = path.basename(uri.fsPath);
      try {
        const stat = await fs.stat(uri.fsPath);
        if (!stat.isFile()) {
          this.postAttachError(reply, requestId, `${name} is not a file.`);
          continue;
        }
        if (stat.size > ATTACHMENT_LIMIT_BYTES) {
          this.postAttachError(reply, requestId, `${name} is larger than 10 MB.`);
          continue;
        }
        const image = isImageFileName(name);
        if (image) {
          const bytes = await fs.readFile(uri.fsPath);
          const stored = await this.storeAttachment(bytes, name);
          this.postAttachment(
            reply,
            requestId,
            this.attachmentReply(stored, name, 'image', stat.size),
          );
          continue;
        }
        this.postAttachment(reply, requestId, this.attachmentReply(uri, name, 'file', stat.size));
      } catch (error) {
        this.postAttachError(reply, requestId, describeError(error));
      }
    }
  }

  private async attachFolder(reply: SurfaceReply, requestId: string): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Attach folder',
      title: 'Attach a folder',
    });
    const folder = selection?.[0];
    if (!folder) {
      return;
    }
    try {
      const stat = await fs.stat(folder.fsPath);
      if (!stat.isDirectory()) {
        this.postAttachError(reply, requestId, `${path.basename(folder.fsPath)} is not a folder.`);
        return;
      }
      this.postAttachment(
        reply,
        requestId,
        this.attachmentReply(folder, path.basename(folder.fsPath), 'folder', 0),
      );
    } catch (error) {
      this.postAttachError(reply, requestId, describeError(error));
    }
  }

  /**
   * One file attachment by URI. A `file:` document is read by the server at
   * send time; an untitled, `git:` or other virtual document only exists in
   * memory, so its text travels inline.
   */
  private async attachFileUri(uri: vscode.Uri): Promise<HostAttachment> {
    const file = documentPath(uri);
    const name = path.basename(uri.fsPath || uri.path) || 'file';
    const context: ContextRef = { kind: 'file', path: file };
    if (uri.scheme === 'file') {
      const stat = await fs.stat(uri.fsPath);
      if (!stat.isFile()) {
        throw new Error(`${name} is not a file.`);
      }
      if (stat.size > ATTACHMENT_LIMIT_BYTES) {
        throw new Error(`${name} is larger than 10 MB.`);
      }
      return this.attachmentReply(uri, name, 'file', stat.size, undefined, context);
    }
    const document =
      vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString()) ??
      (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()
        ? vscode.window.activeTextEditor.document
        : undefined);
    const text = document?.getText() ?? '';
    if (text.length === 0) {
      throw new Error('That file is empty or no longer open.');
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > ATTACHMENT_LIMIT_BYTES) {
      throw new Error(`${name} is larger than 10 MB.`);
    }
    return this.attachmentReply(
      vscode.Uri.parse(inlineTextUri(text)),
      name,
      'file',
      bytes,
      undefined,
      context,
    );
  }

  private async attachSelection(
    reply: SurfaceReply,
    requestId: string,
    editor?: vscode.TextEditor,
  ): Promise<void> {
    this.postAttachment(reply, requestId, await this.captureSelection(editor));
  }

  /**
   * Builds the selection attachment as the source file plus a line range, so
   * the server reads exactly the selected lines. A virtual document, or one
   * whose type the server would not slice, travels inline instead.
   */
  private async captureSelection(editor?: vscode.TextEditor): Promise<HostAttachment> {
    const target = editor ?? vscode.window.activeTextEditor;
    if (!target) {
      throw new Error('Open a file and select the text you want to attach.');
    }
    if (target.selection.isEmpty) {
      // A tab has no selection, and the whole file is the useful attachment.
      return this.attachFileUri(target.document.uri);
    }
    const text = target.document.getText(target.selection);
    if (text.trim().length === 0) {
      return this.attachFileUri(target.document.uri);
    }
    const { startLine, endLine } = selectionRange(target.selection.start, target.selection.end);
    const file = documentPath(target.document.uri);
    const base = path.basename(file) || 'selection';
    const name = `${base}:${startLine}-${endLine}`;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > ATTACHMENT_LIMIT_BYTES) {
      throw new Error(`${name} is larger than 10 MB.`);
    }
    const context: ContextRef = { kind: 'selection', path: file, startLine, endLine };
    const document = target.document;
    // The server applies `?start&end` only to `text/plain`; other languages
    // travel inline so the agent gets exactly the selected lines.
    const uri =
      document.uri.scheme === 'file' && document.languageId === 'plaintext'
        ? vscode.Uri.parse(fileUriWithRange(document.uri.toString(), { startLine, endLine }))
        : vscode.Uri.parse(inlineTextUri(text));
    return this.attachmentReply(uri, name, 'selection', bytes, firstLine(text), context);
  }

  /**
   * The clipboard form of the selection, shared by the attachment and the
   * `Copy Selection with Reference` command so both produce the same text.
   */
  private async selectionPayload(): Promise<{
    markdown: string;
    range: string;
    bytes: number;
    description: string;
  }> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error('Open a file and select the text you want to attach.');
    }
    if (editor.selection.isEmpty) {
      throw new Error('Select some text in the editor first.');
    }
    const text = editor.document.getText(editor.selection);
    if (text.trim().length === 0) {
      throw new Error('The selection is empty.');
    }
    const file = documentPath(editor.document.uri);
    const start = editor.selection.start.line + 1;
    // A selection that stops at column 0 does not include that line's text, so
    // the range must not claim the line below it.
    const end =
      editor.selection.end.character === 0 &&
      editor.selection.end.line > editor.selection.start.line
        ? editor.selection.end.line
        : editor.selection.end.line + 1;
    const base = path.basename(file) || 'selection';
    const language = editor.document.languageId;
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
    const info = language === 'plaintext' ? '' : language;
    // Keep the captured text verbatim, without adding a blank line inside the fence.
    const body = text.endsWith('\n') ? text : `${text}\n`;
    const header = `# ${file}:${start}-${end}`;
    const markdown = `${header}\n\n${fence}${info}\n${body}${fence}\n`;
    const bytes = Buffer.byteLength(markdown, 'utf8');
    const range = `${base}:${start}-${end}`;
    if (bytes > ATTACHMENT_LIMIT_BYTES) {
      throw new Error(`${range} is larger than 10 MB.`);
    }
    return { markdown, range, bytes, description: firstLine(text) };
  }

  private async attachProblems(
    reply: SurfaceReply,
    requestId: string,
    uri?: vscode.Uri,
  ): Promise<void> {
    try {
      this.postAttachment(reply, requestId, await this.attachProblemsFor(uri));
    } catch (error) {
      this.postAttachError(reply, requestId, describeError(error));
    }
  }

  /**
   * One Problems attachment for the clicked file (or the active editor): the
   * diagnostics travel as a temp text file, the chip carries their count and
   * the file keeps no mention because it is not what the user asked about.
   */
  private async attachProblemsFor(uri?: vscode.Uri): Promise<HostAttachment> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      throw new Error('Open the file whose problems you want to attach.');
    }
    const diagnostics = vscode.languages.getDiagnostics(target);
    if (diagnostics.length === 0) {
      throw new Error('No problems reported for this file.');
    }
    const file = documentPath(target);
    const items: ProblemItem[] = diagnostics.map((diagnostic) => ({
      severity: severityName(diagnostic.severity),
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      message: diagnostic.message,
      ...(diagnostic.source ? { source: diagnostic.source } : {}),
    }));
    const digest = problemsDigest(file, items);
    const bytes = Buffer.from(digest.text, 'utf8');
    if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) {
      throw new Error('The problems list is larger than 10 MB.');
    }
    const base = path.basename(file) || 'document';
    const stored = await this.storeAttachment(bytes, `${base}-problems.txt`);
    return this.attachmentReply(
      stored,
      `${base} problems`,
      'problems',
      bytes.byteLength,
      `${digest.count} ${digest.count === 1 ? 'problem' : 'problems'}`,
      { kind: 'problems', path: file, problems: digest.count },
    );
  }

  private async attachDataUrl(
    reply: SurfaceReply,
    requestId: string,
    dataUrl: string,
    name: string,
    mode: 'image' | 'any',
  ): Promise<void> {
    const match = (mode === 'image' ? IMAGE_DATA_URL : DATA_URL).exec(dataUrl);
    if (!match) {
      this.postAttachError(
        reply,
        requestId,
        mode === 'image'
          ? 'The clipboard does not contain a supported image (PNG, JPEG, GIF or WebP).'
          : 'That file could not be read from the drop.',
      );
      return;
    }
    const mime = match[1].toLowerCase();
    const bytes = Buffer.from(dataUrl.slice(match[0].length), 'base64');
    if (bytes.byteLength === 0) {
      this.postAttachError(reply, requestId, `${sanitizeFileName(name)} is empty.`);
      return;
    }
    if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) {
      this.postAttachError(reply, requestId, `${sanitizeFileName(name)} is larger than 10 MB.`);
      return;
    }
    const fileName = ensureExtension(name, MIME_EXTENSIONS[mime] ?? path.extname(name));
    try {
      const uri = await this.storeAttachment(bytes, fileName);
      this.postAttachment(
        reply,
        requestId,
        this.attachmentReply(
          uri,
          path.basename(fileName),
          mime.startsWith('image/') ? 'image' : 'file',
          bytes.byteLength,
        ),
      );
    } catch (error) {
      this.postAttachError(reply, requestId, describeError(error));
    }
  }

  private async pruneAttachments(): Promise<void> {
    const directory = this.attachmentsDirectory();
    const cutoff = Date.now() - ATTACHMENT_RETENTION_MS;
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        try {
          const target = path.join(directory, entry.name);
          const stat = await fs.stat(target);
          if (stat.mtimeMs < cutoff) {
            await fs.rm(target, { force: true }).catch(() => undefined);
          }
        } catch {
          // A file removed or locked by another process is not worth reporting.
        }
      }
    } catch {
      // The attachments directory does not exist yet, or the filesystem refused the read.
    }
  }

  private async removeAttachment(value: string): Promise<void> {
    if (value.length === 0) {
      return;
    }
    let fsPath: string;
    try {
      fsPath = vscode.Uri.parse(value).fsPath;
    } catch {
      return;
    }
    const root = path.resolve(this.attachmentsDirectory());
    const target = path.resolve(fsPath);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) {
      return;
    }
    await fs.rm(target, { force: true }).catch(() => undefined);
  }

  private async collectAttachments(value: readonly unknown[]): Promise<ContextFileAttachment[]> {
    const files: ContextFileAttachment[] = [];
    const seen = new Set<string>();
    for (const entry of value.slice(0, ATTACHMENT_LIMIT_COUNT)) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const raw = entry as { uri?: unknown; name?: unknown; context?: unknown };
      const uri = typeof raw.uri === 'string' ? raw.uri : '';
      const context = parseContextRef(raw.context);
      const name =
        typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : 'attachment';
      // A selection or virtual document can only travel inline; the host never
      // turns a chip into a whole-file base64 copy.
      if (/^data:text\/plain;base64,/i.test(uri)) {
        if (seen.has(uri)) {
          continue;
        }
        const bytes = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
        if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) {
          throw new Error(`${name} is larger than 10 MB.`);
        }
        seen.add(uri);
        files.push({ uri, name, ...(context ? { context } : {}) });
        continue;
      }
      if (!uri.startsWith('file://') || seen.has(uri)) {
        continue;
      }
      let fsPath: string;
      try {
        fsPath = vscode.Uri.parse(uri).fsPath;
      } catch {
        continue;
      }
      const fileName =
        typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : path.basename(fsPath);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fsPath);
      } catch {
        throw new Error(`Attachment is no longer available: ${fileName}`);
      }
      if (!stat.isFile() && !stat.isDirectory()) {
        continue;
      }
      // A selection reads only its line range, so the whole file's size must
      // not reject it; the selected text itself was checked when it was cut.
      if (!attachmentFitsLimit(stat.size, context, ATTACHMENT_LIMIT_BYTES)) {
        throw new Error(`${fileName} is larger than 10 MB.`);
      }
      seen.add(uri);
      files.push({ uri, name: fileName, ...(context ? { context } : {}) });
    }
    return files;
  }

  private onEvent(event: StreamEvent): void {
    const sessionID = eventSessionID(event);
    const isActive = !sessionID || !this.session || sessionID === this.session.id;

    if (event.type === 'session.execution.started') {
      if (sessionID) {
        // Remember which user message this turn diffs against. A long turn
        // pushes it out of the message tail, so it is captured at the start.
        this.captureTurnStart(sessionID, this.transcripts.get(sessionID)?.messages ?? []);
        this.tabRunning.add(sessionID);
        // A fresh turn replaces the "new reply" hint of the previous one.
        this.tabUnread.delete(sessionID);
        const cached = this.tabSessions.get(sessionID);
        if (cached) {
          this.tabSessions.set(sessionID, { ...cached, running: true });
        }
      }
      if (!isActive) {
        this.post({ type: 'state', state: this.snapshot() });
        return;
      }
      this.busy = true;
      // The queue is drained one item at a time; a start is the moment the
      // server list can have changed (a delivery) even before its frame lands.
      void this.loadQueue(sessionID ?? this.session?.id);
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }

    if (
      event.type === 'session.execution.succeeded' ||
      event.type === 'session.execution.failed' ||
      event.type === 'session.execution.interrupted'
    ) {
      if (sessionID) {
        this.tabRunning.delete(sessionID);
        const cached = this.tabSessions.get(sessionID);
        if (cached) {
          this.tabSessions.set(sessionID, { ...cached, running: false });
        }
      }
      if (!isActive) {
        if (sessionID && this.hasTab(sessionID)) {
          // A background turn finished: keep the transcript fresh and raise
          // the "new reply" dot until the user opens the tab.
          if (this.turnIsReviewable(sessionID)) {
            this.latestTurnDiff.delete(sessionID);
          }
          this.tabUnread.add(sessionID);
          this.scheduleSessionTail(sessionID, true);
          // Requests do not outlive their turn: reload whatever the server
          // still has for the hidden tab.
          void this.loadPermissions(sessionID);
        }
        this.post({ type: 'state', state: this.snapshot() });
        return;
      }
      this.busy = false;
      void (async () => {
        const activeID = sessionID ?? this.session?.id;
        await this.refreshTail();
        if (activeID) {
          // A request of the finished turn is answered or expired by now.
          await this.loadPermissions(activeID);
          // A queued prompt may have been delivered or parked by this turn.
          await this.loadQueue(activeID);
        }
        // A reviewable turn hides the card of the previous turn until its own
        // summary lands; a command turn keeps the previous card.
        if (activeID && this.turnIsReviewable(activeID)) {
          this.latestTurnDiff.delete(activeID);
        }
        // `busy=false` and the new `used` must reach the webview even when the
        // tail did not change the visible messages.
        this.post({ type: 'state', state: this.snapshot() });
        if (activeID) {
          await this.computeTurnDiff(activeID);
          this.post({ type: 'state', state: this.snapshot() });
        }
        await this.loadSessions();
        if (this.session) {
          const fresh = this.sessions.find((entry) => entry.id === this.session?.id);
          if (fresh) {
            this.session = fresh;
          }
        }
        this.post({ type: 'messages', messages: this.activeMessages() });
        this.post({
          type: 'sessions',
          sessions: this.sessions,
          session: this.session,
          tabs: this.tabEntries(),
        });
      })();
      return;
    }

    if (event.type.startsWith('session.revert.')) {
      this.onRevertEvent(event, sessionID);
      return;
    }

    if (event.type.startsWith('session.inbox.')) {
      this.onInboxEvent(event, sessionID);
      return;
    }

    if (event.type === 'permission.asked') {
      this.onPermissionAsked(event.data);
      return;
    }

    if (event.type === 'permission.replied') {
      this.onPermissionReplied(event.data);
      return;
    }

    if (event.type === 'session.usage.updated') {
      this.applyUsageTotals(sessionID, event.data);
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }

    if (event.type === 'session.compaction.started') {
      if (sessionID) {
        this.compacting.add(sessionID);
        this.autoCompactSpent.add(sessionID);
        this.armCompactionTimeout(sessionID);
      }
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }

    if (event.type === 'session.compaction.ended') {
      if (sessionID) {
        this.finishCompaction(sessionID);
        this.autoCompactSpent.add(sessionID);
        const at = eventTimestamp(event.data?.time) ?? Date.now();
        const reason: 'auto' | 'manual' = event.data?.reason === 'auto' ? 'auto' : 'manual';
        const text = typeof event.data?.text === 'string' ? event.data.text : '';
        const key = this.compactionKey(sessionID, event.data, text);
        const state = this.usageState(sessionID);
        // Only the next completed turn can measure the compacted context again.
        state.used = null;
        state.compactedAt = at;
        state.lastCompaction = { reason, at };
        this.compactionTimes[sessionID] = at;
        void this.persistCompactions();
        this.pushNotice(sessionID, {
          id: `compaction-${key}`,
          kind: 'compaction',
          reason,
          at,
          text,
        });
        this.post({ type: 'state', state: this.snapshot() });
        if (sessionID === this.session?.id) {
          void this.refreshTail(sessionID).then((ok) => {
            if (ok && this.session?.id === sessionID) {
              this.post({ type: 'messages', messages: this.activeMessages() });
            }
            this.post({ type: 'state', state: this.snapshot() });
          });
        } else if (this.hasTab(sessionID)) {
          this.scheduleSessionTail(sessionID);
        }
        return;
      }
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }

    if (event.type === 'session.compaction.failed') {
      const aborted = isAbortedError(event.data?.error);
      if (sessionID) {
        this.finishCompaction(sessionID);
        if (!aborted) {
          // Keep the warning button usable and retry the automatic pass only
          // after the cooldown, not on every stream frame.
          this.lastAutoCompactAt.set(sessionID, Date.now());
          this.autoCompactSpent.delete(sessionID);
        }
      }
      if (!aborted) {
        const detail = eventErrorText(event.data?.error);
        this.post({
          type: 'error',
          message: detail.length > 0 ? `Compaction failed: ${detail}` : 'Compaction failed',
        });
      }
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }

    if (
      event.type === 'session.created' ||
      event.type === 'session.renamed' ||
      event.type === 'session.deleted' ||
      event.type === 'session.archived'
    ) {
      void this.loadSessions().then(async () => {
        if (event.type === 'session.deleted') {
          if (sessionID && this.hasTab(sessionID)) {
            this.tabMissing.add(sessionID);
            this.tabRunning.delete(sessionID);
          } else {
            await this.reconcileTabs();
          }
        }
        if (sessionID && (event.type === 'session.deleted' || event.type === 'session.archived')) {
          this.forgetCompaction(sessionID);
          this.forgetPermissions(sessionID);
          this.queues.delete(sessionID);
          this.queueRequests.delete(sessionID);
          this.queuePending.delete(sessionID);
          this.queueLoaded.delete(sessionID);
        }
        if (this.session) {
          const fresh = this.sessions.find((entry) => entry.id === this.session?.id);
          if (fresh) {
            this.session = fresh;
          }
        }
        this.post({
          type: 'sessions',
          sessions: this.sessions,
          session: this.session,
          tabs: this.tabEntries(),
        });
      });
      return;
    }

    if (event.type === 'session.text.delta' || event.type === 'session.reasoning.delta') {
      const messageID = event.data?.assistantMessageID;
      const delta = event.data?.delta;
      if (typeof messageID !== 'string' || typeof delta !== 'string' || delta.length === 0) {
        return;
      }
      const kind = event.type === 'session.text.delta' ? 'text' : 'reasoning';
      if (!isActive) {
        if (sessionID && this.hasTab(sessionID)) {
          // Another tab streams: keep its text host-side so switching back
          // replays it without a full re-read.
          this.bufferDelta(sessionID, { messageID, kind, delta });
          this.tabUnread.add(sessionID);
        }
        return;
      }
      // Mirror the visible session into its transcript cache: a later switch
      // then merges the cached text instead of losing what was on screen.
      const entry = this.session ? this.transcriptFor(this.session.id) : undefined;
      if (entry) {
        entry.messages = applyDeltaChunks(entry.messages, [
          { messageID, kind, delta },
        ], this.session?.agent);
      }
      this.post({ type: 'delta', messageID, kind, delta });
      return;
    }

    if (!isActive) {
      if (sessionID && isStructuralEvent(event.type)) {
        this.scheduleSessionTail(sessionID);
      }
      return;
    }

    if (event.type === 'session.model.selected' || event.type === 'session.agent.selected') {
      void this.refreshSession().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
      return;
    }

    if (event.type === 'command.updated') {
      void this.loadCommands().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
      return;
    }

    if (event.type === 'skill.updated') {
      void this.loadSkills().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
      return;
    }

    if (isStructuralEvent(event.type)) {
      this.scheduleRefresh();
    }
  }

  /**
   * Revert transitions of any tab. `staged` and `cleared` only move the card;
   * `committed` also drops the messages of the removed turn. A frame that
   * arrives while our own request is in flight is ignored: that path already
   * applies the result.
   */
  private onRevertEvent(event: StreamEvent, sessionID: string | undefined): void {
    if (!sessionID) {
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    if (this.revertPending.has(sessionID)) {
      return;
    }
    if (!this.hasTab(sessionID)) {
      return;
    }
    void this.applyRevertEvent(event.type, sessionID, event.data);
  }

  /**
   * Inbox transitions of any tab. A frame only moves the mirror; the server
   * list stays the source of truth and is re-read when a payload is unknown.
   */
  private onInboxEvent(event: StreamEvent, sessionID: string | undefined): void {
    if (!sessionID || !this.hasTab(sessionID)) {
      return;
    }
    const active = sessionID === this.session?.id;
    const inboxID = typeof event.data?.inboxID === 'string' ? event.data.inboxID : '';
    if (inboxID.length === 0) {
      if (active) {
        void this.loadQueue(sessionID).then(() => {
          this.post({ type: 'state', state: this.snapshot() });
        });
      } else {
        this.tabStale.add(sessionID);
      }
      return;
    }
    const current = this.queueFor(sessionID);
    const hadBaseline = this.queueLoaded.has(sessionID);
    if (event.type === 'session.inbox.enqueued') {
      const item = parseQueueItem(event.data?.item, {
        id: inboxID,
        sessionID,
        created: Date.now(),
      });
      if (!item) {
        // A newer item kind the strip does not know: let the list decide.
        if (active) {
          void this.loadQueue(sessionID).then(() => {
            this.post({ type: 'state', state: this.snapshot() });
          });
        } else {
          this.tabStale.add(sessionID);
        }
        return;
      }
      // The frame is newer than any list read still in flight.
      this.bumpQueueEpoch(sessionID);
      this.setQueue(sessionID, upsertQueueItem(current, item));
    } else if (
      event.type === 'session.inbox.delivered' ||
      event.type === 'session.inbox.cancelled'
    ) {
      this.bumpQueueEpoch(sessionID);
      this.setQueue(sessionID, withoutItem(current, inboxID));
      this.setQueuePending(sessionID, inboxID, false);
    } else if (event.type === 'session.inbox.delivery.changed') {
      const delivery = event.data?.delivery === 'steer' ? 'steer' : 'queue';
      this.bumpQueueEpoch(sessionID);
      this.setQueue(sessionID, withDelivery(current, inboxID, delivery));
    } else {
      return;
    }
    if (active) {
      this.post({ type: 'state', state: this.snapshot() });
      if (!hadBaseline) {
        // The frame beat the first list: merging into an empty mirror would
        // drop rows the list still has, so read the full list once.
        void this.loadQueue(sessionID).then(() => {
          if (this.session?.id === sessionID) {
            this.post({ type: 'state', state: this.snapshot() });
          }
        });
      }
    } else {
      this.tabStale.add(sessionID);
    }
  }

  private async applyRevertEvent(
    type: string,
    sessionID: string,
    data: Record<string, unknown> | undefined,
  ): Promise<void> {
    const active = sessionID === this.session?.id;
    if (type === 'session.revert.committed') {
      this.reverts.delete(sessionID);
      this.revertEpoch += 1;
      this.invalidateTurnDiffs(sessionID);
      this.turnStarts.delete(sessionID);
      this.turnBaselines.delete(sessionID);
      const boundary = typeof data?.to === 'string' ? data.to : undefined;
      const entry = this.transcripts.get(sessionID);
      if (entry && boundary) {
        entry.messages = [...truncateMessagesAt(entry.messages, boundary)];
      }
      this.pushNotice(sessionID, {
        id: `revert-${boundary ?? sessionID}`,
        kind: 'revert',
        at: eventTimestamp(data?.time) ?? Date.now(),
        text: boundary ? 'Turn removed' : 'Changes reverted',
      });
      if (active) {
        await this.loadMessages();
      } else {
        this.transcripts.delete(sessionID);
        this.tabStale.add(sessionID);
      }
      this.post({ type: 'state', state: this.snapshot() });
      if (active) {
        this.post({ type: 'messages', messages: this.activeMessages() });
      }
      return;
    }
    if (type === 'session.revert.cleared') {
      if (!this.reverts.delete(sessionID)) {
        return;
      }
      this.revertEpoch += 1;
      this.invalidateTurnDiffs(sessionID);
      await this.computeTurnDiff(sessionID);
      this.post({ type: 'state', state: this.snapshot() });
      return;
    }
    // `staged`: the frame may carry the revert, otherwise the session does.
    // The stage is a transition: responses requested before it are stale.
    this.revertEpoch += 1;
    const staged = revertSummary(readRevert(data?.revert ?? data), sessionID);
    if (staged) {
      this.reverts.set(sessionID, staged);
    } else if (this.client) {
      const revertEpoch = this.revertEpoch;
      try {
        this.rememberTab(await this.client.getSession(sessionID), revertEpoch);
      } catch {
        // The next session refresh restores the card.
      }
    }
    this.invalidateTurnDiffs(sessionID);
    this.post({ type: 'state', state: this.snapshot() });
  }

  /**
   * `permission.asked` carries the whole request; a replayed frame replaces the
   * entry by id instead of adding a second card.
   */
  private onPermissionAsked(data: Record<string, unknown> | undefined): void {
    const request = readPermissionRequest(data);
    if (!request || !this.hasTab(request.sessionID)) {
      return;
    }
    // A replayed frame for a request answered here (or in another client) must
    // neither restore the card nor trigger a second automatic reply.
    if (this.permissionResolved.has(request.id)) {
      return;
    }
    this.setPendingPermissions(
      request.sessionID,
      upsertPermission(this.pendingPermissions(request.sessionID), request),
    );
    this.post({ type: 'state', state: this.snapshot() });
    this.maybeAutoApprove(request);
  }

  /** A reply from this panel or another client: the card goes away. */
  private onPermissionReplied(data: Record<string, unknown> | undefined): void {
    const sessionID = typeof data?.sessionID === 'string' ? data.sessionID : '';
    const requestID = typeof data?.requestID === 'string' ? data.requestID : '';
    if (sessionID.length === 0 || requestID.length === 0 || !this.hasTab(sessionID)) {
      return;
    }
    this.resolvePermission(sessionID, requestID);
    this.post({ type: 'state', state: this.snapshot() });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void (async () => {
        await this.refreshTail();
        this.post({ type: 'messages', messages: this.activeMessages() });
      })();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async handle(
    surface: Surface,
    message: { type: string; [key: string]: unknown },
  ): Promise<void> {
    // Request-scoped frames (attachments, rejected sends, file search) must
    // reach the surface that asked and no other.
    const reply: SurfaceReply = {
      webview: surface.webview,
      send: (frame) => this.postTo(surface.id, frame),
    };
    switch (message.type) {
      case 'ready': {
        this.surfaces.markReady(surface.id);
        this.surfaces.markActive(surface.id);
        if (this.client) {
          // A second surface joins the live stream: it only lacks the snapshot.
          this.post({ type: 'state', state: this.snapshot() });
          this.flushPendingAttachments();
        } else {
          await this.connectAndLoad();
        }
        if (this.pendingSettings) {
          this.pendingSettings = false;
          this.post({ type: 'openSettings' });
        }
        // A reload starts with an empty tray, so the automatic chip returns.
        this.autoContextUri = undefined;
        void this.syncAutoContext();
        return;
      }
      case 'openInEditor': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (id.length > 0 && !this.hasTab(id)) {
          return;
        }
        await this.openChatInEditor(id.length > 0 ? id : undefined);
        return;
      }
      case 'newSession':
        await this.newSession();
        return;
      case 'selectFolder': {
        const directory = typeof message.directory === 'string' ? message.directory : '';
        if (directory.length === 0) {
          return;
        }
        await this.selectDirectory(directory, { pinned: true });
        return;
      }
      case 'openSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        const cached =
          this.sessions.find((entry) => entry.id === id) ?? this.tabSessions.get(id);
        if (!cached) {
          this.tabMissing.add(id);
          this.post({ type: 'state', state: this.snapshot() });
          return;
        }
        // The list may predate a staged revert, and its payload would clear the
        // card; only a fresh read decides the revert state. The cached copy is
        // the fallback when the server cannot answer, and it never touches it.
        const payload = await resolveOpenSession(
          cached,
          () => this.freshSession(id),
          this.revertEpoch,
        );
        this.openTab(payload.session, this.activeDirectory, payload.revertEpoch);
        this.session = payload.session;
        this.busy = this.tabRunning.has(id) || payload.session.running;
        this.clearTabNotice(id);
        await this.persistSession(id);
        await this.persistTabs();
        await this.loadMessages();
        await this.loadPermissions(id);
        await this.loadQueue(id);
        this.post({ type: 'state', state: this.snapshot() });
        this.post({ type: 'closeHistory' });
        // The opened chat has its own tray; offer the active file again.
        this.autoContextUri = undefined;
        void this.syncAutoContext();
        return;
      }
      case 'activateTab': {
        const id = typeof message.id === 'string' ? message.id : '';
        await this.activateTab(id);
        return;
      }
      case 'closeTab': {
        const id = typeof message.id === 'string' ? message.id : '';
        await this.closeTab(id);
        return;
      }
      case 'renameSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        const title = typeof message.title === 'string' ? message.title.trim() : '';
        if (id.length === 0 || title.length === 0) {
          return;
        }
        await this.renameSession(id, title);
        return;
      }
      case 'pinTab': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (id.length === 0) {
          return;
        }
        await this.pinTab(id, message.pinned === true);
        return;
      }
      case 'archiveSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (id.length === 0) {
          return;
        }
        await this.archiveSession(id);
        return;
      }
      case 'forkSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (id.length === 0) {
          return;
        }
        await this.forkSession(id);
        return;
      }
      case 'updateSessionRuntime': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (id.length === 0 || !this.hasTab(id)) {
          return;
        }
        const runtime = normalizeRuntime(message.runtime);
        if (runtime) {
          this.runtimes.set(id, runtime);
        }
        return;
      }
      case 'send': {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        const requested = Array.isArray(message.attachments) ? message.attachments : [];
        if ((text.length === 0 && requested.length === 0) || !this.client) {
          return;
        }
        const command = this.matchCommand(text);
        const blocked = this.session ? this.revertInputBlock(this.session.id) : undefined;
        if (blocked) {
          // Sending now would make the server commit the staged revert.
          this.postSendRejected(reply, text, requested, blocked, this.session?.id);
          return;
        }
        let explicit: ContextFileAttachment[];
        try {
          explicit = await this.collectAttachments(requested);
        } catch (error) {
          // A missing or oversized chip rejects the whole send: the draft and
          // every chip come back so the user can fix the tray.
          this.postSendRejected(reply, text, requested, describeError(error), this.session?.id);
          return;
        }
        if (command && explicit.length > 0) {
          this.postSendRejected(
            reply,
            text,
            requested,
            'Attachments are not sent with slash commands. Remove them or drop the command.',
            this.session?.id,
          );
          return;
        }
        if (text.length === 0 && explicit.length === 0) {
          this.postSendRejected(
            reply,
            text,
            requested,
            'No attachments could be sent.',
            this.session?.id,
          );
          return;
        }
        if (!this.session) {
          // The prompt is composed for this send; do not re-add the auto chip.
          await this.newSession({ autoContext: false });
        }
        if (!this.session) {
          return;
        }
        // A steering message of a running turn must not move the boundary: the
        // turn still starts at the first user message after the previous one,
        // which is exactly what `turnRefs` treats as one turn.
        const running = this.tabRunning.has(this.session.id) || this.busy;
        const requestedDelivery: QueueDelivery | undefined =
          message.delivery === 'queue'
            ? 'queue'
            : message.delivery === 'steer'
              ? 'steer'
              : undefined;
        // Queueing leaves the turn untouched: no local bubble, no busy flag and
        // no turn baseline, so the running turn keeps its diff boundary.
        if (running && requestedDelivery === 'queue' && !command) {
          try {
            const prompt = await this.composePrompt(text, explicit);
            await this.client.prompt(
              this.session.id,
              prompt.text,
              { ...prompt.attachments, files: prompt.files },
              { delivery: 'queue' },
            );
            await this.loadQueue(this.session.id);
            this.post({ type: 'state', state: this.snapshot() });
          } catch (error) {
            // The prompt never left the server: give the draft and attachments
            // back, and keep `busy` as it is for the running turn.
            this.postSendRejected(
              reply,
              text,
              requested,
              error instanceof Error && error.message.length > 0
                ? error.message
                : 'The message was not sent.',
              this.session.id,
            );
          }
          return;
        }
        if (!running) {
          // A slash command starts a turn without adding a user message; the
          // baseline lets the terminal handler skip that turn instead of diffing
          // the previous user message again.
          this.turnBaselines.set(
            this.session.id,
            lastUserMessageID(this.transcripts.get(this.session.id)?.messages) ?? null,
          );
        }
        this.busy = true;
        this.post({ type: 'busy', busy: true });
        try {
          if (command) {
            const attachments = await this.parseAttachments(command.args);
            await this.client.command(this.session.id, command.name, command.args, attachments);
          } else {
            const prompt = await this.composePrompt(text, explicit);
            // A message sent into a running turn steers it; an idle send keeps
            // the server default so its body stays exactly as before.
            await this.client.prompt(
              this.session.id,
              prompt.text,
              { ...prompt.attachments, files: prompt.files },
              running ? { delivery: 'steer' } : {},
            );
          }
          await this.refreshSession();
          await this.loadMessages();
          await this.loadQueue(this.session.id);
          this.post({ type: 'state', state: this.snapshot() });
          this.post({ type: 'messages', messages: this.activeMessages() });
          this.scheduleRefresh();
        } catch (error) {
          this.busy = false;
          this.post({ type: 'busy', busy: false });
          this.fail(error);
        }
        return;
      }
      case 'queueSteer': {
        await this.queueSteer(typeof message.id === 'string' ? message.id : '');
        return;
      }
      case 'queueCancel': {
        await this.queueCancel(typeof message.id === 'string' ? message.id : '');
        return;
      }
      case 'queueEdit': {
        await this.queueEdit(reply, typeof message.id === 'string' ? message.id : '');
        return;
      }
      case 'attach:file': {
        const requestId = readRequestId(message);
        await this.runAttach(reply, requestId, () => this.attachFiles(reply, requestId));
        return;
      }
      case 'attach:folder': {
        const requestId = readRequestId(message);
        await this.runAttach(reply, requestId, () => this.attachFolder(reply, requestId));
        return;
      }
      case 'attach:selection': {
        const requestId = readRequestId(message);
        await this.runAttach(reply, requestId, () => this.attachSelection(reply, requestId));
        return;
      }
      case 'attach:screenshot': {
        const requestId = readRequestId(message);
        await this.runAttach(reply, requestId, async () => {
          if (process.platform !== 'darwin') {
            // Pasting into the composer is a valid path on other hosts, so the
            // hint is a notification instead of an attach error.
            this.showScreenshotPasteHint();
            return;
          }
          const attachment = await this.captureScreenshot();
          if (attachment) {
            this.postAttachment(reply, requestId, attachment);
            // The system capture overlay takes focus, so hand it back to the composer.
            this.focusComposer();
          }
        });
        return;
      }
      case 'attach:problems': {
        const requestId = readRequestId(message);
        await this.runAttach(reply, requestId, () => this.attachProblems(reply, requestId));
        return;
      }
      case 'attach:clipboard': {
        const requestId = readRequestId(message);
        const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
        const name = typeof message.name === 'string' ? message.name : 'screenshot.png';
        await this.runAttach(reply, requestId, () =>
          this.attachDataUrl(reply, requestId, dataUrl, name, 'image'),
        );
        return;
      }
      case 'attach:data': {
        const requestId = readRequestId(message);
        const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
        const name = typeof message.name === 'string' ? message.name : 'attachment';
        await this.runAttach(reply, requestId, () =>
          this.attachDataUrl(reply, requestId, dataUrl, name, 'any'),
        );
        return;
      }
      case 'attach:remove': {
        const uri = typeof message.uri === 'string' ? message.uri : '';
        const id = typeof message.id === 'string' ? message.id : '';
        await this.removeAttachment(uri);
        if (uri.length > 0) {
          // The chip exists in every surface that received the attachment, so
          // each one drops it; otherwise the other tray keeps a dead file and
          // its next send fails on a missing attachment.
          this.postEach(() => ({ type: 'attachmentRemoved', id, uri }));
        }
        return;
      }
      case 'autoContextDismiss': {
        const uri = typeof message.uri === 'string' ? message.uri : '';
        if (uri.length > 0) {
          this.autoContextDismissed.add(uri);
          if (this.autoContextUri === uri) {
            this.autoContextUri = undefined;
          }
        }
        return;
      }
      case 'findFiles': {
        const query = typeof message.query === 'string' ? message.query : '';
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        if (!this.client) {
          reply.send({ type: 'files', requestId, query, items: [] });
          return;
        }
        try {
          const items = await this.client.findFiles(this.directory, query);
          reply.send({ type: 'files', requestId, query, items });
        } catch {
          reply.send({ type: 'files', requestId, query, items: [] });
        }
        return;
      }
      case 'stop':
        if (this.client && this.session) {
          try {
            await this.client.interrupt(this.session.id);
          } catch (error) {
            this.fail(error);
          }
        }
        return;
      case 'deleteSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (!this.client || id.length === 0) {
          return;
        }
        // The tab menu confirms inline, the history drawer still gets the modal.
        if (message.confirmed !== true) {
          const target = this.sessions.find((entry) => entry.id === id);
          const choice = await vscode.window.showWarningMessage(
            `Delete "${target?.title ?? id}"? This also deletes its child sessions.`,
            { modal: true },
            'Delete',
          );
          if (choice !== 'Delete') {
            return;
          }
        }
        try {
          await this.client.deleteSession(id);
          this.forgetCompaction(id);
          await this.loadSessions();
          await this.dropTab(id);
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      case 'searchSessions': {
        const query = typeof message.query === 'string' ? message.query : '';
        const requestId = readRequestId(message);
        await this.loadSessions(query);
        reply.send({
          type: 'sessions',
          sessions: this.sessions,
          session: this.session,
          tabs: this.tabEntries(),
          ...(requestId.length > 0 ? { requestId } : {}),
        });
        return;
      }
      case 'selectModel': {
        const selection = message.selection as ModelSelection | undefined;
        if (!selection) {
          return;
        }
        await this.applyModel(selection);
        return;
      }
      case 'selectAgent': {
        const agent = typeof message.agent === 'string' ? message.agent : '';
        await this.applyAgent(agent);
        return;
      }
      case 'updateSetting': {
        const key = typeof message.key === 'string' ? message.key : '';
        await this.applySetting(key, message.value);
        return;
      }
      case 'resetSettings': {
        try {
          await resetUiSettings();
          this.settings = readSettings();
          this.post({ type: 'state', state: this.snapshot() });
          void this.syncAutoContext();
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      case 'openVscodeSettings': {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:kkrenev.opencode-sidekick',
        );
        return;
      }
      case 'reviewTurn': {
        const sessionID =
          typeof message.sessionID === 'string' && message.sessionID.length > 0
            ? message.sessionID
            : this.session?.id;
        if (!sessionID) {
          return;
        }
        const from = typeof message.from === 'string' ? message.from : undefined;
        await this.showTurnDiff(sessionID, from);
        return;
      }
      case 'undoTurn': {
        const sessionID =
          typeof message.sessionID === 'string' && message.sessionID.length > 0
            ? message.sessionID
            : this.session?.id;
        await this.undoTurn(sessionID);
        return;
      }
      case 'keepRevert': {
        const sessionID =
          typeof message.sessionID === 'string' && message.sessionID.length > 0
            ? message.sessionID
            : this.session?.id;
        await this.keepRevert(sessionID);
        return;
      }
      case 'cancelRevert': {
        const sessionID =
          typeof message.sessionID === 'string' && message.sessionID.length > 0
            ? message.sessionID
            : this.session?.id;
        await this.cancelRevert(sessionID);
        return;
      }
      case 'permissionReply': {
        const sessionID = typeof message.sessionID === 'string' ? message.sessionID : '';
        const requestID = typeof message.requestID === 'string' ? message.requestID : '';
        const decision = readPermissionDecision(message.decision);
        if (sessionID.length === 0 || requestID.length === 0 || !decision) {
          return;
        }
        // Only a request the panel actually shows can be answered; the frame
        // comes from the webview and must not address another session.
        if (!this.pendingPermissions(sessionID).some((request) => request.id === requestID)) {
          return;
        }
        await this.replyPermission(
          sessionID,
          requestID,
          decision,
          typeof message.message === 'string' ? message.message : undefined,
        );
        return;
      }
      case 'loadSavedPermissions':
        await this.loadSavedPermissions();
        return;
      case 'deleteSavedPermission': {
        const id = typeof message.id === 'string' ? message.id : '';
        await this.deleteSavedPermission(id);
        return;
      }
      case 'copy': {
        const text = typeof message.text === 'string' ? message.text : '';
        await this.writeClipboard(text);
        return;
      }
      case 'copyTranscript':
        await this.copyTranscript();
        return;
      case 'openExternal': {
        const url = typeof message.url === 'string' ? message.url : '';
        if (/^https?:\/\//i.test(url)) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        return;
      }
      case 'openPath': {
        await this.openPath(
          typeof message.uri === 'string' ? message.uri : '',
          typeof message.path === 'string' ? message.path : '',
          typeof message.line === 'number' ? message.line : undefined,
        );
        return;
      }
      case 'imagePreview': {
        const requestId = readRequestId(message);
        if (requestId.length === 0) {
          return;
        }
        const uri = typeof message.uri === 'string' ? message.uri : '';
        // The answer carries a URI minted for the asking webview only.
        reply.send({
          type: 'imagePreview',
          requestId,
          uri,
          previewUri: this.previewUri(reply.webview, uri),
        });
        return;
      }
      case 'openBrowser':
        await vscode.commands.executeCommand('opencode.sidekick.openInBrowser');
        return;
      case 'openTerminal':
        await vscode.commands.executeCommand('opencode.sidekick.openTerminal');
        return;
      case 'refresh':
        await this.reload();
        return;
      case 'loadOlder':
        await this.loadOlder();
        return;
      case 'compact':
        await this.requestCompact();
        return;
      default:
        return;
    }
  }

  private async persistSession(sessionID: string): Promise<void> {
    this.selection = writeSelection(this.selection, this.activeDirectory, sessionID);
    await this.context.workspaceState.update(SESSION_KEY, this.selection);
  }

  private snapshot(): Record<string, unknown> {
    const folders = this.folderRefs();
    return {
      connected: this.client !== undefined,
      error: this.lastError,
      directory: this.activeDirectory,
      workspace:
        folders.find((folder) => folder.directory === this.activeDirectory)?.name ??
        this.activeDirectory,
      folders,
      activeDirectory: this.activeDirectory,
      session: this.session ?? undefined,
      sessions: this.sessions,
      tabs: this.tabEntries(),
      messages: this.activeMessages(),
      history: {
        hasMoreOlder: this.session
          ? this.transcripts.get(this.session.id)?.hasMoreOlder === true
          : false,
        loadingOlder: this.loadingOlder,
      },
      models: this.models,
      agents: this.agents,
      commands: this.commands,
      skills: this.skills,
      defaultModel: this.defaultModel,
      defaults: this.computeDefaults(),
      settings: this.settings,
      busy: this.busy,
      model: this.session?.model,
      agent: this.session?.agent,
      runtime: this.session ? this.runtimes.get(this.session.id) ?? null : null,
      usage: this.usageSnapshot(),
      notices: this.session ? this.notices.get(this.session.id) ?? [] : [],
      turnDiff:
        this.busy || (this.session !== undefined && this.reverts.has(this.session.id))
          ? null
          : this.latestTurnSummary(),
      revert: this.session ? this.reverts.get(this.session.id) ?? null : null,
      revertPending: this.session ? this.revertPending.has(this.session.id) : false,
      permissions: this.session ? this.pendingPermissions(this.session.id) : [],
      permissionSending: this.session
        ? this.pendingPermissions(this.session.id)
            .filter((request) => this.permissionSending.has(request.id))
            .map((request) => request.id)
        : [],
      queue: this.session ? this.queueFor(this.session.id) : [],
      queuePending: this.session ? [...(this.queuePending.get(this.session.id) ?? [])] : [],
      savedPermissions: this.savedPermissions,
      savedPermissionsError: this.savedPermissionsError ?? null,
      savedPermissionsHint: this.savedPermissionsHint ?? null,
    };
  }

  /**
   * Broadcasts a shared frame: both surfaces render the same chat. The editor
   * panel keeps its own queue, so a state that lands while its webview is
   * booting is replayed on `ready` instead of being dropped.
   */
  private post(message: Record<string, unknown>): void {
    // `post` is the shared channel: the routing table keeps a UI-only frame on
    // the active surface and never lets a request-scoped one leak out.
    const scope = frameScope(message);
    if (scope === 'active') {
      this.postUi(message);
      return;
    }
    if (scope === 'initiator') {
      return;
    }
    for (const surface of this.surfaces.ready()) {
      if (surface.kind === 'editor') {
        // The panel owns its delivery: it holds a state that lands before its
        // webview says `ready` and replays it, so it is posted below.
        continue;
      }
      void surface.webview.postMessage(message);
    }
    this.chatPanel.post(message);
    if (message.type === 'state') {
      this.syncChatChrome();
    }
  }

  /** One surface only: the reply to a frame it sent or a UI-only action. */
  private postTo(surfaceID: string, message: Record<string, unknown>): void {
    const surface = this.surfaces.get(surfaceID);
    if (!surface) {
      return;
    }
    if (surface.kind === 'editor') {
      this.chatPanel.post(message);
      return;
    }
    if (surface.ready) {
      void surface.webview.postMessage(message);
    }
  }

  /** UI-only frame: only the surface the user is looking at reacts to it. */
  private postUi(message: Record<string, unknown>): void {
    const surface = this.surfaces.active();
    if (!surface) {
      return;
    }
    this.postTo(surface.id, message);
  }

  /** A frame built per webview, because `previewUri` is minted for one of them. */
  private postEach(build: (webview: vscode.Webview) => Record<string, unknown>): void {
    for (const surface of this.surfaces.ready()) {
      this.postTo(surface.id, build(surface.webview));
    }
  }

  private anyReady(): boolean {
    return this.surfaces.hasReady();
  }

  /**
   * Title and icon of the editor tab follow the session it shows: running
   * first, then a request or a failure waiting for the user, then idle.
   */
  private syncChatChrome(): void {
    if (!this.chatPanel.visible) {
      return;
    }
    const session = this.session;
    const id = session?.id;
    const running = this.busy || (id !== undefined && this.tabRunning.has(id));
    const attention =
      id !== undefined && (this.pendingPermissions(id).length > 0 || this.lastError !== undefined);
    const status: ChatPanelStatus = running ? 'running' : attention ? 'attention' : 'idle';
    this.chatPanel.syncChrome({
      title: session?.title || 'Untitled',
      status,
      icons: this.chatIcons,
    });
    if (id !== undefined && id !== this.panelSessionID) {
      void this.persistPanelTarget(id);
    }
  }

  private async persistPanelTarget(sessionID: string): Promise<void> {
    this.panelSessionID = sessionID;
    const target: StoredPanelTarget = { sessionID, directory: this.activeDirectory };
    await this.context.workspaceState.update(PANEL_KEY, target);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.post({ type: 'error', message });
  }

  private async html(webview: vscode.Webview, surface: SurfaceKind): Promise<string> {
    const nonce = randomNonce();
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const [style, script] = await Promise.all([
      fs.readFile(path.join(media.fsPath, 'main.css'), 'utf8'),
      fs.readFile(path.join(media.fsPath, 'main.js'), 'utf8'),
    ]);
    const policy = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `img-src data: ${webview.cspSource}`,
      "font-src data:",
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode</title>
    <style>${style}</style>
  </head>
  <body data-surface="${surface}">
    <div id="root"><div class="boot">Starting OpenCode&hellip;</div></div>
    <script nonce="${nonce}">${script}</script>
  </body>
</html>`;
  }
}

function readRequestId(message: { [key: string]: unknown }): string {
  return typeof message.requestId === 'string' ? message.requestId : '';
}

/** The stored editor-tab target, from the serializer or from `PANEL_KEY`. */
function readPanelTarget(value: unknown): StoredPanelTarget | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as { sessionID?: unknown; directory?: unknown };
  if (typeof raw.sessionID !== 'string' || raw.sessionID.length === 0) {
    return undefined;
  }
  return {
    sessionID: raw.sessionID,
    directory: typeof raw.directory === 'string' ? raw.directory : '',
  };
}

function readPermissionDecision(value: unknown): PermissionDecision | undefined {
  return value === 'once' || value === 'always' || value === 'reject' ? value : undefined;
}

function mergeFiles(
  primary: readonly FileAttachment[],
  extra: readonly FileAttachment[],
): FileAttachment[] {
  const result: FileAttachment[] = [];
  const seen = new Set<string>();
  for (const file of [...primary, ...extra]) {
    if (seen.has(file.uri)) {
      continue;
    }
    seen.add(file.uri);
    result.push(file);
  }
  return result;
}

function isImageFileName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

function sanitizeFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const trimmed = base.slice(0, 80);
  return trimmed.length > 0 ? trimmed : 'attachment';
}

function ensureExtension(name: string, extension: string): string {
  const base = sanitizeFileName(name);
  if (extension.length === 0 || base.toLowerCase().endsWith(extension.toLowerCase())) {
    return base;
  }
  return `${base}${extension}`;
}

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return '';
  }
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function severityName(severity: vscode.DiagnosticSeverity): ProblemItem['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    default:
      return 'hint';
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : 'Could not attach that file.';
}

/** Text of a structured stream error payload (`{ message }`). */
function eventErrorText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (!error || typeof error !== 'object') {
    return '';
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

/** The user stopped the turn: a failed compaction is not an error to report. */
function isAbortedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { type?: unknown }).type === 'aborted'
  );
}

/** Epoch milliseconds from a number or a `{ created }` time object. */
function eventTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    const created = (value as { created?: unknown }).created;
    if (typeof created === 'number' && Number.isFinite(created)) {
      return created;
    }
  }
  return undefined;
}

/** `undefined` means the user cancelled the interactive capture. */
function describeCaptureFailure(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return describeError(error);
  }
  const { code, killed, stderr } = error as { code?: unknown; killed?: unknown; stderr?: unknown };
  if (code === 'ENOENT') {
    return 'screencapture is not available on this Mac.';
  }
  if (killed === true) {
    return 'The screenshot capture timed out.';
  }
  const output = typeof stderr === 'string' ? stderr.trim() : '';
  if (code === 1 && output.length === 0) {
    // Esc ends `screencapture` with status 1 and no output.
    return undefined;
  }
  if (output.length > 0) {
    return `${output} (check Screen Recording permission in System Settings)`;
  }
  return describeError(error);
}

function screenshotFileName(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `screenshot-${stamp}-${time}.png`;
}

function documentPath(uri: vscode.Uri): string {
  if (uri.scheme !== 'file') {
    return uri.path.length > 0 ? uri.path : uri.toString();
  }
  // A file outside every workspace folder keeps its absolute path.
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative.length > 0 ? relative : uri.fsPath;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    if (run.length > longest) {
      longest = run.length;
    }
  }
  return longest;
}

/**
 * Mirrors the webview delta reducer so the host cache of the visible session
 * stays in sync with what is on screen.
 */
function applyDeltaChunks(
  messages: readonly UiMessage[],
  chunks: readonly DeltaChunk[],
  agent: string | undefined,
): UiMessage[] {
  const result = [...messages];
  for (const chunk of chunks) {
    const part = deltaPart(chunk.kind, chunk.delta);
    const index = result.findIndex((message) => message.id === chunk.messageID);
    if (index < 0) {
      result.push({
        id: chunk.messageID,
        role: 'assistant',
        time: Date.now(),
        agent,
        parts: [part],
      });
      continue;
    }
    const message = result[index];
    const parts = [...message.parts];
    let target = -1;
    for (let cursor = parts.length - 1; cursor >= 0; cursor -= 1) {
      if (parts[cursor].kind === chunk.kind) {
        target = cursor;
        break;
      }
    }
    if (target < 0) {
      parts.push(part);
    } else {
      const existing = parts[target];
      if (existing.kind === 'text' || existing.kind === 'reasoning') {
        parts[target] = { ...existing, text: existing.text + chunk.delta };
      }
    }
    result[index] = { ...message, parts };
  }
  return result;
}

function deltaPart(kind: DeltaChunk['kind'], delta: string): UiPart {
  return kind === 'text'
    ? { kind: 'text', text: delta }
    : { kind: 'reasoning', text: delta, ms: 0 };
}

function isStructuralEvent(type: string): boolean {
  return (
    type.startsWith('session.tool.') ||
    type.startsWith('session.step.') ||
    type === 'session.text.started' ||
    type === 'session.text.ended' ||
    type === 'session.reasoning.started' ||
    type === 'session.reasoning.ended' ||
    type === 'session.inbox.delivered' ||
    type === 'session.skill.activated'
  );
}

/** Plaque text of a kept revert: the files the stage restored. */
function revertNoticeText(summary: TurnDiffSummary): string {
  const count = summary.files.length;
  if (count === 0) {
    return 'Turn removed';
  }
  return `${count} ${count === 1 ? 'file' : 'files'} reverted`;
}

/** Newest user message of a transcript; it starts the turn being diffed. */
function lastUserMessageID(messages: readonly UiMessage[] | undefined): string | undefined {
  if (!messages) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].id;
    }
  }
  return undefined;
}

function eventSessionID(event: StreamEvent): string | undefined {
  const data = event.data;
  if (!data) {
    return undefined;
  }
  if (typeof data.sessionID === 'string') {
    return data.sessionID;
  }
  if (
    event.type !== 'session.created' &&
    event.type !== 'session.renamed' &&
    event.type !== 'session.deleted' &&
    event.type !== 'session.archived'
  ) {
    return undefined;
  }
  if (typeof data.id === 'string') {
    return data.id;
  }
  const info = data.info;
  if (info && typeof info === 'object' && typeof (info as { id?: unknown }).id === 'string') {
    return (info as { id: string }).id;
  }
  return undefined;
}

function normalizeRuntime(value: unknown): SessionRuntimeState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const model =
    raw.model && typeof raw.model === 'object'
      ? (raw.model as { id?: unknown; providerID?: unknown; variant?: unknown })
      : undefined;
  const toggles: Record<string, boolean> = {};
  if (raw.toggles && typeof raw.toggles === 'object') {
    for (const [key, enabled] of Object.entries(raw.toggles)) {
      if (typeof enabled === 'boolean' && Object.keys(toggles).length < 1000) {
        toggles[key] = enabled;
      }
    }
  }
  return {
    draft: typeof raw.draft === 'string' ? raw.draft.slice(0, 1_000_000) : '',
    scrollTop: finiteNumber(raw.scrollTop),
    stickToBottom: raw.stickToBottom !== false,
    distanceFromBottom: Math.max(0, finiteNumber(raw.distanceFromBottom)),
    toggles,
    caret: finiteNumber(raw.caret),
    selectionEnd: finiteNumber(raw.selectionEnd),
    model:
      model && typeof model.id === 'string' && typeof model.providerID === 'string'
        ? {
            id: model.id,
            providerID: model.providerID,
            variant: typeof model.variant === 'string' ? model.variant : undefined,
          }
        : undefined,
    effort: typeof raw.effort === 'string' ? raw.effort : undefined,
    mode: typeof raw.mode === 'string' ? raw.mode : undefined,
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseModelSetting(value: string): ModelSelection | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return undefined;
  }
  return {
    providerID: trimmed.slice(0, slash),
    id: trimmed.slice(slash + 1),
  };
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
