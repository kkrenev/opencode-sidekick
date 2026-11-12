import * as React from 'react';
import type { FolderRef, SessionTab } from '../../../shared/types/domain';
import { Icon } from '../../../shared/ui/Icon';

/** Tab whose title is being edited in place. */
export interface TabRename {
  readonly id: string;
  readonly draft: string;
}

export function ChatHeader({
  tabs,
  activeId,
  connected,
  folders,
  activeDirectory,
  renaming,
  onSelectFolder,
  onActivate,
  onClose,
  onContextMenu,
  onNew,
  onHistory,
  onSettings,
  onMenu,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel,
}: {
  tabs: readonly SessionTab[];
  activeId: string | null;
  connected: boolean;
  folders: readonly FolderRef[];
  activeDirectory: string;
  renaming: TabRename | null;
  onSelectFolder: (directory: string) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string, anchor: HTMLElement) => void;
  onNew: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onRenameDraft: (draft: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}): React.ReactElement {
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  // Escape unmounts the input, which also fires a blur: remember that the
  // cancel was intentional so blur does not commit the draft right after.
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    if (!activeId) {
      return;
    }
    const active = Array.from(stripRef.current?.children ?? []).find(
      (element) => element.getAttribute('data-tab-id') === activeId,
    );
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs]);

  React.useEffect(() => {
    cancelled.current = false;
  }, [renaming?.id]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">
          <Icon name="logo" />
        </span>
        {connected ? <span className="connection-dot" title="Connected" /> : null}
        {folders.length > 1 ? (
          <select
            className="folder-picker"
            data-folder={activeDirectory}
            aria-label="Workspace folder"
            title={activeDirectory}
            value={activeDirectory}
            onChange={(event) => onSelectFolder(event.target.value)}
          >
            {folders.map((folder) => (
              <option key={folder.directory} value={folder.directory}>
                {folder.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="tab-strip" role="tablist" aria-label="Open sessions" ref={stripRef}>
        {tabs.length === 0 ? <span className="tab-empty">New session</span> : null}
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const newReply = tab.unread && !active;
          const waiting = tab.permissions > 0 && !active;
          const editing = renaming?.id === tab.id;
          return (
            <div
              key={tab.id}
              className={`session-tab${active ? ' active' : ''}${tab.missing ? ' missing' : ''}${
                tab.stale ? ' stale' : ''
              }${tab.pinned ? ' pinned' : ''}`}
              data-tab-id={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={
                tab.missing
                  ? `${tab.title} (missing on server)`
                  : waiting
                    ? `${tab.title} — ${tab.permissions} permission ${
                        tab.permissions === 1 ? 'request' : 'requests'
                      }`
                    : newReply
                      ? `${tab.title} — new reply`
                      : tab.title
              }
              onClick={() => onActivate(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(tab.id, event.currentTarget);
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              onKeyDown={(event) => {
                if (editing) {
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onActivate(tab.id);
                }
              }}
            >
              {tab.running ? (
                <span className="tab-live" aria-label="Running" />
              ) : newReply ? (
                <span className="tab-unread" aria-label="New reply" />
              ) : null}
              {waiting ? (
                <span
                  className="tab-perm"
                  aria-label={`${tab.permissions} permission ${
                    tab.permissions === 1 ? 'request' : 'requests'
                  }`}
                >
                  {tab.permissions}
                </span>
              ) : null}
              {tab.missing ? <Icon name="alert" className="tab-alert" /> : null}
              {editing ? (
                <input
                  className="tab-rename"
                  type="text"
                  aria-label="Session title"
                  value={renaming.draft}
                  autoFocus
                  onChange={(event) => onRenameDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onRenameCommit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelled.current = true;
                      onRenameCancel();
                    }
                  }}
                  onBlur={() => {
                    if (cancelled.current) {
                      cancelled.current = false;
                      return;
                    }
                    onRenameCommit();
                  }}
                />
              ) : (
                <span className="tab-title">{tab.title || 'Untitled'}</span>
              )}
              {tab.pinned ? (
                <span className="tab-pin" title="Pinned — unpin to close">
                  <Icon name="pin" />
                </span>
              ) : (
                <button
                  className="tab-close"
                  type="button"
                  aria-label={`Close ${tab.title || 'session'}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="top-actions">
        <button className="icon-btn" type="button" data-act="new" title="New session" onClick={onNew}>
          <Icon name="plus" />
        </button>
        <button
          className="icon-btn"
          type="button"
          data-act="history"
          title="Session history"
          onClick={onHistory}
        >
          <Icon name="history" />
        </button>
        <button
          className="icon-btn"
          type="button"
          data-act="settings"
          title="Settings"
          onClick={onSettings}
        >
          <Icon name="gear" />
        </button>
        <button
          className="icon-btn"
          type="button"
          data-act="menu"
          title="More"
          onClick={(event) => onMenu(event.currentTarget)}
        >
          <Icon name="dots" />
        </button>
      </div>
    </header>
  );
}
