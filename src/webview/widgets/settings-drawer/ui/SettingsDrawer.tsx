import * as React from 'react';
import { SettingsActions } from '../../../features/settings/ui/SettingsActions';
import { SettingsAppearanceSection } from '../../../features/settings/ui/SettingsAppearanceSection';
import { SettingsBehaviorSection } from '../../../features/settings/ui/SettingsBehaviorSection';
import { SettingsDefaultsSection } from '../../../features/settings/ui/SettingsDefaultsSection';
import { SettingsServerSection } from '../../../features/settings/ui/SettingsServerSection';
import type { SidekickSettings } from '../../../shared/config/settings';
import type { AgentEntry, DefaultSelection, ModelEntry } from '../../../shared/types/domain';
import { Icon } from '../../../shared/ui/Icon';

export function SettingsDrawer({
  settings,
  models,
  agents,
  defaults,
  onUpdate,
  onReset,
  onOpenVscode,
  onClose,
}: {
  settings: SidekickSettings;
  models: readonly ModelEntry[];
  agents: readonly AgentEntry[];
  defaults: DefaultSelection;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
  onReset: () => void;
  onOpenVscode: () => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="drawer settings-drawer" id="settings-drawer">
      <div className="drawer-top">
        <span className="drawer-title">Settings</span>
        <button className="icon-btn" type="button" title="Close settings" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="settings-body">
        <SettingsDefaultsSection
          settings={settings}
          models={models}
          agents={agents}
          defaults={defaults}
          onUpdate={onUpdate}
        />
        <SettingsBehaviorSection settings={settings} onUpdate={onUpdate} />
        <SettingsAppearanceSection settings={settings} onUpdate={onUpdate} />
        <SettingsServerSection settings={settings} onUpdate={onUpdate} />
        <SettingsActions onOpenVscode={onOpenVscode} onReset={onReset} />
      </div>
    </div>
  );
}
