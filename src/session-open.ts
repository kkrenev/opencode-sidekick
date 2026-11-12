/**
 * Payload resolution of an explicit "open session".
 *
 * The cached list entry may predate a staged revert: applying it would clear
 * the card, unblock Send, and let the next prompt commit the revert silently.
 * Only a fresh `Session.Info` read decides the revert state; the cached entry
 * is a fallback and then carries `revertEpoch: null`, which keeps the staged
 * card exactly as it is.
 */

import type { SessionSummary } from './opencode-client';

export interface OpenSessionPayload {
  readonly session: SessionSummary;
  /** Epoch to apply the payload in; null keeps the staged card untouched. */
  readonly revertEpoch: number | null;
}

export async function resolveOpenSession(
  cached: SessionSummary,
  read: () => Promise<SessionSummary | undefined>,
  epoch: number,
): Promise<OpenSessionPayload> {
  const fresh = await read();
  return fresh
    ? { session: fresh, revertEpoch: epoch }
    : { session: cached, revertEpoch: null };
}
