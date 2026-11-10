export type SendKey = 'enter' | 'mod-enter';
export type ReasoningVisibility = 'collapsed' | 'expanded' | 'hidden';
export type AccentColor = 'mint' | 'blue' | 'violet' | 'amber';
export type Density = 'comfortable' | 'compact';
export type FontSize = 'small' | 'default' | 'large';

export interface SidekickSettings {
  readonly defaultModel: string;
  readonly defaultEffort: string;
  readonly defaultMode: string;
  readonly sendKey: SendKey;
  readonly autoScroll: boolean;
  readonly showTimestamps: boolean;
  readonly reasoning: ReasoningVisibility;
  readonly compactTools: boolean;
  readonly accent: AccentColor;
  readonly density: Density;
  readonly fontSize: FontSize;
  readonly cliPath: string;
  readonly autoStartServer: boolean;
}

export const SETTING_DEFAULTS: SidekickSettings = {
  defaultModel: '',
  defaultEffort: '',
  defaultMode: '',
  sendKey: 'enter',
  autoScroll: true,
  showTimestamps: false,
  reasoning: 'collapsed',
  compactTools: true,
  accent: 'mint',
  density: 'comfortable',
  fontSize: 'default',
  cliPath: '',
  autoStartServer: true,
};
