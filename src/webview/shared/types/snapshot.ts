import type { SidekickSettings } from '../config/settings';
import type {
  AgentEntry,
  CommandEntry,
  DefaultSelection,
  ModelEntry,
  ModelSelection,
  SessionSummary,
  SkillEntry,
} from './domain';
import type { UiMessage } from './ui';

export interface Snapshot {
  readonly connected: boolean;
  readonly error: string | null;
  readonly directory: string;
  readonly workspace: string;
  readonly session: SessionSummary | null;
  readonly sessions: readonly SessionSummary[];
  readonly messages: readonly UiMessage[];
  readonly models: readonly ModelEntry[];
  readonly agents: readonly AgentEntry[];
  readonly commands: readonly CommandEntry[];
  readonly skills: readonly SkillEntry[];
  readonly defaultModel: ModelSelection | null;
  readonly defaults: DefaultSelection;
  readonly settings: SidekickSettings;
  readonly busy: boolean;
  readonly model: ModelSelection | null;
  readonly agent: string | null;
}

export type AppData = Snapshot;
