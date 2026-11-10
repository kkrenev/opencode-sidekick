import * as React from 'react';
import type { ReasoningVisibility, SendKey, SidekickSettings } from '../../../shared/config/settings';
import { Segmented } from '../../../shared/ui/controls/Segmented';
import { SettingRow } from '../../../shared/ui/controls/SettingRow';
import { Switch } from '../../../shared/ui/controls/Switch';
import { SettingsSection } from './SettingsSection';

export function SettingsBehaviorSection({
  settings,
  onUpdate,
}: {
  settings: SidekickSettings;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
}): React.ReactElement {
  return (
    <>
      <SettingsSection title="Composer" description="How the input behaves.">
        <SettingRow label="Send key" hint="Choose what Enter does.">
          <Segmented<SendKey>
            value={settings.sendKey}
            options={[
              { value: 'enter', label: 'Enter' },
              { value: 'mod-enter', label: 'Cmd/Ctrl+Enter' },
            ]}
            onChange={(value) => onUpdate('sendKey', value)}
          />
        </SettingRow>
        <SettingRow label="Auto-scroll" hint="Follow streamed output.">
          <Switch
            checked={settings.autoScroll}
            onChange={(value) => onUpdate('autoScroll', value)}
          />
        </SettingRow>
        <SettingRow label="Timestamps" hint="Show message times.">
          <Switch
            checked={settings.showTimestamps}
            onChange={(value) => onUpdate('showTimestamps', value)}
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Conversation" description="What the transcript shows.">
        <SettingRow label="Reasoning" hint="Model thinking blocks.">
          <Segmented<ReasoningVisibility>
            value={settings.reasoning}
            options={[
              { value: 'collapsed', label: 'Collapsed' },
              { value: 'expanded', label: 'Expanded' },
              { value: 'hidden', label: 'Hidden' },
            ]}
            onChange={(value) => onUpdate('reasoning', value)}
          />
        </SettingRow>
        <SettingRow label="Compact tools" hint="Collapse tool input and output.">
          <Switch
            checked={settings.compactTools}
            onChange={(value) => onUpdate('compactTools', value)}
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
