import type { SidekickSettings } from '../config/settings';
import type { TokenBreakdown, UsageLevel } from '../../../shared/context-usage';
import type {
  AgentEntry,
  CommandEntry,
  DefaultSelection,
  FolderRef,
  ModelEntry,
  ModelSelection,
  SessionSummary,
  SessionTab,
  SkillEntry,
} from './domain';
import type { SessionRuntimeState } from '../../../shared/session-runtime';
import type { PermissionRequest, SavedPermission } from '../../../shared/permission';
import type { QueueItem } from '../../../shared/inbox';
import type { TurnDiffSummary } from '../../../shared/turn-diff';
import type { UiMessage } from './ui';

export interface HistoryState {
  readonly hasMoreOlder: boolean;
  readonly loadingOlder: boolean;
}

/** Context usage of the visible session, computed host-side. */
export interface SessionUsage {
  readonly used: number | null;
  readonly limit?: number;
  readonly percent?: number;
  readonly level: UsageLevel;
  readonly compacting: boolean;
  /** A compaction happened and `used` stays unknown until the next turn. */
  readonly compacted: boolean;
  /** Cumulative session tokens for the tooltip; not the context size. */
  readonly tokens?: TokenBreakdown;
  readonly cost?: number;
  readonly lastCompaction?: { readonly reason: 'auto' | 'manual'; readonly at: number };
}

/** A system plaque rendered after the transcript, never part of `messages`. */
export interface UiNotice {
  readonly id: string;
  readonly kind: 'compaction' | 'revert' | 'permission';
  /** Compaction only: whether the server ran it on its own. */
  readonly reason?: 'auto' | 'manual';
  readonly at: number;
  readonly text: string;
}

export interface Snapshot {
  readonly connected: boolean;
  readonly error: string | null;
  /** The send of this chat was rejected by an outage and can be repeated. */
  readonly resendPending: boolean;
  readonly directory: string;
  readonly workspace: string;
  /** Every folder of the workspace, in VS Code order. */
  readonly folders: readonly FolderRef[];
  /** Folder the panel talks to; `directory` mirrors it. */
  readonly activeDirectory: string;
  readonly session: SessionSummary | null;
  readonly sessions: readonly SessionSummary[];
  readonly tabs: readonly SessionTab[];
  readonly messages: readonly UiMessage[];
  readonly history: HistoryState;
  readonly models: readonly ModelEntry[];
  readonly agents: readonly AgentEntry[];
  readonly commands: readonly CommandEntry[];
  readonly skills: readonly SkillEntry[];
  readonly defaultModel: ModelSelection | null;
  readonly defaults: DefaultSelection;
  readonly settings: SidekickSettings;
  readonly busy: boolean;
  readonly model: ModelSelection | null;
  readonly agent: string | null;
  readonly runtime: SessionRuntimeState | null;
  readonly usage: SessionUsage;
  readonly notices: readonly UiNotice[];
  /** Totals of the last finished turn; hidden while the next turn runs. */
  readonly turnDiff: TurnDiffSummary | null;
  /** Staged revert of the visible session, null when there is none. */
  readonly revert: TurnDiffSummary | null;
  /** A stage, commit or clear request of the visible session is in flight. */
  readonly revertPending: boolean;
  /** Pending permission requests of the visible session, oldest first. */
  readonly permissions: readonly PermissionRequest[];
  /** Request ids with a reply in flight; their buttons are locked. */
  readonly permissionSending: readonly string[];
  /** Server inbox of the visible session, in enqueue order. */
  readonly queue: readonly QueueItem[];
  /** Inbox ids with a steer, edit or cancel in flight. */
  readonly queuePending: readonly string[];
  /** Rules "Always allow" stored for the active project. */
  readonly savedPermissions: readonly SavedPermission[];
  readonly savedPermissionsError: string | null;
  /** Shown instead of the list when no session scopes it to a project. */
  readonly savedPermissionsHint: string | null;
}

export type AppData = Snapshot;
