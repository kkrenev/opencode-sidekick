/**
 * Notification policy shared by the host and `npm run check:notifications`.
 *
 * A finished turn, a pending permission or a lost connection may raise a
 * system notification. The decision is pure so the mode matrix and the
 * visibility rules live in one place: the host only supplies the mode, the
 * outcome and what the user can see right now.
 */

/** What the panel notifies about: everything, only failures, nothing. */
export type NotificationMode = 'all' | 'errors' | 'off';

/** How a turn ended; mirrors the `session.execution.*` frames. */
export type TurnOutcome = 'succeeded' | 'failed' | 'interrupted';

/** Longest session title a notification shows before it is cut. */
export const NOTIFICATION_TITLE_LIMIT = 80;

/** What the user can see when the notification would appear. */
export interface NotificationGate {
  readonly mode: NotificationMode;
  /** Stay quiet while the user already sees the chat that needs them. */
  readonly onlyWhenHidden: boolean;
  /** The window is focused and this chat is the surface on screen. */
  readonly watched: boolean;
  /** The chat that finished or asks for approval is the one the panel shows. */
  readonly sessionActive: boolean;
}

export interface TurnNotification extends NotificationGate {
  readonly outcome: TurnOutcome;
}

/**
 * An unknown value (a hand-edited `settings.json`) falls back to the default
 * instead of silencing notifications by accident.
 */
export function strictNotificationMode(
  value: unknown,
  fallback: NotificationMode = 'all',
): NotificationMode {
  return value === 'all' || value === 'errors' || value === 'off' ? value : fallback;
}

/** `interrupted` is only news in `all`: a stopped turn rarely needs a ping. */
export function shouldNotify(context: TurnNotification): boolean {
  if (context.mode === 'off') {
    return false;
  }
  if (context.mode === 'errors' && context.outcome !== 'failed') {
    return false;
  }
  return !seenByUser(context);
}

/**
 * A pending permission blocks the turn, so it notifies on its own. It is not a
 * failure, so `errors` keeps it on the badge only.
 */
export function shouldNotifyApproval(context: NotificationGate): boolean {
  return context.mode === 'all' && !seenByUser(context);
}

function seenByUser(context: NotificationGate): boolean {
  return context.onlyWhenHidden && context.watched && context.sessionActive;
}

/** The fields of a tab that decide whether it needs the user. */
export interface AttentionTab {
  readonly unread: boolean;
  readonly permissions: number;
}

/** Chats that need the user: a new reply or a request waiting for an answer. */
export function attentionCount(tabs: readonly AttentionTab[]): number {
  return tabs.filter((tab) => tab.unread || tab.permissions > 0).length;
}

/** `Turn finished: Fix the build`; the title is clipped, never the outcome. */
export function notificationText(title: string, outcome: TurnOutcome): string {
  const label =
    outcome === 'failed'
      ? 'Turn failed'
      : outcome === 'interrupted'
        ? 'Turn interrupted'
        : 'Turn finished';
  return `${label}: ${notificationTitle(title)}`;
}

/** Session title as a notification shows it: one line, at most 80 characters. */
export function notificationTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length === 0) {
    return 'Untitled';
  }
  if (clean.length <= NOTIFICATION_TITLE_LIMIT) {
    return clean;
  }
  return `${clean.slice(0, NOTIFICATION_TITLE_LIMIT - 1).trimEnd()}…`;
}
