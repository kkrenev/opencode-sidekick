import * as React from 'react';
import type { NotificationMode, SidekickSettings } from '../../../shared/config/settings';
import { Segmented } from '../../../shared/ui/controls/Segmented';
import { SettingRow } from '../../../shared/ui/controls/SettingRow';
import { Switch } from '../../../shared/ui/controls/Switch';
import { SettingsSection } from './SettingsSection';

export function SettingsNotificationsSection({
  settings,
  onUpdate,
}: {
  settings: SidekickSettings;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
}): React.ReactElement {
  return (
    <SettingsSection title="Notifications" description="When the panel asks for you.">
      <SettingRow label="Notify me" hint="Finished turns and pending approvals.">
        <Segmented<NotificationMode>
          value={settings.notifications}
          options={[
            { value: 'all', label: 'All' },
            { value: 'errors', label: 'Errors' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(value) => onUpdate('notifications', value)}
        />
      </SettingRow>
      <SettingRow label="Only when hidden" hint="Stay quiet while the chat is on screen.">
        <Switch
          checked={settings.notifyOnlyWhenHidden}
          disabled={settings.notifications === 'off'}
          onChange={(value) => onUpdate('notifyOnlyWhenHidden', value)}
        />
      </SettingRow>
    </SettingsSection>
  );
}
