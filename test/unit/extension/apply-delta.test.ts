import { describe, expect, it } from 'vitest';
import { applyDelta } from '../../../src/webview/app/model/applyDelta';
import type { AppData } from '../../../src/webview/shared/types/snapshot';
import type { UiMessage } from '../../../src/webview/shared/types/ui';

/** Only `messages` and `agent` matter to the reducer; the rest is a snapshot. */
function snapshot(messages: UiMessage[], agent: string | null = null): AppData {
  return { messages, agent } as unknown as AppData;
}

describe('applyDelta', () => {
  it('appends a text delta to the last text part without mutating the input', () => {
    const data = snapshot([
      { id: 'm1', role: 'assistant', time: 1, parts: [{ kind: 'text', text: 'Hel' }] },
    ]);

    const next = applyDelta(data, 'm1', 'text', 'lo');

    expect(next.messages[0].parts).toEqual([{ kind: 'text', text: 'Hello' }]);
    expect(data.messages[0].parts).toEqual([{ kind: 'text', text: 'Hel' }]);
    expect(next).not.toBe(data);
    expect(next.messages).not.toBe(data.messages);
  });

  it('creates the assistant message when the delta arrives before it', () => {
    const data = snapshot([], 'build');

    const next = applyDelta(data, 'm2', 'text', 'first token');

    expect(next.messages).toEqual([
      {
        id: 'm2',
        role: 'assistant',
        time: expect.any(Number),
        agent: 'build',
        parts: [{ kind: 'text', text: 'first token' }],
      },
    ]);
    expect(data.messages).toEqual([]);
  });

  it('keeps reasoning and text deltas in their own parts', () => {
    const data = snapshot([
      {
        id: 'm3',
        role: 'assistant',
        time: 1,
        parts: [
          { kind: 'text', text: 'answer' },
          { kind: 'reasoning', text: 'why', ms: 4 },
        ],
      },
    ]);

    const reasoned = applyDelta(data, 'm3', 'reasoning', ' not');
    expect(reasoned.messages[0].parts).toEqual([
      { kind: 'text', text: 'answer' },
      { kind: 'reasoning', text: 'why not', ms: 4 },
    ]);

    const texted = applyDelta(reasoned, 'm3', 'text', '!');
    expect(texted.messages[0].parts).toEqual([
      { kind: 'text', text: 'answer!' },
      { kind: 'reasoning', text: 'why not', ms: 4 },
    ]);
  });

  it('pushes a new part when the message has no part of that kind yet', () => {
    const data = snapshot([
      { id: 'm4', role: 'assistant', time: 1, parts: [{ kind: 'text', text: 'answer' }] },
    ]);

    const next = applyDelta(data, 'm4', 'reasoning', 'thinking');

    expect(next.messages[0].parts).toEqual([
      { kind: 'text', text: 'answer' },
      { kind: 'reasoning', text: 'thinking', ms: 0 },
    ]);
  });

  it('appends to the last text part, not to an earlier one', () => {
    const data = snapshot([
      {
        id: 'm5',
        role: 'assistant',
        time: 1,
        parts: [
          { kind: 'text', text: 'before tool' },
          { kind: 'tool', id: 't', name: 'read', status: 'ok', title: 'read', input: '', output: '' },
          { kind: 'text', text: 'after tool' },
        ],
      },
    ]);

    const next = applyDelta(data, 'm5', 'text', '!');

    expect(next.messages[0].parts[2]).toEqual({ kind: 'text', text: 'after tool!' });
    expect(next.messages[0].parts[0]).toEqual({ kind: 'text', text: 'before tool' });
  });
});
