import * as React from 'react';
import { SEARCH_HIT_LIMIT } from '../../../../shared/chat-search';
import { Icon } from '../../../shared/ui/Icon';

/**
 * Find bar over the transcript. It sits in the layout flow instead of floating
 * over the first message, so the composer and `Jump to latest` stay reachable
 * on a narrow sidebar.
 */
export function ChatSearch({
  query,
  current,
  total,
  truncated,
  includeOutput,
  focusNonce,
  onQuery,
  onNext,
  onPrev,
  onClose,
  onToggleOutput,
}: {
  query: string;
  /** Zero-based index of the active hit. */
  current: number;
  total: number;
  truncated: boolean;
  includeOutput: boolean;
  /** Cmd/Ctrl+F again focuses and selects the field. */
  focusNonce: number;
  onQuery: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  onToggleOutput: () => void;
}): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [focusNonce]);

  const empty = query.trim().length === 0;
  const counter = empty
    ? 'Type to search'
    : `${total === 0 ? 0 : Math.min(current + 1, total)}/${total}`;
  const hint = truncated
    ? `Showing the first ${SEARCH_HIT_LIMIT} matches`
    : includeOutput
      ? 'Tool input and output are searched; long output can be slow.'
      : null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // `/` and `@` belong to the composer palette, and Escape must not reach the
    // document handler that closes popovers: the panel owns its own keys.
    event.stopPropagation();
    // Enter steps matches only from the field; on a focused button it must
    // keep its native activation (Output, arrows, Close).
    if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault();
      if (event.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="chat-search"
      role="search"
      aria-label="Search transcript"
      onKeyDown={onKeyDown}
    >
      <Icon name="search" />
      <input
        ref={inputRef}
        className="chat-search-input"
        type="text"
        value={query}
        placeholder="Search transcript"
        aria-label="Search transcript"
        spellCheck={false}
        autoFocus
        onChange={(event) => onQuery(event.target.value)}
      />
      <span className="chat-search-count" aria-live="polite">
        {counter}
      </span>
      <button
        className="chat-search-btn prev"
        type="button"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={total === 0}
        onClick={onPrev}
      >
        <Icon name="chevron" />
      </button>
      <button
        className="chat-search-btn"
        type="button"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={total === 0}
        onClick={onNext}
      >
        <Icon name="chevron" />
      </button>
      <button
        className="chat-search-toggle"
        type="button"
        aria-pressed={includeOutput}
        title="Search tool input and output. Long tool output can be slow."
        onClick={onToggleOutput}
      >
        Output
      </button>
      <button
        className="chat-search-btn"
        type="button"
        aria-label="Close search"
        title="Close search (Escape)"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      {hint ? <span className="chat-search-hint">{hint}</span> : null}
    </div>
  );
}
