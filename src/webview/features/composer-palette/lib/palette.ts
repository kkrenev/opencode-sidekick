import type {
  CommandEntry,
  FileEntry,
  SkillEntry,
} from '../../../shared/types/domain';

export type PaletteKind = 'slash' | 'mention';

export interface PaletteItem {
  readonly kind: 'action' | 'command' | 'skill' | 'file';
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly action?: string;
  readonly insert: string;
}

export interface PaletteState {
  readonly kind: PaletteKind;
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export interface LocalCommand {
  readonly name: string;
  readonly action: string;
  readonly description: string;
}

export const LOCAL_COMMANDS: readonly LocalCommand[] = [
  { name: 'new', action: 'new', description: 'Start a new session' },
  { name: 'sessions', action: 'history', description: 'Browse session history' },
  { name: 'models', action: 'models', description: 'Choose a model' },
  { name: 'effort', action: 'effort', description: 'Choose reasoning effort' },
  { name: 'agents', action: 'agents', description: 'Choose an agent mode' },
  { name: 'settings', action: 'settings', description: 'Open panel settings' },
  { name: 'reload', action: 'reload', description: 'Reconnect and reload the panel' },
  { name: 'browser', action: 'browser', description: 'Open the OpenCode UI in a browser' },
  { name: 'terminal', action: 'terminal', description: 'Open OpenCode in the integrated terminal' },
  { name: 'help', action: 'help', description: 'Show composer tips' },
];

export function detectPalette(value: string, caret: number): PaletteState | null {
  const before = value.slice(0, caret);
  const slash = /(^|\n)([ \t]*)\/([^\s]*)$/.exec(before);
  if (slash) {
    return {
      kind: 'slash',
      start: caret - slash[3].length - 1,
      end: caret,
      query: slash[3],
    };
  }
  const mention = /(^|\s)@([^\s]*)$/.exec(before);
  if (mention) {
    return {
      kind: 'mention',
      start: caret - mention[2].length - 1,
      end: caret,
      query: mention[2],
    };
  }
  return null;
}

export function commandPaletteItems(
  commands: readonly CommandEntry[],
  query: string,
): PaletteItem[] {
  const needle = query.toLowerCase();
  const items: PaletteItem[] = [];
  const seen = new Set<string>();
  for (const command of LOCAL_COMMANDS) {
    if (!paletteMatches(needle, `${command.name} ${command.description}`)) {
      continue;
    }
    seen.add(command.name);
    items.push({
      kind: 'action',
      id: command.name,
      label: `/${command.name}`,
      description: command.description,
      action: command.action,
      insert: '',
    });
  }
  for (const command of commands) {
    if (
      seen.has(command.name) ||
      !paletteMatches(needle, `${command.name} ${command.description || ''}`)
    ) {
      continue;
    }
    items.push({
      kind: 'command',
      id: command.name,
      label: `/${command.name}`,
      description: command.description || '',
      insert: `/${command.name} `,
    });
  }
  return items;
}

export function mentionPaletteItems(
  skills: readonly SkillEntry[],
  files: readonly FileEntry[],
  query: string,
): PaletteItem[] {
  const needle = query.toLowerCase();
  const skillItems: PaletteItem[] = skills
    .filter((skill) => paletteMatches(needle, `${skill.id} ${skill.name} ${skill.description || ''}`))
    .map((skill) => ({
      kind: 'skill',
      id: skill.id,
      label: `@${skill.id}`,
      description: skill.description || skill.name,
      insert: `@${skill.id} `,
    }));
  const fileItems: PaletteItem[] = files.map((file) => ({
    kind: 'file',
    id: file.path,
    label: `@${file.path}`,
    description: file.type === 'directory' ? 'folder' : 'file',
    insert: `@${file.path} `,
  }));
  return [...skillItems, ...fileItems];
}

export function matchLocalCommand(text: string): LocalCommand | null {
  const match = /^\/([a-z][a-z-]*)(?:\s+[\s\S]*)?$/.exec(text);
  if (!match) {
    return null;
  }
  return LOCAL_COMMANDS.find((entry) => entry.name === match[1]) || null;
}

function paletteMatches(needle: string, haystack: string): boolean {
  return needle.length === 0 || haystack.toLowerCase().includes(needle);
}
