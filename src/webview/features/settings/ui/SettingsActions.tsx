import * as React from 'react';

export function SettingsActions({
  onOpenVscode,
  onReset,
}: {
  onOpenVscode: () => void;
  onReset: () => void;
}): React.ReactElement {
  return (
    <div className="settings-actions">
      <button className="secondary-btn" type="button" onClick={onOpenVscode}>
        Open VS Code Settings
      </button>
      <button className="secondary-btn danger" type="button" onClick={onReset}>
        Reset panel settings
      </button>
    </div>
  );
}
