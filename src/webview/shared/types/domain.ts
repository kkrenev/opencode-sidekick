export interface ModelVariant {
  readonly id: string;
  readonly effort?: string;
}

export interface ModelSelection {
  readonly id: string;
  readonly providerID: string;
  readonly variant?: string;
}

export interface ModelEntry {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly variants: readonly ModelVariant[];
}

export interface AgentEntry {
  readonly id: string;
  readonly name: string;
  readonly mode?: string;
  readonly hidden?: boolean;
  readonly description?: string;
  readonly model?: ModelSelection;
}

export interface CommandEntry {
  readonly name: string;
  readonly description?: string;
}

export interface SkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface FileEntry {
  readonly path: string;
  readonly type: 'file' | 'directory';
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly created: number;
  readonly updated: number;
  readonly directory?: string;
  readonly running: boolean;
  readonly agent?: string;
  readonly model?: ModelSelection;
}

export interface DefaultSelection {
  readonly model?: ModelSelection;
  readonly effort?: string;
  readonly mode?: string;
}
