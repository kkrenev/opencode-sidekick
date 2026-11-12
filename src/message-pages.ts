import { UiMessage } from './message-map';
import { RawMessage } from './opencode-client';

export const MESSAGE_PAGE_SIZE = 40;
export const MESSAGE_TAIL_SIZE = 30;

export function toAscending(messages: readonly RawMessage[]): RawMessage[] {
  return [...messages].reverse();
}

export function prependMessages(
  current: readonly UiMessage[],
  older: readonly UiMessage[],
): UiMessage[] {
  if (older.length === 0) {
    return current as UiMessage[];
  }
  const result: UiMessage[] = [];
  const seen = new Set<string>();
  for (const message of older) {
    if (seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    result.push(message);
  }
  for (const message of current) {
    if (seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    result.push(message);
  }
  return result;
}

export function mergeTail(
  current: readonly UiMessage[],
  tail: readonly UiMessage[],
): UiMessage[] {
  if (tail.length === 0) {
    return current as UiMessage[];
  }
  const merged = new Map<string, UiMessage>();
  for (const message of current) {
    merged.set(message.id, message);
  }
  for (const message of tail) {
    merged.set(message.id, message);
  }
  const result = [...merged.values()];
  if (result.length === current.length && result.every((message, index) => message === current[index])) {
    return current as UiMessage[];
  }
  return result;
}
