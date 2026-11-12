import * as React from 'react';
import { MenuRow } from '../../../shared/ui/MenuRow';
import { Popover } from '../../../shared/ui/Popover';

/**
 * Right-click menu of one session tab. Deleting asks a second time inside the
 * menu instead of opening a native dialog, so the tab strip stays in charge.
 */
export function TabMenu({
  anchor,
  title,
  pinned,
  available,
  onClose,
  onRename,
  onTogglePin,
  onArchive,
  onFork,
  onOpenInEditor,
  onCopyId,
  onDelete,
}: {
  anchor: HTMLElement | null;
  title: string;
  pinned: boolean;
  /** False for a tab whose session is gone from the server. */
  available: boolean;
  onClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onFork: () => void;
  onOpenInEditor: () => void;
  onCopyId: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  return (
    <Popover anchor={anchor} align="menu" onClose={onClose} className="menu-popover tab-menu">
      <div className="popover-list">
        <div className="popover-group" title={title}>
          Session
        </div>
        <MenuRow
          icon="external"
          label="Open in editor tab"
          title="Open this chat beside your code"
          disabled={!available}
          onClick={() => {
            onClose();
            onOpenInEditor();
          }}
        />
        <MenuRow
          icon="rename"
          label="Rename"
          disabled={!available}
          onClick={() => {
            onClose();
            onRename();
          }}
        />
        <MenuRow
          icon="pin"
          label={pinned ? 'Unpin tab' : 'Pin tab'}
          title={pinned ? 'Pinned tabs cannot be closed' : 'Keep this tab first'}
          onClick={() => {
            onClose();
            onTogglePin();
          }}
        />
        <MenuRow
          icon="archive"
          label="Archive"
          title={available ? 'Move the session out of the list' : 'The session is missing on the server'}
          disabled={!available}
          onClick={() => {
            onClose();
            onArchive();
          }}
        />
        <MenuRow
          icon="fork"
          label="Fork"
          title="Copy this conversation into a new session"
          disabled={!available}
          onClick={() => {
            onClose();
            onFork();
          }}
        />
        <MenuRow
          icon="copy"
          label="Copy session ID"
          onClick={() => {
            onClose();
            onCopyId();
          }}
        />
        {confirmDelete ? (
          <div className="tab-confirm" role="group" aria-label="Confirm delete">
            <span className="tab-confirm-text">
              Delete &ldquo;{title}&rdquo;? Child sessions go too.
            </span>
            <span className="tab-confirm-actions">
              <button
                className="tab-confirm-btn danger"
                type="button"
                onClick={() => {
                  onClose();
                  onDelete();
                }}
              >
                Delete
              </button>
              <button
                className="tab-confirm-btn"
                type="button"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <MenuRow
            icon="trash"
            label="Delete session"
            title={available ? undefined : 'The session is missing on the server'}
            disabled={!available}
            onClick={() => setConfirmDelete(true)}
          />
        )}
      </div>
    </Popover>
  );
}
