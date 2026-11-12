import type { FileEntry, PendingAttachment, SessionSummary, SessionTab } from '../types/domain';
import type { AppData } from '../types/snapshot';
import type { ContextRef } from '../../../shared/editor-context';
import type { SessionRuntimeState } from '../../../shared/session-runtime';
import type { UiMessage } from '../types/ui';

export interface IncomingMessage {
  readonly type: string;
  readonly state?: AppData;
  readonly messages?: readonly UiMessage[];
  readonly sessions?: readonly SessionSummary[];
  readonly session?: SessionSummary;
  readonly tabs?: readonly SessionTab[];
  readonly runtime?: SessionRuntimeState;
  readonly busy?: boolean;
  readonly messageID?: string;
  readonly kind?: 'text' | 'reasoning';
  readonly delta?: string;
  readonly message?: string;
  readonly target?: string;
  readonly query?: string;
  readonly requestId?: string;
  /** Attachment id of an `attachmentRemoved` frame. */
  readonly id?: string;
  /** Attachment URI of an `attachmentRemoved` frame. */
  readonly uri?: string;
  /** Webview URI of an `imagePreview` answer; only valid in the asking webview. */
  readonly previewUri?: string;
  readonly items?: readonly FileEntry[];
  readonly attachment?: PendingAttachment;
  /** Automatic active-file chip; `null` removes the current one. */
  readonly autoContext?: PendingAttachment | null;
  readonly attachments?: readonly {
    readonly uri: string;
    readonly name?: string;
    readonly context?: ContextRef;
  }[];
  /** Short message for the `toast` and `error` frames. */
  readonly text?: string;
  /** A `sendRejected` of a repeated send: the composer keeps what it holds. */
  readonly resend?: boolean;
  readonly sessionID?: string;
  readonly directory?: string;
}
