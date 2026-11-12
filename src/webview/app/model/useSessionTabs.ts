import * as React from 'react';
import { post } from '../../shared/api/vscode';
import type { SessionTab } from '../../shared/types/domain';

export function useSessionTabs({
  tabs,
  activeId,
  showToast,
}: {
  tabs: readonly SessionTab[];
  activeId: string | null;
  showToast: (message: string) => void;
}) {
  const byId = React.useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );

  const activateTab = React.useCallback((id: string) => {
    post({ type: 'activateTab', id });
  }, []);

  const closeTab = React.useCallback(
    (id: string) => {
      if (byId.get(id)?.pinned) {
        showToast('Pinned — unpin to close');
        return;
      }
      post({ type: 'closeTab', id });
    },
    [byId, showToast],
  );

  const renameTab = React.useCallback((id: string, title: string) => {
    post({ type: 'renameSession', id, title });
  }, []);

  const pinTab = React.useCallback((id: string, pinned: boolean) => {
    post({ type: 'pinTab', id, pinned });
  }, []);

  const archiveTab = React.useCallback((id: string) => {
    post({ type: 'archiveSession', id });
  }, []);

  const forkTab = React.useCallback((id: string) => {
    post({ type: 'forkSession', id });
  }, []);

  /** Opens the chat beside the code; the host reveals the tab if it exists. */
  const openInEditor = React.useCallback((id: string) => {
    post({ type: 'openInEditor', id });
  }, []);

  const copyId = React.useCallback(
    (id: string) => {
      post({ type: 'copy', text: id });
      showToast('Session ID copied');
    },
    [showToast],
  );

  /** The tab menu already asked "Delete?", so the host skips its own modal. */
  const deleteTab = React.useCallback((id: string) => {
    post({ type: 'deleteSession', id, confirmed: true });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() === 'w') {
        if (!activeId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        closeTab(activeId);
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const tab = tabs[Number(event.key) - 1];
        if (!tab) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        activateTab(tab.id);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [tabs, activeId, activateTab, closeTab]);

  return {
    activateTab,
    closeTab,
    renameTab,
    pinTab,
    archiveTab,
    forkTab,
    openInEditor,
    copyId,
    deleteTab,
  };
}
