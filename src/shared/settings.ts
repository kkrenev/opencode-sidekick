import type { QueueDelivery } from './inbox';
import type { NotificationMode } from './notification';

export type SendKey = 'enter' | 'mod-enter';
export type ReasoningVisibility = 'collapsed' | 'expanded' | 'hidden';
export type AccentColor = 'mint' | 'blue' | 'violet' | 'amber';
export type Density = 'comfortable' | 'compact';
export type FontSize = 'small' | 'default' | 'large';

export interface SidekickSettings {
  readonly defaultModel: string;
  readonly defaultEffort: string;
  readonly defaultMode: string;
  readonly sendKey: SendKey;
  readonly autoScroll: boolean;
  readonly showTimestamps: boolean;
  readonly reasoning: ReasoningVisibility;
  readonly compactTools: boolean;
  readonly accent: AccentColor;
  readonly density: Density;
  readonly fontSize: FontSize;
  readonly cliPath: string;
  readonly autoStartServer: boolean;
  /** Context usage percentage that shows the Compact warning. */
  readonly contextWarnPercent: number;
  /** Context usage percentage that triggers an automatic compaction. */
  readonly contextCompactPercent: number;
  /**
   * Answer read-only tool requests without a card. Shell, edits, network and
   * external directories always ask.
   */
  readonly permissionsAutoApproveSafe: boolean;
  /**
   * What a message sent while a turn runs does: wait in the server inbox
   * (`queue`) or join the running turn (`steer`).
   */
  readonly queueDelivery: QueueDelivery;
  /**
   * Keep the active workspace file attached to the composer as an automatic
   * chip. Off by default; the user can remove the chip like any other.
   */
  readonly autoAttachActiveFile: boolean;
  /** Which finished turns raise a system notification. */
  readonly notifications: NotificationMode;
  /**
   * Keep notifications for the chats the user is not looking at. Off means
   * every finished turn notifies, even while the chat is on screen.
   */
  readonly notifyOnlyWhenHidden: boolean;
}

export const SETTING_DEFAULTS: SidekickSettings = {
  defaultModel: '',
  defaultEffort: '',
  defaultMode: '',
  sendKey: 'enter',
  autoScroll: true,
  showTimestamps: false,
  reasoning: 'collapsed',
  compactTools: true,
  accent: 'mint',
  density: 'comfortable',
  fontSize: 'default',
  cliPath: '',
  autoStartServer: true,
  contextWarnPercent: 80,
  contextCompactPercent: 95,
  permissionsAutoApproveSafe: false,
  queueDelivery: 'queue',
  autoAttachActiveFile: false,
  notifications: 'all',
  notifyOnlyWhenHidden: true,
};

/**
 * Security gate for settings that widen what the agent may do on its own. A
 * value of another type (a hand-edited `settings.json`) falls back to the safe
 * default instead of being treated as truthy.
 */
export function strictBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** An unknown delivery mode falls back to the waiting queue, never to steer. */
export function strictQueueDelivery(
  value: unknown,
  fallback: QueueDelivery = SETTING_DEFAULTS.queueDelivery,
): QueueDelivery {
  return value === 'queue' || value === 'steer' ? value : fallback;
}
