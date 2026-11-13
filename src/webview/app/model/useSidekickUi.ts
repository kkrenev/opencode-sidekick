import * as React from 'react';
import { post } from '../../shared/api/vscode';
import type { HistoryScope } from '../../../shared/session-search';
import { pointAnchor } from '../../shared/ui/Popover';
import { chipAnchor } from './chipAnchor';
import type { PopoverState } from './types';

/** Title being edited in place on a tab. */
export interface RenameState {
  readonly id: string;
  /** Title the server has right now; an unchanged draft posts nothing. */
  readonly title: string;
  readonly draft: string;
}

export function useSidekickUi() {
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyQuery, setHistoryQuery] = React.useState('');
  /** Kept between opens: the drawer remembers which folders it searched. */
  const [historyScope, setHistoryScope] = React.useState<HistoryScope>('folder');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [popover, setPopover] = React.useState<PopoverState | null>(null);
  const [rename, setRename] = React.useState<RenameState | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<number | undefined>(undefined);
  /** Search counter: the host echoes it, so only this surface gets the answer. */
  const historyRequest = React.useRef(0);

  const showToast = React.useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const openHistory = React.useCallback(() => {
    setPopover(null);
    setSettingsOpen(false);
    setHistoryOpen(true);
  }, []);

  const closeHistory = React.useCallback(() => {
    setHistoryOpen(false);
    setHistoryQuery('');
  }, []);

  const openSettings = React.useCallback(() => {
    setPopover(null);
    setHistoryOpen(false);
    setSettingsOpen(true);
  }, []);

  const openMenu = React.useCallback((anchor: HTMLElement) => {
    setHistoryOpen(false);
    setSettingsOpen(false);
    setPopover((previous) =>
      previous?.kind === 'menu' ? null : { kind: 'menu', anchor },
    );
  }, []);

  const openPicker = React.useCallback(
    (kind: 'model' | 'effort' | 'mode', anchor: HTMLElement | null) => {
      if (!anchor) {
        return;
      }
      setHistoryOpen(false);
      setSettingsOpen(false);
      setPopover({ kind, anchor });
    },
    [],
  );

  const openAttach = React.useCallback((anchor: HTMLElement | null) => {
    if (!anchor) {
      return;
    }
    setHistoryOpen(false);
    setSettingsOpen(false);
    setPopover((previous) =>
      previous?.kind === 'attach' ? null : { kind: 'attach', anchor },
    );
  }, []);

  const openTabMenu = React.useCallback((id: string, anchor: HTMLElement) => {
    setHistoryOpen(false);
    setSettingsOpen(false);
    setRename(null);
    setPopover((previous) =>
      previous?.kind === 'tab' && previous.id === id ? null : { kind: 'tab', anchor, id },
    );
  }, []);

  const openMessageMenu = React.useCallback((id: string, point: { x: number; y: number }) => {
    setHistoryOpen(false);
    setSettingsOpen(false);
    setRename(null);
    setPopover((previous) =>
      previous?.kind === 'message' && previous.id === id
        ? null
        : { kind: 'message', anchor: pointAnchor(point.x, point.y), id },
    );
  }, []);

  const startRename = React.useCallback((tab: { id: string; title: string }) => {
    setPopover(null);
    setRename({ id: tab.id, title: tab.title, draft: tab.title });
  }, []);

  const setRenameDraft = React.useCallback((draft: string) => {
    setRename((current) => (current ? { ...current, draft } : current));
  }, []);

  const cancelRename = React.useCallback(() => setRename(null), []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'a') {
        return;
      }
      const anchor = chipAnchor('attach-menu');
      if (!anchor) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openAttach(anchor);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [openAttach]);

  React.useEffect(() => {
    if (!historyOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      historyRequest.current += 1;
      post({
        type: 'searchSessions',
        query: historyQuery,
        scope: historyScope,
        requestId: `history-${historyRequest.current}`,
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [historyOpen, historyQuery, historyScope]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (popover) {
        setPopover(null);
        return;
      }
      if (rename) {
        setRename(null);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (historyOpen) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [popover, rename, settingsOpen, historyOpen]);

  return {
    historyOpen,
    setHistoryOpen,
    historyQuery,
    setHistoryQuery,
    historyScope,
    setHistoryScope,
    settingsOpen,
    setSettingsOpen,
    popover,
    setPopover,
    rename,
    toast,
    showToast,
    openHistory,
    closeHistory,
    openSettings,
    openMenu,
    openPicker,
    openAttach,
    openTabMenu,
    openMessageMenu,
    startRename,
    setRenameDraft,
    cancelRename,
  };
}
