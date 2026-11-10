import * as React from 'react';
import { groupSessions, relativeTime } from '../../../entities/session/lib/session';
import type { SessionSummary } from '../../../shared/types/domain';
import { Icon } from '../../../shared/ui/Icon';

export function SessionHistory({
  sessions,
  current,
  query,
  onQuery,
  onOpen,
  onDelete,
  onNew,
  onClose,
}: {
  sessions: readonly SessionSummary[];
  current: SessionSummary | null;
  query: string;
  onQuery: (value: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}): React.ReactElement {
  const groups = groupSessions(sessions);
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
      <div className="search">
        <input
          id="session-search"
          type="text"
          placeholder="Search sessions"
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="drawer-list">
        {groups.length === 0 ? (
          <div className="group-label">No sessions yet</div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="group-label">{group.label}</div>
              {group.items.map((session) => (
                <div
                  key={session.id}
                  className={`session-row${current?.id === session.id ? ' active' : ''}`}
                >
                  <button
                    className="session-main"
                    type="button"
                    data-act="open-session"
                    data-id={session.id}
                    onClick={() => onOpen(session.id)}
                  >
                    <span className="row-title">{session.title}</span>
                    <span className="row-sub">
                      {session.running ? <span className="live" /> : null}
                      {relativeTime(session.updated)}
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
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
