import * as React from 'react';
import { SettingsActions } from '../../../features/settings/ui/SettingsActions';
import { SettingsAppearanceSection } from '../../../features/settings/ui/SettingsAppearanceSection';
import { SettingsBehaviorSection } from '../../../features/settings/ui/SettingsBehaviorSection';
import { SettingsDefaultsSection } from '../../../features/settings/ui/SettingsDefaultsSection';
import { SettingsNotificationsSection } from '../../../features/settings/ui/SettingsNotificationsSection';
import { SettingsPermissionsSection } from '../../../features/settings/ui/SettingsPermissionsSection';
import { SettingsServerSection } from '../../../features/settings/ui/SettingsServerSection';
import type { SidekickSettings } from '../../../shared/config/settings';
import type { AgentEntry, DefaultSelection, ModelEntry } from '../../../shared/types/domain';
import type { SavedPermission } from '../../../../shared/permission';
import { Icon } from '../../../shared/ui/Icon';

export function SettingsDrawer({
  settings,
  models,
  agents,
  defaults,
  savedPermissions,
  savedPermissionsError,
  savedPermissionsHint,
  onUpdate,
  onReset,
  onOpenVscode,
  onRefreshSavedPermissions,
  onDeleteSavedPermission,
  onClose,
}: {
  settings: SidekickSettings;
  models: readonly ModelEntry[];
  agents: readonly AgentEntry[];
  defaults: DefaultSelection;
  savedPermissions: readonly SavedPermission[];
  savedPermissionsError: string | null;
  savedPermissionsHint: string | null;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
  onReset: () => void;
  onOpenVscode: () => void;
  onRefreshSavedPermissions: () => void;
  onDeleteSavedPermission: (id: string) => void;
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
        <SettingsNotificationsSection settings={settings} onUpdate={onUpdate} />
        <SettingsPermissionsSection
          settings={settings}
          saved={savedPermissions}
          error={savedPermissionsError}
          hint={savedPermissionsHint}
          onUpdate={onUpdate}
          onRefresh={onRefreshSavedPermissions}
          onDelete={onDeleteSavedPermission}
        />
        <SettingsAppearanceSection settings={settings} onUpdate={onUpdate} />
        <SettingsServerSection settings={settings} onUpdate={onUpdate} />
        <SettingsActions onOpenVscode={onOpenVscode} onReset={onReset} />
      </div>
    </div>
  );
}
