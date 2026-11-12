import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SurfaceRegistry, frameScope } = require(resolve(root, 'out/shared/chat-surface.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

function surface(id, kind, ready = false) {
  return { id, kind, ready, webview: { id } };
}

function registry() {
  const surfaces = new SurfaceRegistry();
  surfaces.add(surface('sidebar', 'sidebar'));
  surfaces.add(surface('editor', 'editor'));
  return surfaces;
}

// Broadcast: only a webview that finished booting can take a frame.
check('ready lists only the booted surfaces', () => {
  const surfaces = registry();
  assert.deepEqual(surfaces.ready(), []);
  assert.equal(surfaces.hasReady(), false);
  surfaces.markReady('editor');
  assert.deepEqual(
    surfaces.ready().map((entry) => entry.id),
    ['editor'],
  );
  assert.equal(surfaces.hasReady(), true);
  surfaces.markReady('sidebar');
  assert.deepEqual(
    surfaces.ready().map((entry) => entry.id),
    ['sidebar', 'editor'],
  );
});

check('ready is idempotent and ignores an unknown surface', () => {
  const surfaces = registry();
  surfaces.markReady('sidebar');
  surfaces.markReady('sidebar');
  surfaces.markReady('missing');
  assert.deepEqual(
    surfaces.ready().map((entry) => entry.id),
    ['sidebar'],
  );
});

// Active: the surface the user touched, but never a booting one.
check('active falls back to the first ready surface', () => {
  const surfaces = registry();
  surfaces.markReady('editor');
  assert.equal(surfaces.active()?.id, 'editor');
});

check('active prefers the sidebar over the editor when nobody touched them', () => {
  const surfaces = registry();
  surfaces.markReady('sidebar');
  surfaces.markReady('editor');
  assert.equal(surfaces.active()?.id, 'sidebar');
});

check('active follows the last touched surface', () => {
  const surfaces = registry();
  surfaces.markReady('sidebar');
  surfaces.markReady('editor');
  surfaces.markActive('editor');
  assert.equal(surfaces.active()?.id, 'editor');
  surfaces.markActive('sidebar');
  assert.equal(surfaces.active()?.id, 'sidebar');
});

check('a touched but booting surface is not active', () => {
  const surfaces = registry();
  surfaces.markReady('sidebar');
  surfaces.markActive('editor');
  assert.equal(surfaces.active()?.id, 'sidebar');
  surfaces.markReady('editor');
  assert.equal(surfaces.active()?.id, 'editor');
});

check('active ignores an unknown id', () => {
  const surfaces = registry();
  surfaces.markReady('sidebar');
  surfaces.markActive('missing');
  assert.equal(surfaces.active()?.id, 'sidebar');
});

check('active is undefined without a ready surface', () => {
  const surfaces = registry();
  surfaces.markActive('sidebar');
  assert.equal(surfaces.active(), undefined);
});

// Removing the active surface must not leave a dangling pointer.
check('removing the active surface falls back to the remaining one', () => {
  const surfaces = registry();
  surfaces.markReady('sidebar');
  surfaces.markReady('editor');
  surfaces.markActive('editor');
  assert.equal(surfaces.remove('editor')?.id, 'editor');
  assert.equal(surfaces.get('editor'), undefined);
  assert.equal(surfaces.active()?.id, 'sidebar');
  assert.equal(surfaces.remove('editor'), undefined);
  surfaces.remove('sidebar');
  assert.equal(surfaces.active(), undefined);
  assert.equal(surfaces.hasReady(), false);
});

// Frame routing: both surfaces, the active one, or the asker only.
check('shared state and chrome frames reach every surface', () => {
  for (const type of [
    'state',
    'messages',
    'busy',
    'error',
    'delta',
    'autoContext',
    'attachmentRemoved',
    'openHistory',
    'openSettings',
    'closeHistory',
  ]) {
    assert.equal(frameScope({ type }), 'broadcast', type);
  }
});

check('a host-initiated attachment is broadcast, a reply is not', () => {
  assert.equal(frameScope({ type: 'attached' }), 'broadcast');
  assert.equal(frameScope({ type: 'attached', requestId: 'attach-1' }), 'initiator');
});

check('request-scoped frames answer only the surface that asked', () => {
  for (const type of ['attachError', 'attachDone', 'sendRejected', 'files', 'imagePreview', 'queueEdit']) {
    assert.equal(frameScope({ type, requestId: 'r-1' }), 'initiator', type);
    assert.equal(frameScope({ type }), 'initiator', type);
  }
});

check('a session search answer is not a stream push', () => {
  assert.equal(frameScope({ type: 'sessions' }), 'broadcast');
  assert.equal(frameScope({ type: 'sessions', requestId: 'history-2' }), 'initiator');
});

check('focus and toast belong to the active surface', () => {
  assert.equal(frameScope({ type: 'focus' }), 'active');
  assert.equal(frameScope({ type: 'toast' }), 'active');
});

check('an unknown frame falls back to the shared channel', () => {
  assert.equal(frameScope({ type: 'somethingNew' }), 'broadcast');
  assert.equal(frameScope({ type: 'attached', requestId: '' }), 'broadcast');
});

if (failures > 0) {
  console.error(`${failures} chat-surface check(s) failed`);
  process.exit(1);
}
console.log('chat surfaces: all checks passed');
