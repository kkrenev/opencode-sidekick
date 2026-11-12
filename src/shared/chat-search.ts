/**
 * In-transcript search model shared by the webview and its check script. It
 * must stay free of DOM and React imports: the panel bundles it and
 * `npm run check:chat-search` loads the compiled `out/chat-search.js`.
 *
 * Offsets are UTF-16 indexes into the original string. Matching never goes
 * through `toLowerCase()`: case folding can change the length (`İ` becomes two
 * code units) and every later offset would point at the wrong character.
 */

/** Longer regions are not scanned; tool output can be megabytes of text. */
export const SEARCH_REGION_LIMIT = 200_000;
/** A query with more matches is reported as truncated after this many. */
export const SEARCH_HIT_LIMIT = 500;

/** Structurally compatible with the webview `UiPart`. */
export interface SearchPart {
  readonly kind: string;
  readonly text?: string;
  readonly name?: string;
  readonly title?: string;
  readonly input?: string;
  readonly output?: string;
}

/** Structurally compatible with the webview `UiMessage`. */
export interface SearchMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly parts: readonly SearchPart[];
}

export interface SearchMatch {
  readonly offset: number;
  readonly length: number;
}

/**
 * Region suffix inside a message. `user` is the prompt bubble, a part index is
 * a text or reasoning body, and a tool part adds `:name`, `:title`, `:input`
 * or `:output`. The DOM spells the whole key as `${messageId}:${region}`.
 */
export type SearchRegion = string;

export interface SearchHit extends SearchMatch {
  readonly messageId: string;
  readonly region: SearchRegion;
}

export interface SearchOptions {
  /** Tool input and output are off by default: they can be very large. */
  readonly includeOutput?: boolean;
  /** Reasoning is skipped when the panel hides it. */
  readonly includeReasoning?: boolean;
}

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  /** More matches exist than `SEARCH_HIT_LIMIT`. */
  readonly truncated: boolean;
}

/** DOM key of a region, used by the highlight pass. */
export function searchRegionKey(hit: Pick<SearchHit, 'messageId' | 'region'>): string {
  return `${hit.messageId}:${hit.region}`;
}

/**
 * Every match of `query` in render order. The same matcher is exported through
 * `findMatches`, so the DOM highlight agrees with the counter.
 */
export function searchMessages(
  messages: readonly SearchMessage[],
  query: string,
  options: SearchOptions = {},
): SearchResult {
  const needle = query.trim();
  const hits: SearchHit[] = [];
  if (needle.length === 0) {
    return { hits, truncated: false };
  }

  const pattern = matcher(needle);
  let truncated = false;

  const scan = (messageId: string, region: SearchRegion, text: string): void => {
    if (truncated || text.length === 0 || text.length > SEARCH_REGION_LIMIT) {
      return;
    }
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        // A literal query cannot be empty, but a lone surrogate still needs a
        // forward step instead of an endless loop.
        pattern.lastIndex += 1;
        continue;
      }
      if (hits.length >= SEARCH_HIT_LIMIT) {
        truncated = true;
        return;
      }
      hits.push({ messageId, region, offset: match.index, length: match[0].length });
    }
  };

  for (const message of messages) {
    if (message.role === 'user') {
      scan(message.id, 'user', userText(message));
      continue;
    }
    message.parts.forEach((part, index) => {
      if (part.kind === 'text') {
        scan(message.id, String(index), part.text ?? '');
        return;
      }
      if (part.kind === 'reasoning') {
        if (options.includeReasoning !== false) {
          scan(message.id, String(index), part.text ?? '');
        }
        return;
      }
      if (part.kind !== 'tool') {
        return;
      }
      scan(message.id, `${index}:name`, part.name ?? '');
      scan(message.id, `${index}:title`, part.title ?? '');
      if (options.includeOutput === true) {
        scan(message.id, `${index}:input`, part.input ?? '');
        scan(message.id, `${index}:output`, part.output ?? '');
      }
    });
  }

  return { hits, truncated };
}

/** Matches inside one rendered text node, in order. */
export function findMatches(text: string, query: string): readonly SearchMatch[] {
  const needle = query.trim();
  const matches: SearchMatch[] = [];
  if (needle.length === 0 || text.length === 0) {
    return matches;
  }
  const pattern = matcher(needle);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    matches.push({ offset: match.index, length: match[0].length });
    if (matches.length >= SEARCH_HIT_LIMIT) {
      break;
    }
  }
  return matches;
}

/** Cyclic step over `total` hits; an empty result always stays at zero. */
export function stepHit(total: number, current: number, delta: number): number {
  if (total <= 0) {
    return 0;
  }
  const base = current >= 0 && current < total ? current : 0;
  return ((base + delta) % total + total) % total;
}

/**
 * The prompt bubble joins every text part with a newline, exactly like
 * `Message.tsx`; offsets in this region match what the bubble shows.
 */
function userText(message: SearchMessage): string {
  return message.parts.map((part) => part.text ?? '').join('\n');
}

function matcher(needle: string): RegExp {
  return new RegExp(escapeRegExp(needle), 'giu');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
