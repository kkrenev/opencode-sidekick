import * as React from 'react';
import type {
  AccentColor,
  Density,
  FontSize,
  SidekickSettings,
} from '../../../shared/config/settings';
import { Icon } from '../../../shared/ui/Icon';
import { Segmented } from '../../../shared/ui/controls/Segmented';
import { SettingRow } from '../../../shared/ui/controls/SettingRow';
import { ACCENTS } from '../lib/options';
import { SettingsSection } from './SettingsSection';

export function SettingsAppearanceSection({
  settings,
  onUpdate,
}: {
  settings: SidekickSettings;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
}): React.ReactElement {
  return (
    <SettingsSection title="Appearance" description="Colors and spacing.">
      <SettingRow label="Accent" hint="Panel highlight color.">
        <AccentPicker
          value={settings.accent}
          onChange={(value) => onUpdate('accent', value)}
        />
      </SettingRow>
      <SettingRow label="Density" hint="Spacing between elements.">
        <Segmented<Density>
          value={settings.density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          onChange={(value) => onUpdate('density', value)}
        />
      </SettingRow>
      <SettingRow label="Font size" hint="Base text size.">
        <Segmented<FontSize>
          value={settings.fontSize}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'default', label: 'Default' },
            { value: 'large', label: 'Large' },
          ]}
          onChange={(value) => onUpdate('fontSize', value)}
        />
      </SettingRow>
    </SettingsSection>
  );
}

function AccentPicker({
  value,
  onChange,
}: {
  value: AccentColor;
  onChange: (value: AccentColor) => void;
}): React.ReactElement {
  return (
    <div className="swatches">
      {ACCENTS.map((accent) => (
        <button
          key={accent.value}
          className={`swatch${value === accent.value ? ' active' : ''}`}
          type="button"
          title={accent.label}
          data-setting="accent"
          data-value={accent.value}
          style={{ '--swatch': accent.color } as React.CSSProperties}
          onClick={() => onChange(accent.value)}
        >
          <span />
          {value === accent.value ? <Icon name="checkSmall" /> : null}
        </button>
      ))}
    </div>
  );
}
