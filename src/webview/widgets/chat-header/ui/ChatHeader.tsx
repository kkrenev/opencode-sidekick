import * as React from 'react';
import { Icon } from '../../../shared/ui/Icon';

export function ChatHeader({
  title,
  connected,
  onNew,
  onHistory,
  onSettings,
  onMenu,
}: {
  title: string;
  connected: boolean;
  onNew: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onMenu: (anchor: HTMLElement) => void;
}): React.ReactElement {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">
          <Icon name="logo" />
        </span>
        <button className="session-pill" type="button" data-act="history" onClick={onHistory}>
          <span className="label">{title}</span>
          <Icon name="chevron" />
        </button>
        {connected ? <span className="connection-dot" title="Connected" /> : null}
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
