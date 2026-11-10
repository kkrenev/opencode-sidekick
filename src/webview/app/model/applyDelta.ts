import type { AppData } from '../../shared/types/snapshot';

export function applyDelta(
  data: AppData,
  messageID: string,
  kind: 'text' | 'reasoning',
  delta: string,
): AppData {
  const messages = [...data.messages];
  const index = messages.findIndex((message) => message.id === messageID);
  if (index < 0) {
    messages.push({
      id: messageID,
      role: 'assistant',
      time: Date.now(),
      agent: data.agent ?? undefined,
      parts: [
        kind === 'text'
          ? { kind: 'text', text: delta }
          : { kind: 'reasoning', text: delta, ms: 0 },
      ],
    });
    return { ...data, messages };
  }
  const message = messages[index];
  const parts = [...message.parts];
  let partIndex = -1;
  for (let cursor = parts.length - 1; cursor >= 0; cursor -= 1) {
    if (parts[cursor].kind === kind) {
      partIndex = cursor;
      break;
    }
  }
  if (partIndex < 0) {
    parts.push(
      kind === 'text'
        ? { kind: 'text', text: delta }
        : { kind: 'reasoning', text: delta, ms: 0 },
    );
  } else {
    const part = parts[partIndex];
    if (part.kind === 'text') {
      parts[partIndex] = { ...part, text: part.text + delta };
    } else if (part.kind === 'reasoning') {
      parts[partIndex] = { ...part, text: part.text + delta };
    }
  }
  messages[index] = { ...message, parts };
  return { ...data, messages };
}
