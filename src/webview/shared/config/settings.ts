export type {
  AccentColor,
  Density,
  FontSize,
  ReasoningVisibility,
  SendKey,
  SidekickSettings,
} from '../../../shared/settings';

export type { QueueDelivery } from '../../../shared/inbox';

export { SETTING_DEFAULTS as DEFAULT_SETTINGS } from '../../../shared/settings';

export type SettingKey = keyof import('../../../shared/settings').SidekickSettings;
