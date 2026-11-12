import * as React from 'react';
import { searchMessages, stepHit, type SearchHit } from '../../../shared/chat-search';
import type { SidekickSettings } from '../../shared/config/settings';
import type { UiMessage } from '../../shared/types/ui';

/** State and keyboard wiring of the transcript search panel. */
export interface ChatSearchState {
  readonly open: boolean;
  readonly query: string;
  /** Index of the active hit inside `hits`. */
  readonly current: number;
  readonly includeOutput: boolean;
  readonly hits: readonly SearchHit[];
  readonly truncated: boolean;
  /** Changes when the transcript has to jump to the active hit. */
  readonly jumpNonce: number;
  /** Changes when Cmd/Ctrl+F has to focus the field again. */
  readonly focusNonce: number;
  closeSearch: () => void;
  setQuery: (value: string) => void;
  next: () => void;
  prev: () => void;
  toggleOutput: () => void;
}

export function useChatSearch({
  messages,
  sessionId,
  settings,
  blocked,
  dismissPopover,
}: {
  messages: readonly UiMessage[];
  sessionId: string | undefined;
  settings: SidekickSettings;
  /** Settings or history own Cmd/Ctrl+F while they are open. */
  blocked: boolean;
  dismissPopover: () => void;
}): ChatSearchState {
  const [open, setOpen] = React.useState(false);
  const [query, setQueryValue] = React.useState('');
  const [current, setCurrent] = React.useState(0);
  const [includeOutput, setIncludeOutput] = React.useState(false);
  const [jumpNonce, setJumpNonce] = React.useState(0);
  const [focusNonce, setFocusNonce] = React.useState(0);

  const result = React.useMemo(
    () =>
      open
        ? searchMessages(messages, query, {
            includeOutput,
            // Hidden reasoning is not in the transcript, so it is not searchable.
            includeReasoning: settings.reasoning !== 'hidden',
          })
        : { hits: [] as readonly SearchHit[], truncated: false },
    [open, messages, query, includeOutput, settings.reasoning],
  );

  // A new query starts from the first match.
  React.useEffect(() => {
    setCurrent(0);
  }, [query]);

  // Streaming rewrites the transcript under the cursor: keep it in range
  // instead of pointing past the last hit. A closed panel keeps the position
  // for the next Cmd/Ctrl+F.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    setCurrent((value) => Math.min(value, Math.max(0, result.hits.length - 1)));
  }, [open, result.hits.length]);

  // A query belongs to the session it was typed in; the field survives Esc,
  // but another session starts with a clean search. Adjusting state during
  // render keeps one frame from highlighting the old query in a new transcript.
  const [searchSession, setSearchSession] = React.useState(sessionId);
  if (searchSession !== sessionId) {
    setSearchSession(sessionId);
    setQueryValue('');
    setCurrent(0);
  }

  // Opening the panel, typing and toggling output move the transcript. Stepping
  // bumps the nonce itself, so Enter on a single hit still re-centers on it.
  React.useEffect(() => {
    setJumpNonce((value) => value + 1);
  }, [open, query, includeOutput]);

  const closeSearch = React.useCallback(() => setOpen(false), []);
  const setQuery = React.useCallback((value: string) => setQueryValue(value), []);
  const toggleOutput = React.useCallback(() => setIncludeOutput((value) => !value), []);
  const next = React.useCallback(() => {
    setCurrent((value) => stepHit(result.hits.length, value, 1));
    setJumpNonce((value) => value + 1);
  }, [result.hits.length]);
  const prev = React.useCallback(() => {
    setCurrent((value) => stepHit(result.hits.length, value, -1));
    setJumpNonce((value) => value + 1);
  }, [result.hits.length]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'f') {
        return;
      }
      if (blocked) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dismissPopover();
      setOpen(true);
      setFocusNonce((value) => value + 1);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [blocked, dismissPopover]);

  return {
    open,
    query,
    current,
    includeOutput,
    hits: result.hits,
    truncated: result.truncated,
    jumpNonce,
    focusNonce,
    closeSearch,
    setQuery,
    next,
    prev,
    toggleOutput,
  };
}
