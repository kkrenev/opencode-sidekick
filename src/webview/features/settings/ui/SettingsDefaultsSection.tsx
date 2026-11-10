import * as React from 'react';
import { modelSettingRef, modelSettingValue, variantLabel, variantsFor } from '../../../entities/model/lib/model';
import { primaryAgents } from '../../../entities/agent/lib/agent';
import type { SidekickSettings } from '../../../shared/config/settings';
import type { AgentEntry, DefaultSelection, ModelEntry } from '../../../shared/types/domain';
import { SettingRow } from '../../../shared/ui/controls/SettingRow';
import { SettingsSection } from './SettingsSection';
import { modelsByProvider } from '../lib/options';

export function SettingsDefaultsSection({
  settings,
  models,
  agents,
  defaults,
  onUpdate,
}: {
  settings: SidekickSettings;
  models: readonly ModelEntry[];
  agents: readonly AgentEntry[];
  defaults: DefaultSelection;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
}): React.ReactElement {
  const configuredModel = modelSettingRef(settings.defaultModel);
  const defaultModel = configuredModel ?? defaults.model;
  const variants = variantsFor(models, defaultModel);
  const modes = primaryAgents(agents);

  return (
    <SettingsSection
      title="New session defaults"
      description="Used when you press + or start a session without an explicit selection."
    >
      <SettingRow label="Model" hint="Server default unless overridden.">
        <select
          className="select"
          data-setting="defaultModel"
          value={settings.defaultModel}
          onChange={(event) => onUpdate('defaultModel', event.target.value)}
        >
          <option value="">Server default</option>
          {modelsByProvider(models).map((group) => (
            <optgroup key={group.provider} label={group.provider}>
              {group.models.map((model) => (
                <option key={`${model.providerID}/${model.id}`} value={modelSettingValue(model)}>
                  {model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Effort" hint="Reasoning effort for the default model.">
        <select
          className="select"
          data-setting="defaultEffort"
          value={settings.defaultEffort}
          disabled={variants.length === 0}
          onChange={(event) => onUpdate('defaultEffort', event.target.value)}
        >
          <option value="">Model default</option>
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variantLabel(variant.id)}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Mode" hint="Primary agent used for new sessions.">
        <select
          className="select"
          data-setting="defaultMode"
          value={settings.defaultMode}
          onChange={(event) => onUpdate('defaultMode', event.target.value)}
        >
          <option value="">Server default</option>
          {modes.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </SettingRow>
    </SettingsSection>
  );
}
