/**
 * The server-side inbox shared by the host and the queue strip.
 *
 * A prompt sent while a turn runs is admitted to the durable session inbox and
 * delivered at the next step boundary. The list is the source of truth: the
 * panel only mirrors it and never keeps its own queue. `payload` is dropped on
 * the way in (it can carry attachments and agent metadata the strip does not
 * render), only the text the row shows is kept.
 */

/** How the server delivers a queued item; `steer` wakes the running turn. */
export type QueueDelivery = 'queue' | 'steer';

/** Inbox item kinds the server reports; only `user` rows can be sent or edited. */
export type QueueItemType = 'user' | 'synthetic' | 'compaction' | 'move';

/** `Session.Inbox.Info` reduced to what the queue strip shows. */
export interface QueueItem {
  readonly id: string;
  readonly sessionID: string;
  readonly created: number;
  readonly type: QueueItemType;
  readonly delivery: QueueDelivery;
  /** Prompt text of a `user` item; also what Edit puts back into the composer. */
  readonly text?: string;
  /** Description of a `synthetic` item. */
  readonly description?: string;
}

/** Rows the strip renders before it folds the rest into a `+N more` line. */
export const QUEUE_DISPLAY_LIMIT = 50;

const QUEUE_TYPES: readonly QueueItemType[] = ['user', 'synthetic', 'compaction', 'move'];

/** The visible rows and the count hidden behind the display cap. */
export interface QueueSummary {
  readonly visible: readonly QueueItem[];
  readonly hidden: number;
  readonly count: number;
}

/**
 * Reads one inbox entry from any API payload (list entry, stream event). An
 * `enqueued` frame carries the item without its own id and session, so the
 * caller passes those as fallbacks.
 */
export function parseQueueItem(
  value: unknown,
  fallback: { readonly id?: string; readonly sessionID?: string; readonly created?: number } = {},
): QueueItem | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : fallback.id ?? '';
  const sessionID =
    typeof raw.sessionID === 'string' && raw.sessionID.length > 0
      ? raw.sessionID
      : fallback.sessionID ?? '';
  const type = raw.type;
  if (
    id.length === 0 ||
    sessionID.length === 0 ||
    typeof type !== 'string' ||
    !QUEUE_TYPES.includes(type as QueueItemType)
  ) {
    return undefined;
  }
  const time = raw.time && typeof raw.time === 'object' ? (raw.time as Record<string, unknown>) : {};
  const created =
    typeof time.created === 'number' && Number.isFinite(time.created)
      ? time.created
      : fallback.created ?? 0;
  const payload =
    raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {};
  const text = typeof payload.text === 'string' ? payload.text : undefined;
  const description = typeof payload.description === 'string' ? payload.description : undefined;
  return {
    id,
    sessionID,
    created,
    type: type as QueueItemType,
    delivery: raw.delivery === 'steer' ? 'steer' : 'queue',
    text,
    description,
  };
}

/** Replaces an item with the same id, otherwise appends; enqueue order is kept. */
export function upsertQueueItem(
  list: readonly QueueItem[],
  item: QueueItem,
): QueueItem[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index < 0) {
    return [...list, item];
  }
  const next = [...list];
  next[index] = item;
  return next;
}

/** Marks one item as steering; the server confirms with `delivery.changed`. */
export function withDelivery(
  list: readonly QueueItem[],
  id: string,
  delivery: QueueDelivery,
): QueueItem[] {
  return list.map((entry) => (entry.id === id ? { ...entry, delivery } : entry));
}

export function withoutItem(list: readonly QueueItem[], id: string): QueueItem[] {
  return list.filter((entry) => entry.id !== id);
}

/**
 * Only a user prompt that carries text can go back into the composer: the
 * inbox list has no files, so an attachment-only prompt has nothing to edit
 * and cancelling it would look like a silent delete.
 */
export function canEditQueueItem(item: QueueItem): boolean {
  return item.type === 'user' && (item.text?.trim().length ?? 0) > 0;
}

/** Caps the rendered rows; the chip and the header still report the full count. */
export function queueSummary(
  list: readonly QueueItem[],
  limit = QUEUE_DISPLAY_LIMIT,
): QueueSummary {
  const cap = Math.max(1, limit);
  return {
    visible: list.slice(0, cap),
    hidden: Math.max(0, list.length - cap),
    count: list.length,
  };
}

/**
 * A `GET /inbox` response may apply only when no inbox frame or local action
 * bumped the session after the read started. Otherwise a slow list would
 * overwrite a newer delivery, cancel or steer.
 */
export function queueReadIsCurrent(startedEpoch: number, currentEpoch: number): boolean {
  return startedEpoch === currentEpoch;
}
