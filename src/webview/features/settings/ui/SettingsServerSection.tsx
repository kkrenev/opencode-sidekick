import * as React from 'react';
import type { SidekickSettings } from '../../../shared/config/settings';
import { SettingRow } from '../../../shared/ui/controls/SettingRow';
import { Switch } from '../../../shared/ui/controls/Switch';
import { TextInput } from '../../../shared/ui/controls/TextInput';
import { SettingsSection } from './SettingsSection';

export function SettingsServerSection({
  settings,
  onUpdate,
}: {
  settings: SidekickSettings;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
}): React.ReactElement {
  return (
    <SettingsSection title="Server" description="Connection and executable.">
      <SettingRow label="Auto-start server" hint="Start OpenCode when the panel opens.">
        <Switch
          checked={settings.autoStartServer}
          onChange={(value) => onUpdate('autoStartServer', value)}
        />
      </SettingRow>
      <SettingRow label="CLI path" hint="Empty uses the first opencode on PATH.">
        <TextInput
          value={settings.cliPath}
          placeholder="/path/to/opencode"
          onCommit={(value) => onUpdate('cliPath', value)}
        />
      </SettingRow>
    </SettingsSection>
  );
}
