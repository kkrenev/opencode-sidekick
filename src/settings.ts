import * as vscode from 'vscode';
import { normalizeThresholds } from './shared/context-usage';
import {
  AccentColor,
  Density,
  FontSize,
  ReasoningVisibility,
  SendKey,
  SETTING_DEFAULTS,
  SidekickSettings,
  strictBoolean,
  strictQueueDelivery,
} from './shared/settings';

export type { SidekickSettings } from './shared/settings';
export { SETTING_DEFAULTS } from './shared/settings';

export const CONFIG_SECTION = 'opencodeSidekick';

const SETTING_KEYS = new Set<keyof SidekickSettings>([
  'defaultModel',
  'defaultEffort',
  'defaultMode',
  'sendKey',
  'autoScroll',
  'showTimestamps',
  'reasoning',
  'compactTools',
  'accent',
  'density',
  'fontSize',
  'cliPath',
  'autoStartServer',
  'contextWarnPercent',
  'contextCompactPercent',
  'permissionsAutoApproveSafe',
  'queueDelivery',
  'autoAttachActiveFile',
]);

export function isSettingKey(value: string): value is keyof SidekickSettings {
  return SETTING_KEYS.has(value as keyof SidekickSettings);
}

export function readSettings(): SidekickSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const thresholds = normalizeThresholds(
    config.get<number>('contextWarnPercent', SETTING_DEFAULTS.contextWarnPercent),
    config.get<number>('contextCompactPercent', SETTING_DEFAULTS.contextCompactPercent),
  );
  return {
    defaultModel: config.get<string>('defaultModel', SETTING_DEFAULTS.defaultModel),
    defaultEffort: config.get<string>('defaultEffort', SETTING_DEFAULTS.defaultEffort),
    defaultMode: config.get<string>('defaultMode', SETTING_DEFAULTS.defaultMode),
    sendKey: config.get<SendKey>('sendKey', SETTING_DEFAULTS.sendKey),
    autoScroll: config.get<boolean>('autoScroll', SETTING_DEFAULTS.autoScroll),
    showTimestamps: config.get<boolean>('showTimestamps', SETTING_DEFAULTS.showTimestamps),
    reasoning: config.get<ReasoningVisibility>('reasoning', SETTING_DEFAULTS.reasoning),
    compactTools: config.get<boolean>('compactTools', SETTING_DEFAULTS.compactTools),
    accent: config.get<AccentColor>('accent', SETTING_DEFAULTS.accent),
    density: config.get<Density>('density', SETTING_DEFAULTS.density),
    fontSize: config.get<FontSize>('fontSize', SETTING_DEFAULTS.fontSize),
    cliPath: config.get<string>('cliPath', SETTING_DEFAULTS.cliPath),
    autoStartServer: config.get<boolean>('autoStartServer', SETTING_DEFAULTS.autoStartServer),
    contextWarnPercent: thresholds.warn,
    contextCompactPercent: thresholds.compact,
    permissionsAutoApproveSafe: strictBoolean(
      config.get<unknown>('permissionsAutoApproveSafe'),
      SETTING_DEFAULTS.permissionsAutoApproveSafe,
    ),
    queueDelivery: strictQueueDelivery(config.get<unknown>('queueDelivery')),
    autoAttachActiveFile: strictBoolean(
      config.get<unknown>('autoAttachActiveFile'),
      SETTING_DEFAULTS.autoAttachActiveFile,
    ),
  };
}

export async function writeSetting(
  key: keyof SidekickSettings,
  value: unknown,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(key, value, updateTarget(config, key));
}

export async function resetUiSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const keys: (keyof SidekickSettings)[] = [
    'defaultModel',
    'defaultEffort',
    'defaultMode',
    'sendKey',
    'autoScroll',
    'showTimestamps',
    'reasoning',
    'compactTools',
    'accent',
    'density',
    'fontSize',
    'contextWarnPercent',
    'contextCompactPercent',
    'permissionsAutoApproveSafe',
    'queueDelivery',
    'autoAttachActiveFile',
  ];
  for (const key of keys) {
    await config.update(key, SETTING_DEFAULTS[key], updateTarget(config, key));
  }
}

function updateTarget(
  config: vscode.WorkspaceConfiguration,
  key: keyof SidekickSettings,
): vscode.ConfigurationTarget {
  if (typeof config.inspect !== 'function') {
    return vscode.ConfigurationTarget.Global;
  }
  const inspected = config.inspect(key);
  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}
