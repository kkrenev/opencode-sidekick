/**
 * A single streamed text or reasoning chunk for a background session.
 *
 * The host keeps the deltas of every session that is not on screen so that
 * switching back to that tab can replay them onto the cached transcript
 * without re-reading the whole conversation.
 */
export interface DeltaChunk {
  readonly messageID: string;
  readonly kind: 'text' | 'reasoning';
  readonly delta: string;
}

/**
 * Upper bound of buffered chunks per session. A session that produces more
 * than this is marked stale: the buffer is dropped and the transcript is
 * refreshed from the server when the tab is activated.
 */
export const DELTA_BUFFER_LIMIT = 512;
