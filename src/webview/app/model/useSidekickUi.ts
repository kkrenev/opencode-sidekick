import * as React from 'react';
import { post } from '../../shared/api/vscode';
import type { PopoverState } from './types';

export function useSidekickUi() {
  const [draft, setDraft] = React.useState('');
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyQuery, setHistoryQuery] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [popover, setPopover] = React.useState<PopoverState | null>(null);
  const [toggles, setToggles] = React.useState<Record<string, boolean>>({});
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<number | undefined>(undefined);

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

  React.useEffect(() => {
    if (!historyOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      post({ type: 'searchSessions', query: historyQuery });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [historyOpen, historyQuery]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (popover) {
        setPopover(null);
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
  }, [popover, settingsOpen, historyOpen]);

  return {
    draft,
    setDraft,
    historyOpen,
    setHistoryOpen,
    historyQuery,
    setHistoryQuery,
    settingsOpen,
    setSettingsOpen,
    popover,
    setPopover,
    toggles,
    setToggles,
    toast,
    showToast,
    openHistory,
    closeHistory,
    openSettings,
    openMenu,
    openPicker,
  };
}
