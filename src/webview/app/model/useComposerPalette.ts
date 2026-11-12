import * as React from 'react';
import { flushSync } from 'react-dom';
import {
  commandPaletteItems,
  detectPalette,
  mentionPaletteItems,
  type PaletteItem,
  type PaletteState,
} from '../../features/composer-palette/lib/palette';
import { post, subscribeToHost } from '../../shared/api/vscode';
import type { FileEntry } from '../../shared/types/domain';
import type { AppData } from '../../shared/types/snapshot';

export function useComposerPalette({
  data,
  draft,
  setDraft,
  inputRef,
  dismissPopover,
  onLocalAction,
  onCaret,
}: {
  data: AppData;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  dismissPopover: () => void;
  onLocalAction: (action: string) => void;
  onCaret: (caret: number) => void;
}) {
  const [palette, setPalette] = React.useState<PaletteState | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [fileCache, setFileCache] = React.useState<Record<string, readonly FileEntry[]>>({});
  const fileSeq = React.useRef(0);

  React.useEffect(() => {
    const unsubscribe = subscribeToHost((message) => {
      if (message.type === 'files' && message.query !== undefined) {
        setFileCache((previous) => ({
          ...previous,
          [message.query!]: message.items ?? [],
        }));
      }
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    if (!palette || palette.kind !== 'mention') {
      return;
    }
    const query = palette.query;
    if (fileCache[query]) {
      return;
    }
    const timer = window.setTimeout(() => {
      const id = ++fileSeq.current;
      post({ type: 'findFiles', query, requestId: String(id) });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [palette, fileCache]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [palette?.kind, palette?.query]);

  const paletteItems = React.useMemo<PaletteItem[]>(() => {
    if (!palette) {
      return [];
    }
    return palette.kind === 'slash'
      ? commandPaletteItems(data.commands, palette.query)
      : mentionPaletteItems(data.skills, fileCache[palette.query] ?? [], palette.query);
  }, [palette, data.commands, data.skills, fileCache]);

  const closePalette = React.useCallback(() => {
    setPalette(null);
  }, []);

  const syncPalette = React.useCallback((value: string, caret: number, collapsed: boolean) => {
    if (!collapsed) {
      setPalette(null);
      return;
    }
    const next = detectPalette(value, caret);
    setPalette((previous) => {
      if (!next) {
        return null;
      }
      if (
        previous &&
        previous.kind === next.kind &&
        previous.start === next.start &&
        previous.end === next.end &&
        previous.query === next.query
      ) {
        return previous;
      }
      return next;
    });
  }, []);

  const changeDraft = React.useCallback(
    (value: string) => {
      const caret = inputRef.current?.selectionStart ?? value.length;
      setDraft(value);
      dismissPopover();
      syncPalette(value, caret, true);
    },
    [dismissPopover, inputRef, setDraft, syncPalette],
  );

  const syncCaret = React.useCallback(() => {
    const element = inputRef.current;
    if (!element) {
      return;
    }
    const caret = element.selectionStart ?? element.value.length;
    syncPalette(element.value, caret, element.selectionStart === element.selectionEnd);
  }, [inputRef, syncPalette]);

  const acceptPalette = React.useCallback(
    (index: number) => {
      const state = palette;
      const item = paletteItems[index];
      if (!state || !item) {
        return;
      }
      const nextValue =
        draft.slice(0, state.start) +
        (item.kind === 'action' ? '' : item.insert) +
        draft.slice(state.end);
      const nextCaret = state.start + (item.kind === 'action' ? 0 : item.insert.length);
      flushSync(() => {
        setDraft(item.kind === 'action' ? '' : nextValue);
        setPalette(null);
      });
      if (item.kind === 'action') {
        onLocalAction(item.action || '');
      } else {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
        onCaret(nextCaret);
      }
    },
    [palette, paletteItems, draft, setDraft, inputRef, onLocalAction, onCaret],
  );

  return {
    palette,
    paletteItems,
    activeIndex,
    setActiveIndex,
    changeDraft,
    syncCaret,
    acceptPalette,
    closePalette,
  };
}
