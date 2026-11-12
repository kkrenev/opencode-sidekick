/**
 * Reconnect policy shared by the client and `npm run check:connection`.
 *
 * A dropped event stream retries on its own, so a panel left open next to a
 * stopped server must not hammer it: the delay grows exponentially up to a cap
 * with a little jitter. A resubscribe may replay the frames of a turn that was
 * running during the drop, so they are dropped by their envelope id instead of
 * being applied twice.
 */

/** First retry delay; the next attempt waits twice as long. */
export const RECONNECT_BASE_MS = 1000;

/** Longest wait between two attempts, jitter included. */
export const RECONNECT_CAP_MS = 30000;

/** Randomized share of a delay: ±25% around the exponential step. */
export const RECONNECT_JITTER = 0.25;

/** Envelope ids kept for duplicate detection; a FIFO, so memory stays bounded. */
export const SEEN_EVENT_LIMIT = 512;

/**
 * How long a stream has to stay open before it counts as healthy. A stream of
 * an idle turn carries no frames, so only its age tells the client that the
 * next drop is a new outage and not a continuation of the old backoff.
 */
export const STREAM_STABLE_MS = 5000;

/**
 * Wait before retry number `attempt` (0-based): `base * 2^attempt`, clamped to
 * the cap, jittered by `RECONNECT_JITTER` and clamped again, so a random spike
 * never waits longer than the cap either.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const step = Number.isFinite(attempt) ? Math.floor(attempt) : 0;
  const exponential = RECONNECT_BASE_MS * 2 ** Math.max(0, step);
  const capped = Math.min(RECONNECT_CAP_MS, exponential);
  const sample = random();
  const offset = (Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5) * 2 - 1;
  const jittered = capped + offset * capped * RECONNECT_JITTER;
  return Math.round(Math.min(RECONNECT_CAP_MS, Math.max(RECONNECT_BASE_MS / 2, jittered)));
}

export interface EventDeduper {
  /** False for an id already seen; a frame without an id is always new. */
  isNew(id: string | undefined): boolean;
}

/**
 * Bounded FIFO of envelope ids. `durable.seq` is deliberately not used as a
 * high-water mark: it restarts with the server, and a stale mark would silence
 * every frame after a restart.
 */
export function createEventDeduper(limit = SEEN_EVENT_LIMIT): EventDeduper {
  const seen = new Set<string>();
  const order: string[] = [];
  const capacity = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : SEEN_EVENT_LIMIT;
  return {
    isNew(id: string | undefined): boolean {
      if (typeof id !== 'string' || id.length === 0) {
        return true;
      }
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      order.push(id);
      while (order.length > capacity) {
        const oldest = order.shift();
        if (oldest !== undefined) {
          seen.delete(oldest);
        }
      }
      return true;
    },
  };
}
