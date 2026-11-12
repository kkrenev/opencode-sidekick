import { describe, expect, it } from 'vitest';
import { mapMessages } from '../../../src/message-map';
import { INLINE_IMAGE_LIMIT } from '../../../src/shared/attachment-kind';
import { TOOL_OUTPUT_MAX_CHARS } from '../../../src/shared/tool-card';

const ROOT = '/repo';

describe('mapMessages — user prompt', () => {
  it('keeps the prompt text and maps a file attachment to a workspace path', () => {
    const messages = mapMessages(
      [
        {
          id: 'u1',
          type: 'user',
          time: { created: 10 },
          text: 'hello',
          files: [{ uri: 'file:///repo/src/a.ts', name: 'a.ts' }],
        },
      ],
      [ROOT],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'u1', role: 'user', time: 10 });
    expect(messages[0].parts).toEqual([
      { kind: 'text', text: 'hello' },
      {
        kind: 'file',
        uri: 'file:///repo/src/a.ts',
        name: 'a.ts',
        path: 'src/a.ts',
      },
    ]);
  });

  it('maps a file reported as a content part to the same single attachment', () => {
    const messages = mapMessages(
      [
        {
          id: 'u2',
          type: 'user',
          files: [{ uri: 'file:///repo/a.ts', name: 'a.ts' }],
          content: [{ type: 'file', uri: 'file:///repo/a.ts' }],
        },
      ],
      [ROOT],
    );

    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0]).toMatchObject({ kind: 'file', path: 'a.ts' });
  });

  it('drops a prompt with no text and no attachments', () => {
    expect(mapMessages([{ id: 'u3', type: 'user', text: '   ' }])).toEqual([]);
  });

  it('keeps a small inline image but never leaks a selection payload', () => {
    const inline = 'data:image/png;base64,AAAA';
    const messages = mapMessages(
      [
        {
          id: 'u4',
          type: 'user',
          files: [{ uri: inline, name: 'shot.png' }],
        },
      ],
      [ROOT],
    );

    expect(messages[0].parts[0]).toEqual({
      kind: 'image',
      uri: inline,
      name: 'shot.png',
      mime: 'image/png',
    });
  });

  it('replaces an oversized inline image with its name and a tooLarge flag', () => {
    const huge = `data:image/png;base64,${'A'.repeat(INLINE_IMAGE_LIMIT + 1)}`;
    const messages = mapMessages(
      [{ id: 'u5', type: 'user', files: [{ uri: huge, name: 'huge.png' }] }],
      [ROOT],
    );

    const part = messages[0].parts[0];
    expect(part).toMatchObject({ kind: 'image', name: 'huge.png', tooLarge: true });
    expect(part).not.toHaveProperty('uri');
    expect(JSON.stringify(part)).not.toContain('AAAA');
  });

  it('keeps a text data URI as a file without its payload', () => {
    const messages = mapMessages(
      [
        {
          id: 'u6',
          type: 'user',
          files: [{ uri: 'data:text/plain;base64,SGVsbG8=', name: 'note.txt' }],
        },
      ],
      [ROOT],
    );

    expect(messages[0].parts[0]).toEqual({ kind: 'file', name: 'note.txt', mime: 'text/plain' });
  });
});

describe('mapMessages — assistant parts', () => {
  it('maps a finished shell call with its command, exit code and duration', () => {
    const messages = mapMessages(
      [
        {
          id: 'a1',
          type: 'assistant',
          agent: 'build',
          model: { id: 'openai/gpt-5.1' },
          time: { created: 20, completed: 60 },
          content: [
            {
              type: 'tool',
              id: 't1',
              name: 'shell',
              state: {
                status: 'completed',
                input: { command: 'ls -la', filePath: '/repo/src' },
                output: 'total 0',
                metadata: { exit: 0 },
                time: { created: 100, completed: 150 },
              },
            },
          ],
        },
      ],
      [ROOT],
    );

    expect(messages[0]).toMatchObject({
      id: 'a1',
      role: 'assistant',
      completed: 60,
      agent: 'build',
      model: 'openai/gpt-5.1',
    });
    expect(messages[0].parts[0]).toEqual({
      kind: 'tool',
      id: 't1',
      name: 'shell',
      status: 'ok',
      title: 'ls -la',
      input: '{\n  "command": "ls -la",\n  "filePath": "/repo/src"\n}',
      output: 'total 0',
      path: '/repo/src',
      ms: 50,
      exitCode: 0,
      command: 'ls -la',
    });
  });

  it('maps an edit to its before and after text', () => {
    const messages = mapMessages(
      [
        {
          id: 'a2',
          type: 'assistant',
          content: [
            {
              type: 'tool',
              id: 't2',
              name: 'edit',
              state: {
                status: 'completed',
                input: {
                  filePath: '/repo/src/a.ts',
                  oldString: 'const a = 1;',
                  newString: 'const a = 2;',
                },
              },
            },
          ],
        },
      ],
      [ROOT],
    );

    expect(messages[0].parts[0]).toMatchObject({
      kind: 'tool',
      path: '/repo/src/a.ts',
      edit: { before: 'const a = 1;', after: 'const a = 2;' },
    });
  });

  it('drops an edit pair that would not fit one frame', () => {
    const messages = mapMessages(
      [
        {
          id: 'a3',
          type: 'assistant',
          content: [
            {
              type: 'tool',
              id: 't3',
              name: 'edit',
              state: {
                status: 'completed',
                input: {
                  filePath: '/repo/src/a.ts',
                  oldString: 'a'.repeat(TOOL_OUTPUT_MAX_CHARS),
                  newString: 'b',
                },
              },
            },
          ],
        },
      ],
      [ROOT],
    );

    expect(messages[0].parts[0]).not.toHaveProperty('edit');
  });

  it('reports a server-truncated output and the files a tool returned', () => {
    const messages = mapMessages(
      [
        {
          id: 'a4',
          type: 'assistant',
          content: [
            {
              type: 'tool',
              id: 't4',
              name: 'read',
              state: {
                status: 'completed',
                metadata: { truncated: true },
                content: [
                  { type: 'text', text: 'first' },
                  { type: 'file', uri: 'file:///repo/out/report.png', mime: 'image/png' },
                  { type: 'file', uri: 'file:///repo/out/report.png', mime: 'image/png' },
                ],
              },
            },
          ],
        },
      ],
      [ROOT],
    );

    const part = messages[0].parts[0];
    expect(part).toMatchObject({ outputTruncated: true, output: 'first' });
    expect(part.kind === 'tool' ? part.files : undefined).toEqual([
      {
        kind: 'image',
        uri: 'file:///repo/out/report.png',
        name: 'report.png',
        mime: 'image/png',
        path: 'out/report.png',
      },
    ]);
  });

  it('keeps the duration of a reasoning block and skips an unknown part', () => {
    const messages = mapMessages([
      {
        id: 'a5',
        type: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking', time: { created: 100, completed: 250 } },
          { type: 'step-start' },
          { type: 'reasoning', text: 'still thinking' },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      { kind: 'reasoning', text: 'thinking', ms: 150 },
      { kind: 'reasoning', text: 'still thinking', ms: 0 },
    ]);
  });

  it('skips a message that only carries unknown parts', () => {
    expect(mapMessages([{ id: 'a6', type: 'assistant', content: [{ type: 'step-start' }] }])).toEqual(
      [],
    );
  });
});
