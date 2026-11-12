import * as React from 'react';
import type { SavedPermission } from '../../../../shared/permission';
import type { SidekickSettings } from '../../../shared/config/settings';
import { SettingRow } from '../../../shared/ui/controls/SettingRow';
import { Switch } from '../../../shared/ui/controls/Switch';
import { Icon } from '../../../shared/ui/Icon';
import { SettingsSection } from './SettingsSection';

/**
 * Permission behaviour and the rules "Always allow" stored. The list is read
 * when the drawer opens: the host owns it, the section only asks and shows.
 */
export function SettingsPermissionsSection({
  settings,
  saved,
  error,
  hint,
  onUpdate,
  onRefresh,
  onDelete,
}: {
  settings: SidekickSettings;
  saved: readonly SavedPermission[];
  error: string | null;
  hint: string | null;
  onUpdate: (key: keyof SidekickSettings, value: unknown) => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  // The drawer mounts on open, so one read per open is enough. The ref keeps a
  // new inline callback from re-triggering the read on every render.
  const refresh = React.useRef(onRefresh);
  refresh.current = onRefresh;
  React.useEffect(() => {
    refresh.current();
  }, []);

  return (
    <SettingsSection title="Permissions" description="What the agent may do without asking.">
      <SettingRow
        label="Auto-approve safe tools"
        hint="read, glob, grep, list and find run without a card. Shell, edits, network and external folders always ask."
      >
        <Switch
          checked={settings.permissionsAutoApproveSafe}
          onChange={(value) => onUpdate('permissionsAutoApproveSafe', value)}
        />
      </SettingRow>
      <div className="saved-permissions">
        <div className="saved-permissions-head">Saved rules</div>
        {error ? <div className="saved-permissions-error">{error}</div> : null}
        {hint ? <div className="saved-permissions-hint">{hint}</div> : null}
        {saved.length === 0 && !hint ? (
          <div className="saved-permissions-empty">
            No saved rules yet. Use "Always allow" on a permission card.
          </div>
        ) : null}
        {saved.length > 0 ? (
          <ul className="saved-permissions-list">
            {saved.map((rule) => (
              <li className="saved-permission" key={rule.id}>
                <span className="saved-permission-text" title={`${rule.action} · ${rule.resource}`}>
                  {rule.action}
                  <span className="saved-permission-sep"> · </span>
                  {rule.resource}
                </span>
                <button
                  className="icon-btn"
                  type="button"
                  data-act="saved-permission-delete"
                  aria-label={`Delete rule ${rule.action} ${rule.resource}`}
                  title="Delete this rule"
                  onClick={() => onDelete(rule.id)}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SettingsSection>
  );
}
