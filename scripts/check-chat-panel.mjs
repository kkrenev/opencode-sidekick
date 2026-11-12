import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { CHAT_PANEL_VIEW_TYPE, ChatEditorPanel } = require(resolve(root, 'out/chat-panel.js'));

let failures = 0;

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const icons = {
  idle: { path: 'chat-idle.svg' },
  running: { path: 'chat-running.svg' },
  attention: { path: 'chat-attention.svg' },
};

/** Minimal stand-in for a `WebviewPanel` plus its webview. */
function fakePanel() {
  const messageListeners = [];
  const disposeListeners = [];
  const posted = [];
  const panel = {
    title: '',
    iconPath: undefined,
    revealed: 0,
    disposeCalls: 0,
    webview: {
      options: undefined,
      html: '',
      posted,
      onDidReceiveMessage(listener) {
        messageListeners.push(listener);
        return { dispose() {} };
      },
      postMessage(message) {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
    onDidDispose(listener) {
      disposeListeners.push(listener);
      return { dispose() {} };
    },
    reveal() {
      panel.revealed += 1;
    },
    dispose() {
      panel.disposeCalls += 1;
      for (const listener of disposeListeners) {
        listener();
      }
    },
    /** The webview booted and posted a frame. */
    receive(message) {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
  };
  return panel;
}

function harness({ html = async () => '<html>chat</html>' } = {}) {
  const created = [];
  const restored = [];
  const ready = [];
  const disposed = [];
  const messages = [];
  const panel = new ChatEditorPanel({
    extensionUri: { path: '/ext' },
    globalStorageUri: { path: '/storage' },
    html,
    createPanel(viewType, title, column, options) {
      const next = fakePanel();
      next.viewType = viewType;
      next.title = title;
      next.column = column;
      next.options = options;
      created.push(next);
      return next;
    },
    onMessage(message) {
      messages.push(message);
    },
    onReady() {
      ready.push(true);
    },
    onDispose() {
      disposed.push(true);
    },
  });
  return { panel, created, restored, ready, disposed, messages };
}

// show(): one panel for the whole extension, on the requested column.
await check('show creates the singleton panel with the chat document', async () => {
  const { panel, created } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'Fix the build', column: 2 });
  assert.equal(created.length, 1);
  const [first] = created;
  assert.equal(first.viewType, CHAT_PANEL_VIEW_TYPE);
  assert.equal(first.title, 'Fix the build');
  assert.equal(first.column, 2);
  assert.equal(first.webview.html, '<html>chat</html>');
  assert.equal(first.webview.options.enableScripts, true);
  assert.equal(first.options.retainContextWhenHidden, true);
  assert.deepEqual(first.options.localResourceRoots, [
    { path: '/ext' },
    { path: '/storage' },
  ]);
  assert.equal(first.revealed, 1);
  assert.equal(panel.visible, true);
  assert.equal(panel.sessionID, 'ses_1');
});

await check('a second show reveals and retitles the same panel', async () => {
  const { panel, created } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  await panel.show({ sessionID: 'ses_2', title: 'Two', column: 2 });
  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'Two');
  assert.equal(created[0].revealed, 2);
  assert.equal(panel.sessionID, 'ses_2');
});

// The webview may still be booting when the first state goes out.
await check('post holds the newest state until ready and replays it once', async () => {
  const { panel, created, ready } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  const [first] = created;
  panel.post({ type: 'state', state: { step: 1 } });
  panel.post({ type: 'state', state: { step: 2 } });
  panel.post({ type: 'focus', target: 'composer' });
  assert.deepEqual(first.webview.posted, []);
  first.receive({ type: 'ready' });
  assert.deepEqual(first.webview.posted, [{ type: 'state', state: { step: 2 } }]);
  assert.equal(ready.length, 1);
  assert.equal(panel.isReady, true);
  panel.post({ type: 'state', state: { step: 3 } });
  assert.deepEqual(first.webview.posted, [
    { type: 'state', state: { step: 2 } },
    { type: 'state', state: { step: 3 } },
  ]);
});

await check('a second ready is harmless', async () => {
  const { panel, created, ready } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  const [first] = created;
  first.receive({ type: 'ready' });
  first.receive({ type: 'ready' });
  assert.equal(ready.length, 2);
  assert.deepEqual(first.webview.posted, []);
});

await check('messages reach the provider with their type', async () => {
  const { panel, created, messages } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  created[0].receive({ type: 'ready' });
  created[0].receive({ type: 'send', text: 'hello' });
  assert.deepEqual(messages, [
    { type: 'ready' },
    { type: 'send', text: 'hello' },
  ]);
});

// Closing the tab is a UI event: the chat itself is untouched.
await check('closing the tab reports dispose and forgets the panel', async () => {
  const { panel, created, disposed } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  created[0].dispose();
  assert.equal(disposed.length, 1);
  assert.equal(panel.visible, false);
  assert.equal(panel.sessionID, undefined);
  assert.equal(panel.isReady, false);
});

await check('extension shutdown disposes the panel but keeps the target', async () => {
  const { panel, created, disposed } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  panel.dispose();
  assert.equal(created[0].disposeCalls, 1);
  assert.equal(disposed.length, 0);
  assert.equal(panel.visible, false);
});

await check('post without a panel is a no-op', async () => {
  const { panel } = harness();
  panel.post({ type: 'state', state: {} });
  panel.dispose();
  assert.equal(panel.visible, false);
});

// The serializer hands us a panel: nothing new may be created.
await check('restore adopts the serializer panel', async () => {
  const { panel, created } = harness();
  const restoredPanel = fakePanel();
  await panel.restore(restoredPanel, 'ses_9');
  assert.equal(created.length, 0);
  assert.equal(restoredPanel.webview.html, '<html>chat</html>');
  assert.equal(restoredPanel.revealed, 0);
  assert.equal(panel.sessionID, 'ses_9');
  assert.equal(panel.webview, restoredPanel.webview);
});

// Chrome: title and icon follow the session and its status.
await check('syncChrome sets the title and the status icon', async () => {
  const { panel, created } = harness();
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  const [first] = created;
  panel.syncChrome({ title: 'Renamed', status: 'running', icons });
  assert.equal(first.title, 'Renamed');
  assert.equal(first.iconPath, icons.running);
  panel.syncChrome({ title: 'Renamed', status: 'attention', icons });
  assert.equal(first.iconPath, icons.attention);
  panel.syncChrome({ title: 'Renamed', status: 'idle', icons });
  assert.equal(first.iconPath, icons.idle);
});

await check('chrome set before the panel exists is applied on show', async () => {
  const { panel, created } = harness();
  panel.syncChrome({ title: 'Early', status: 'running', icons });
  await panel.show({ sessionID: 'ses_1', title: 'One', column: 2 });
  assert.equal(created[0].title, 'Early');
  assert.equal(created[0].iconPath, icons.running);
});

// A broken document must not leave a half-booted tab behind.
await check('a failing document disposes the panel and rethrows', async () => {
  const { panel, created, disposed } = harness({
    html: async () => {
      throw new Error('main.js is missing');
    },
  });
  await assert.rejects(
    panel.show({ sessionID: 'ses_1', title: 'One', column: 2 }),
    /main\.js is missing/,
  );
  assert.equal(created[0].disposeCalls, 1);
  assert.equal(panel.visible, false);
  assert.equal(disposed.length, 1);
});

if (failures > 0) {
  console.error(`${failures} chat-panel check(s) failed`);
  process.exit(1);
}
console.log('chat panel: all checks passed');
