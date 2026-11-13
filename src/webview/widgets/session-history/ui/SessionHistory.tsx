import * as React from 'react';
import {
  folderName,
  groupSessions,
  relativeTime,
} from '../../../entities/session/lib/session';
import type { FolderRef, SessionSummary } from '../../../shared/types/domain';
import type { HistoryScope } from '../../../../shared/session-search';
import { Icon } from '../../../shared/ui/Icon';

export function SessionHistory({
  sessions,
  current,
  query,
  scope,
  folders,
  onQuery,
  onScope,
  onOpen,
  onDelete,
  onNew,
  onClose,
}: {
  /** Rows of the active scope: one folder, or the whole workspace. */
  sessions: readonly SessionSummary[];
  current: SessionSummary | null;
  query: string;
  scope: HistoryScope;
  folders: readonly FolderRef[];
  onQuery: (value: string) => void;
  onScope: (scope: HistoryScope) => void;
  onOpen: (id: string, directory?: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}): React.ReactElement {
  const groups = groupSessions(sessions);
  const workspace = scope === 'workspace';
  return (
    <div className="drawer history-drawer" id="drawer">
      <div className="drawer-top">
        <span className="drawer-title">Sessions</span>
        <button className="icon-btn" type="button" data-act="new" title="New session" onClick={onNew}>
          <Icon name="plus" />
        </button>
        <button className="icon-btn" type="button" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {folders.length > 1 ? (
        <div className="history-scope" role="group" aria-label="Session scope">
          <button
            className="scope-btn"
            type="button"
            data-act="scope-folder"
            aria-pressed={!workspace}
            onClick={() => onScope('folder')}
          >
            This folder
          </button>
          <button
            className="scope-btn"
            type="button"
            data-act="scope-workspace"
            aria-pressed={workspace}
            onClick={() => onScope('workspace')}
          >
            All folders
          </button>
        </div>
      ) : null}
      <div className="search">
        <input
          id="session-search"
          type="text"
          placeholder={workspace ? 'Search all folders' : 'Search sessions'}
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="drawer-list">
        {groups.length === 0 ? (
          <div className="group-label">
            {query.trim().length > 0 ? 'No matching sessions' : 'No sessions yet'}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="group-label">{group.label}</div>
              {group.items.map((session) => {
                const folder = workspace ? folderName(session, folders) : undefined;
                return (
                  <div
                    key={session.id}
                    className={`session-row${current?.id === session.id ? ' active' : ''}`}
                  >
                    <button
                      className="session-main"
                      type="button"
                      data-act="open-session"
                      data-id={session.id}
                      onClick={() => onOpen(session.id, workspace ? session.directory : undefined)}
                    >
                      <span className="row-title">{session.title}</span>
                      <span className="row-sub">
                        {session.running ? <span className="live" /> : null}
                        {relativeTime(session.updated)}
                        {folder ? <span className="row-folder">{folder}</span> : null}
                      </span>
                    </button>
                    <button
                      className="delete"
                      type="button"
                      title="Delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(session.id);
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
