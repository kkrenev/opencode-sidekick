import type { TokenBreakdown } from '../../../shared/context-usage';

export interface ModelVariant {
  readonly id: string;
  readonly effort?: string;
}

export interface ModelSelection {
  readonly id: string;
  readonly providerID: string;
  readonly variant?: string;
}

export interface ModelEntry {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly variants: readonly ModelVariant[];
  /** Context window of the model; absent when the provider reports none. */
  readonly contextLimit?: number;
}

export interface AgentEntry {
  readonly id: string;
  readonly name: string;
  readonly mode?: string;
  readonly hidden?: boolean;
  readonly description?: string;
  readonly model?: ModelSelection;
}

export interface CommandEntry {
  readonly name: string;
  readonly description?: string;
}

export interface SkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface FileEntry {
  readonly path: string;
  readonly type: 'file' | 'directory';
}

/** One folder of a multi-root workspace. */
export interface FolderRef {
  readonly directory: string;
  readonly name: string;
}

import type { ContextRef } from '../../../shared/editor-context';

export type AttachmentKind = 'image' | 'file' | 'folder' | 'selection' | 'problems';

export interface PendingAttachment {
  readonly id: string;
  readonly name: string;
  readonly uri: string;
  readonly previewUri?: string;
  readonly kind: AttachmentKind;
  readonly size: number;
  readonly description?: string;
  /** Editor context behind the chip; the host turns it into the prompt mention. */
  readonly context?: ContextRef;
  /** Set for the single chip that follows the active editor. */
  readonly auto?: boolean;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly created: number;
  readonly updated: number;
  readonly directory?: string;
  readonly running: boolean;
  readonly agent?: string;
  readonly model?: ModelSelection;
  /** Cumulative cost of the whole session, in US dollars. */
  readonly cost?: number;
  /** Cumulative tokens of the whole session; not the current context size. */
  readonly tokens?: TokenBreakdown;
}

export interface SessionTab {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  readonly missing: boolean;
  /** The session produced output while another tab was on screen. */
  readonly unread: boolean;
  /** The cached transcript may be behind the server (dropped stream). */
  readonly stale: boolean;
  /** Pinned tabs stay first and refuse an accidental close. */
  readonly pinned: boolean;
  /** Pending permission requests of the session. */
  readonly permissions: number;
}

export interface DefaultSelection {
  readonly model?: ModelSelection;
  readonly effort?: string;
  readonly mode?: string;
}

export type { SessionRuntimeState } from '../../../shared/session-runtime';
export type { TokenBreakdown } from '../../../shared/context-usage';
export type {
  PermissionDecision,
  PermissionRequest,
  PermissionRisk,
  SavedPermission,
} from '../../../shared/permission';
