import { findMatches, searchRegionKey, type SearchHit } from '../../../../shared/chat-search';

/**
 * CSS Custom Highlight API names. Registered ranges paint behind the text, so
 * markdown markup and its `dangerouslySetInnerHTML` stay untouched.
 */
const ALL_HIGHLIGHTS = 'chat-search';
const ACTIVE_HIGHLIGHTS = 'chat-search-active';

interface HighlightSupport {
  readonly registry: HighlightRegistry;
  readonly create: (...ranges: Range[]) => Highlight;
}

/**
 * Highlights the transcript regions that are currently in the DOM and returns
 * the active match, so the caller can scroll the match itself into view (the
 * message anchor only puts the message top on screen). Regions that are not
 * rendered (collapsed tool bodies, windowed-out messages) are skipped; the
 * counter and the jump keep working.
 *
 * Without the CSS Custom Highlight API this is a silent no-op: the panel still
 * reports `N/M` and scrolls to the message.
 */
export function applyHighlights(
  root: HTMLElement | null,
  hits: readonly SearchHit[],
  current: number,
  query: string,
): Range | null {
  clearHighlights();
  if (!root || query.trim().length === 0 || hits.length === 0) {
    return null;
  }
  const support = highlightSupport();
  if (!support) {
    return null;
  }

  const byRegion = new Map<string, number[]>();
  hits.forEach((hit, index) => {
    const key = searchRegionKey(hit);
    const entries = byRegion.get(key);
    if (entries) {
      entries.push(index);
    } else {
      byRegion.set(key, [index]);
    }
  });

  const ranges: Range[] = [];
  let active: Range | null = null;

  for (const region of root.querySelectorAll<HTMLElement>('[data-search-region]')) {
    const key = region.dataset.searchRegion;
    const entries = key ? byRegion.get(key) : undefined;
    if (!entries) {
      continue;
    }
    const found = rangesInElement(region, query);
    // Markdown can change the rendered text (code fences, links), so the DOM
    // may hold fewer matches than the source. Extra DOM matches are dropped
    // and a source match markdown rewrote is left without a highlight.
    const count = Math.min(found.length, entries.length);
    for (let index = 0; index < count; index += 1) {
      ranges.push(found[index]);
      if (entries[index] === current) {
        active = found[index];
      }
    }
  }

  if (ranges.length === 0) {
    return null;
  }
  support.registry.set(ALL_HIGHLIGHTS, support.create(...ranges));
  if (active) {
    // Registered last, so the current match paints over the others.
    support.registry.set(ACTIVE_HIGHLIGHTS, support.create(active));
  }
  return active;
}

/** Drops both registries; safe when the API or a root is missing. */
export function clearHighlights(): void {
  const support = highlightSupport();
  if (!support) {
    return;
  }
  support.registry.delete(ALL_HIGHLIGHTS);
  support.registry.delete(ACTIVE_HIGHLIGHTS);
}

/** Ranges of `query` inside one region, in document order. */
function rangesInElement(element: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.nodeValue?.length ?? 0) > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? '';
    for (const match of findMatches(text, query)) {
      const range = document.createRange();
      range.setStart(node, match.offset);
      range.setEnd(node, match.offset + match.length);
      ranges.push(range);
    }
    node = walker.nextNode();
  }
  return ranges;
}

function highlightSupport(): HighlightSupport | null {
  if (typeof Highlight !== 'function' || typeof CSS === 'undefined' || !CSS.highlights) {
    return null;
  }
  return {
    registry: CSS.highlights,
    create: (...ranges: Range[]) => new Highlight(...ranges),
  };
}
