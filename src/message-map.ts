import { RawMessage, RawPart, RawToolState } from './opencode-client';

export type UiPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string; readonly ms: number }
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly name: string;
      readonly status: 'running' | 'ok' | 'error';
      readonly title: string;
      readonly input: string;
      readonly output: string;
    };

export interface UiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly time: number;
  readonly agent?: string;
  readonly model?: string;
  readonly parts: UiPart[];
}

const PATH_KEYS = ['filePath', 'path', 'file', 'filename'];
const PATTERN_KEYS = ['pattern', 'query', 'url', 'description'];

export function mapMessages(messages: readonly RawMessage[]): UiMessage[] {
  const result: UiMessage[] = [];

  for (const message of messages) {
    const role = message.type === 'user' ? 'user' : message.type === 'assistant' ? 'assistant' : undefined;
    if (!role) {
      continue;
    }

    const parts: UiPart[] = [];
    if (role === 'user') {
      const text = typeof message.text === 'string' ? message.text : '';
      if (text.trim().length > 0) {
        parts.push({ kind: 'text', text });
      }
    } else {
      for (const part of message.content ?? []) {
        const mapped = mapPart(part);
        if (mapped) {
          parts.push(mapped);
        }
      }
    }

    if (parts.length === 0) {
      continue;
    }

    result.push({
      id: message.id,
      role,
      time: message.time?.created ?? 0,
      agent: role === 'assistant' ? message.agent : undefined,
      model: message.model?.id,
      parts,
    });
  }

  return result;
}

function mapPart(part: RawPart): UiPart | undefined {
  if (part.type === 'text') {
    const text = part.text ?? '';
    return text.length > 0 ? { kind: 'text', text } : undefined;
  }

  if (part.type === 'reasoning') {
    const text = part.text ?? '';
    if (text.length === 0) {
      return undefined;
    }
    const started = part.time?.created ?? 0;
    const ended = part.time?.completed ?? 0;
    return { kind: 'reasoning', text, ms: ended > started ? ended - started : 0 };
  }

  if (part.type === 'tool') {
    const state = part.state ?? {};
    return {
      kind: 'tool',
      id: part.id ?? part.name ?? 'tool',
      name: part.name ?? 'tool',
      status: toolStatus(state),
      title: toolTitle(part.name ?? 'tool', state),
      input: toolInput(state),
      output: toolOutput(state),
    };
  }

  return undefined;
}

function toolStatus(state: RawToolState): 'running' | 'ok' | 'error' {
  if (state.status === 'error') {
    return 'error';
  }
  if (state.status === 'completed') {
    return 'ok';
  }
  return 'running';
}

function toolTitle(name: string, state: RawToolState): string {
  const input = state.input;
  if (typeof input === 'string') {
    return truncate(input, 90);
  }
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (name === 'shell' || name === 'bash' || name === 'terminal') {
      const command = record.command;
      if (typeof command === 'string') {
        return truncate(command.split('\n')[0], 90);
      }
    }
    for (const key of PATH_KEYS) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    for (const key of PATTERN_KEYS) {
      const value = record[key];
      if (typeof value === 'string') {
        return truncate(value, 90);
      }
    }
  }
  return name;
}

function toolInput(state: RawToolState): string {
  const input = state.input;
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input === 'string') {
    return input;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function toolOutput(state: RawToolState): string {
  if (state.status === 'error') {
    return errorText(state.error);
  }
  if (Array.isArray(state.content)) {
    return state.content
      .map((entry) => {
        if (entry && typeof entry === 'object' && 'text' in entry) {
          const text = (entry as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n');
  }
  if (typeof state.output === 'string') {
    return state.output;
  }
  if (state.output !== undefined) {
    try {
      return JSON.stringify(state.output, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

function errorText(error: unknown): string {
  if (!error) {
    return 'Tool failed';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return record.message;
    }
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return 'Tool failed';
  }
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
