/**
 * Context-window math shared by the host and the webview.
 *
 * `used` is the size of the last assistant turn as the model reported it:
 * fresh input plus cache reads and writes. Session totals are cumulative and
 * must never be used as the current context size.
 */

export type UsageLevel = 'unknown' | 'ok' | 'warn' | 'compact';

export interface TokenBreakdown {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface RawTokenCounts {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
}

export interface UsageMessage {
  readonly id?: string;
  readonly type?: string;
  readonly tokens?: RawTokenCounts;
  readonly time?: { readonly created?: number };
}

export interface ContextLimitModel {
  readonly id: string;
  readonly providerID: string;
  readonly contextLimit?: number;
}

export interface ContextSelection {
  readonly id: string;
  readonly providerID: string;
}

export interface ContextThresholds {
  readonly warn: number;
  readonly compact: number;
}

export interface MessageUsage {
  readonly used: number;
  readonly at: number;
}

const DEFAULT_WARN_PERCENT = 80;
const DEFAULT_COMPACT_PERCENT = 95;
const MIN_PERCENT = 1;
const MAX_PERCENT = 100;
const WARN_GAP = 5;

export function readTokens(tokens: RawTokenCounts | undefined): TokenBreakdown {
  return {
    input: count(tokens?.input),
    output: count(tokens?.output),
    reasoning: count(tokens?.reasoning),
    cacheRead: count(tokens?.cache?.read),
    cacheWrite: count(tokens?.cache?.write),
  };
}

/**
 * Usage of the newest assistant message that reported tokens. Messages are not
 * assumed to be sorted: the newest `time.created` wins, with the message id as
 * a deterministic tie-break. A message still streaming has no `tokens` yet, so
 * the previous completed turn stays in use.
 */
export function usageFromMessages(messages: readonly UsageMessage[]): MessageUsage | null {
  let best: { readonly used: number; readonly at: number; readonly id: string } | undefined;
  for (const message of messages) {
    if (message.type !== 'assistant' || message.tokens === undefined) {
      continue;
    }
    const tokens = readTokens(message.tokens);
    const at = count(message.time?.created);
    const id = typeof message.id === 'string' ? message.id : '';
    if (!best || at > best.at || (at === best.at && id > best.id)) {
      best = { used: tokens.input + tokens.cacheRead + tokens.cacheWrite, at, id };
    }
  }
  return best ? { used: best.used, at: best.at } : null;
}

/**
 * Usage that is valid after a compaction. An assistant turn created at or
 * before the compaction no longer describes the context window, so it yields
 * `null` until a newer turn completes.
 */
export function usageAfterCompaction(
  messages: readonly UsageMessage[],
  compactedAt: number | undefined,
): MessageUsage | null {
  const usage = usageFromMessages(messages);
  if (!usage) {
    return null;
  }
  if (compactedAt !== undefined && usage.at <= compactedAt) {
    return null;
  }
  return usage;
}

export interface AutoCompactState {
  readonly level: UsageLevel;
  readonly active: boolean;
  readonly busy: boolean;
  readonly compacting: boolean;
  /** An automatic or manual compaction already ran for this episode. */
  readonly spent: boolean;
  readonly sinceLastMs: number;
  readonly cooldownMs: number;
}

/**
 * Auto-compaction policy: the first observation of a session above the
 * threshold compacts it, then the episode stays spent until `used` drops.
 */
export function shouldAutoCompact(state: AutoCompactState): boolean {
  return (
    state.level === 'compact' &&
    state.active &&
    !state.busy &&
    !state.compacting &&
    !state.spent &&
    state.sinceLastMs >= state.cooldownMs
  );
}

/** Context limit of the selected model, falling back to the server default. */
export function contextLimit(
  models: readonly ContextLimitModel[],
  selection?: ContextSelection,
  fallback?: ContextSelection,
): number | undefined {
  if (selection) {
    const model = findModel(models, selection);
    if (model) {
      // A known model without a reported limit must stay unknown instead of
      // borrowing the default model's window.
      return validLimit(model.contextLimit);
    }
  }
  const fallbackModel = fallback ? findModel(models, fallback) : undefined;
  return validLimit(fallbackModel?.contextLimit);
}

export function normalizeThresholds(warn: unknown, compact: unknown): ContextThresholds {
  const compactPercent = percentValue(compact, DEFAULT_COMPACT_PERCENT);
  const warnPercent = percentValue(warn, DEFAULT_WARN_PERCENT);
  return {
    warn:
      warnPercent < compactPercent
        ? warnPercent
        : Math.max(MIN_PERCENT, compactPercent - WARN_GAP),
    compact: compactPercent,
  };
}

export function usageLevel(
  used: number | null,
  limit: number | undefined,
  warn: number,
  compact: number,
): UsageLevel {
  if (used === null || !Number.isFinite(used) || limit === undefined || limit <= 0) {
    return 'unknown';
  }
  const percent = (used / limit) * 100;
  if (percent >= compact) {
    return 'compact';
  }
  if (percent >= warn) {
    return 'warn';
  }
  return 'ok';
}

/** Rounded percentage for display; `undefined` when the limit is unknown. */
export function usagePercent(used: number | null, limit: number | undefined): number | undefined {
  if (used === null || !Number.isFinite(used) || limit === undefined || limit <= 0) {
    return undefined;
  }
  return Math.min(MAX_PERCENT, Math.max(0, Math.round((used / limit) * 100)));
}

/**
 * Reads the persisted per-session compaction timestamps. Junk entries are
 * dropped instead of failing the whole workspace state.
 */
export function readCompactionTimes(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [sessionID, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at) && at > 0) {
      result[sessionID] = at;
    }
  }
  return result;
}

function findModel(
  models: readonly ContextLimitModel[],
  selection: ContextSelection,
): ContextLimitModel | undefined {
  return models.find(
    (entry) => entry.id === selection.id && entry.providerID === selection.providerID,
  );
}

function validLimit(limit: number | undefined): number | undefined {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function percentValue(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(value)));
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
