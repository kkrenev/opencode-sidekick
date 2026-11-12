import * as React from 'react';
import { Popover } from '../../../shared/ui/Popover';
import { MenuRow } from '../../../shared/ui/MenuRow';

export function AppMenu({
  anchor,
  onClose,
  onNew,
  onHistory,
  onSettings,
  onModel,
  onEffort,
  onMode,
  onReload,
  onBrowser,
  onTerminal,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  onNew: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onModel: () => void;
  onEffort: () => void;
  onMode: () => void;
  onReload: () => void;
  onBrowser: () => void;
  onTerminal: () => void;
}): React.ReactElement {
  return (
    <Popover anchor={anchor} align="menu" onClose={onClose} className="menu-popover">
      <div className="popover-list" id="popover-list">
        <div className="popover-group">Session</div>
        <MenuRow icon="plus" label="New session" onClick={onNew} />
        <MenuRow icon="history" label="Session history" onClick={onHistory} />
        <MenuRow icon="refresh" label="Reload panel" onClick={onReload} />
        <div className="popover-group">Preferences</div>
        <MenuRow icon="model" label="Model" onClick={onModel} />
        <MenuRow icon="effort" label="Reasoning effort" onClick={onEffort} />
        <MenuRow icon="agent" label="Mode" onClick={onMode} />
        <MenuRow icon="gear" label="Settings" onClick={onSettings} />
        <div className="popover-group">Open in</div>
        <MenuRow icon="external" label="Browser" onClick={onBrowser} />
        <MenuRow icon="terminal" label="Terminal" onClick={onTerminal} />
      </div>
    </Popover>
  );
}

