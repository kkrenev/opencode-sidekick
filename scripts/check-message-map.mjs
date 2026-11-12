import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { mapMessages } = require(resolve(root, 'out/message-map.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const roots = ['/work/project'];
const attachments = '/home/user/.vscode/attachments';
const user = (id, extra) => ({ id, type: 'user', ...extra });
const assistant = (id, content) => ({ id, type: 'assistant', content });

// A `data:` image over the frame budget keeps a placeholder instead of megabytes.
check('an oversized inline image becomes a small placeholder', () => {
  const big = `data:image/png;base64,${'A'.repeat(1_500_001)}`;
  const [message] = mapMessages([assistant('a1', [{ type: 'file', mime: 'image/png', url: big }])]);
  const part = message.parts[0];
  assert.equal(part.kind, 'image');
  assert.equal(part.tooLarge, true);
  assert.equal('uri' in part, false);
  assert.ok(JSON.stringify(part).length < 500, 'the payload never travels with the message');
});

// An inline image that fits keeps its URI; a text payload never does.
check('a small inline image keeps its payload, a selection does not', () => {
  const [message] = mapMessages([
    assistant('a2', [
      { type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' },
      { type: 'file', mime: 'text/plain', name: 'selection.txt', uri: 'data:text/plain;base64,c2Vs' },
    ]),
  ]);
  assert.equal(message.parts[0].kind, 'image');
  assert.equal(message.parts[0].uri, 'data:image/png;base64,AAAA');
  assert.equal(message.parts[1].kind, 'file');
  assert.equal('uri' in message.parts[1], false);
  assert.equal('path' in message.parts[1], false);
});

// A workspace file becomes an image with the path the host can open.
check('a workspace image keeps its relative path', () => {
  const [message] = mapMessages(
    [user('u1', { text: '', files: [{ uri: 'file:///work/project/assets/a.png', name: 'a.png' }] })],
    roots,
  );
  assert.equal(message.parts.length, 1);
  assert.equal(message.parts[0].kind, 'image');
  assert.equal(message.parts[0].path, 'assets/a.png');
});

check('a file in the attachments folder keeps its name and URI', () => {
  const [message] = mapMessages(
    [user('u2', { text: 'look', files: [{ uri: `file://${attachments}/shot.png`, name: 'screenshot.png' }] })],
    roots,
  );
  assert.deepEqual(message.parts[0], { kind: 'text', text: 'look' });
  assert.equal(message.parts[1].kind, 'image');
  assert.equal(message.parts[1].uri, `file://${attachments}/shot.png`);
  assert.equal('path' in message.parts[1], false);
});

// The same file reported in `files` and in `content` is shown once.
check('user files and file parts are deduplicated', () => {
  const [message] = mapMessages(
    [
      user('u3', {
        text: 'x',
        files: [{ uri: 'file:///work/project/a.ts', name: 'a.ts' }],
        content: [{ type: 'file', uri: 'file:///work/project/a.ts', name: 'a.ts' }],
      }),
    ],
    roots,
  );
  assert.equal(message.parts.length, 2);
  assert.equal(message.parts[1].kind, 'file');
});

// Tool results: files of a tool, its path and its 0-based `offset`.
check('a tool result carries its files, path and line', () => {
  const [message] = mapMessages(
    [
      assistant('a3', [
        {
          type: 'tool',
          name: 'read',
          state: {
            status: 'completed',
            input: { filePath: 'src/a.ts', offset: 9 },
            content: [
              { type: 'text', text: 'line' },
              { type: 'file', uri: 'file:///work/project/src/a.ts', mime: 'text/plain', name: 'a.ts' },
            ],
          },
        },
      ]),
    ],
    roots,
  );
  const tool = message.parts[0];
  assert.equal(tool.path, 'src/a.ts');
  assert.equal(tool.line, 10);
  assert.equal(tool.files.length, 1);
  assert.equal(tool.files[0].path, 'src/a.ts');
});

// No webview URI may reach the transcript: the panel mints it per webview.
check('the transcript never carries a preview URI', () => {
  const json = JSON.stringify(
    mapMessages(
      [
        user('u4', { text: 'x', files: [{ uri: `file://${attachments}/shot.png`, name: 'shot.png' }] }),
        assistant('a4', [{ type: 'file', mime: 'image/png', url: 'data:image/png;base64,AAAA' }]),
      ],
      roots,
    ),
  );
  assert.equal(json.includes('previewUri'), false);
  assert.equal(json.includes('vscode-webview'), false);
});

// A prompt with neither text nor files is not part of the thread.
check('a prompt without text and without files is dropped', () => {
  assert.deepEqual(mapMessages([user('u5')]), []);
  assert.deepEqual(mapMessages([user('u6', { text: '   ' })]), []);
});

// The parser never fabricates a text plaque: a blank file entry is a chip.
check('a file entry without a URI or name becomes a chip named attachment', () => {
  const [message] = mapMessages([user('u7', { files: [{}] })], roots);
  assert.equal(message.parts.length, 1);
  assert.equal(message.parts[0].kind, 'file');
  assert.equal(message.parts[0].name, 'attachment');
});

// Tool status, timing, command, exit code and edit text come from the state.
check('a shell result carries its command, exit code and duration', () => {
  const [message] = mapMessages([
    assistant('a5', [
      {
        type: 'tool',
        name: 'shell',
        time: { created: 1000, completed: 1340 },
        state: {
          status: 'completed',
          input: { command: 'npm test\n--watch' },
          metadata: { exit: 2 },
          time: { created: 1000, completed: 1340 },
          content: [{ type: 'text', text: 'out' }],
        },
      },
    ]),
  ]);
  const tool = message.parts[0];
  assert.equal(tool.status, 'ok');
  assert.equal(tool.ms, 340);
  assert.equal(tool.exitCode, 2);
  assert.equal(tool.command, 'npm test\n--watch');
});

// A pending call is queued, not running, and a missing end has no duration.
check('a pending tool is queued and has no duration yet', () => {
  const [message] = mapMessages([
    assistant('a6', [
      {
        type: 'tool',
        name: 'read',
        state: { status: 'pending', input: { filePath: 'src/a.ts' }, time: { created: 10 } },
      },
    ]),
  ]);
  const tool = message.parts[0];
  assert.equal(tool.status, 'queued');
  assert.equal('ms' in tool, false);
  assert.equal('exitCode' in tool, false);
  assert.equal('command' in tool, false);
});

// The server queues a tool call as `streaming`; it must not read as running.
check('a streaming tool is queued', () => {
  const [message] = mapMessages([
    assistant('a6b', [
      { type: 'tool', name: 'shell', state: { status: 'streaming', input: { command: 'ls' } } },
    ]),
  ]);
  assert.equal(message.parts[0].status, 'queued');
});

// `ran` is when execution began, so a running call has no duration yet.
check('a running tool has no duration from its start timestamp', () => {
  const [message] = mapMessages([
    assistant('a6c', [
      {
        type: 'tool',
        name: 'shell',
        state: { status: 'running', input: { command: 'sleep 1' }, time: { created: 1000, ran: 1340 } },
      },
    ]),
  ]);
  const tool = message.parts[0];
  assert.equal(tool.status, 'running');
  assert.equal('ms' in tool, false);
});

check('an error tool keeps its error status', () => {
  const [message] = mapMessages([
    assistant('a7', [
      { type: 'tool', name: 'read', state: { status: 'error', error: 'nope' } },
    ]),
  ]);
  assert.equal(message.parts[0].status, 'error');
  assert.equal(message.parts[0].output, 'nope');
});

// `before` may be empty (a new file), and a server-side cut is flagged.
check('an edit carries before and after, and a truncation note', () => {
  const [message] = mapMessages([
    assistant('a8', [
      {
        type: 'tool',
        name: 'edit',
        state: {
          status: 'completed',
          input: { path: 'src/a.ts', oldString: '', newString: 'next' },
          metadata: { truncated: true },
          time: { created: 5, completed: 25 },
        },
      },
    ]),
  ]);
  const tool = message.parts[0];
  assert.deepEqual(tool.edit, { before: '', after: 'next' });
  assert.equal(tool.outputTruncated, true);
  assert.equal(tool.ms, 20);
});

check('an edit over the frame budget keeps no diff text', () => {
  const [message] = mapMessages([
    assistant('a9', [
      {
        type: 'tool',
        name: 'edit',
        state: {
          input: { path: 'a.ts', oldString: 'x'.repeat(150_000), newString: 'y'.repeat(150_000) },
        },
      },
    ]),
  ]);
  assert.equal('edit' in message.parts[0], false);
});

if (failures > 0) {
  console.error(`${failures} message-map check(s) failed`);
  process.exit(1);
}
console.log('message map: all checks passed');
