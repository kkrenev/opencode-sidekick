import { capitalize, shortModel } from '../../../shared/lib/format';
import type { ModelEntry } from '../../../shared/types/domain';
import type { UiMessage } from '../../../shared/types/ui';

export type ToolGlyph = 'shell' | 'file' | 'search' | 'model';

export function labelFor(message: UiMessage, models: readonly ModelEntry[]): string {
  const agent = message.agent ? capitalize(message.agent) : 'OpenCode';
  const modelEntry = message.model
    ? models.find((entry) => entry.id === message.model)
    : undefined;
  const model = message.model
    ? ` · ${modelEntry ? modelEntry.name : shortModel(message.model)}`
    : '';
  return `${agent}${model}`;
}

export function glyphFor(name: string): ToolGlyph {
  if (name === 'shell' || name === 'bash' || name === 'terminal') {
    return 'shell';
  }
  if (name === 'read' || name === 'write' || name === 'edit' || name === 'patch') {
    return 'file';
  }
  if (name === 'grep' || name === 'glob' || name === 'find') {
    return 'search';
  }
  return 'model';
}
