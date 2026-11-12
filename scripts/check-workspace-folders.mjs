import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  isPinned,
  migrateSelection,
  migrateTabs,
  orderTabs,
  pickDirectory,
  selectionOf,
  setPinned,
  tabsOf,
  writeFolderTabs,
  writeSelection,
} = require(resolve(root, 'out/shared/workspace-folders.js'));

const A = '/work/alpha';
const B = '/work/beta';
const HOME = '/home/dev';
const folders = [A, B];
let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

// pickDirectory: fallbacks and the two auto-switch guards.
check('no folders falls back to home', () => {
  assert.equal(
    pickDirectory({ folders: [], current: A, requested: B, pinned: false, busy: false, fallback: HOME }),
    HOME,
  );
});
check('removed current folder falls back to the first one, even when pinned', () => {
  assert.equal(
    pickDirectory({ folders: [B], current: A, pinned: true, busy: true, fallback: HOME }),
    B,
  );
});
check('editor in another folder switches while not pinned', () => {
  assert.equal(
    pickDirectory({ folders, current: A, requested: B, pinned: false, busy: false, fallback: HOME }),
    B,
  );
});
check('manual choice disables following the editor', () => {
  assert.equal(
    pickDirectory({ folders, current: A, requested: B, pinned: true, busy: false, fallback: HOME }),
    A,
  );
});
check('a running turn disables following the editor', () => {
  assert.equal(
    pickDirectory({ folders, current: A, requested: B, pinned: false, busy: true, fallback: HOME }),
    A,
  );
});
check('editor outside every folder keeps the current folder', () => {
  assert.equal(
    pickDirectory({ folders, current: B, requested: '/tmp/x', pinned: false, busy: false, fallback: HOME }),
    B,
  );
});

// migrateTabs: v1 -> v2, v2 passthrough, folder removal, garbage input.
check('v1 tabs of an existing folder migrate in place', () => {
  const state = migrateTabs({ directory: B, open: ['s1', 's2'], active: 's2' }, folders, HOME);
  assert.deepEqual(state.folders[B], { open: ['s1', 's2'], active: 's2' });
  assert.equal(state.activeDirectory, B);
  assert.deepEqual(tabsOf(state, A), { open: [] });
});
check('v1 active id outside the open list is dropped', () => {
  const state = migrateTabs({ directory: A, open: ['s1'], active: 'gone' }, folders, HOME);
  assert.deepEqual(state.folders[A], { open: ['s1'] });
});
check('v1 tabs of a folder that left the workspace are dropped', () => {
  const state = migrateTabs({ directory: '/work/old', open: ['s1'], active: 's1' }, folders, HOME);
  assert.deepEqual(state.folders, {});
  assert.equal(state.activeDirectory, A);
});
check('v2 state keeps every folder and normalises the active one', () => {
  const state = migrateTabs(
    { activeDirectory: '/work/old', folders: { [A]: { open: ['s1'] }, [B]: { open: ['s2'], active: 's2' } } },
    folders,
    HOME,
  );
  assert.equal(state.activeDirectory, A);
  assert.deepEqual(state.folders[B], { open: ['s2'], active: 's2' });
});
check('junk input degrades to an empty state', () => {
  const state = migrateTabs({ directory: 5, open: 'nope' }, folders, HOME);
  assert.deepEqual(state, { activeDirectory: A, folders: {} });
  assert.deepEqual(migrateTabs(undefined, [], HOME), { activeDirectory: HOME, folders: {} });
});
check('writeFolderTabs leaves other folders untouched', () => {
  const state = migrateTabs({ activeDirectory: A, folders: { [B]: { open: ['s2'] } } }, folders, HOME);
  const next = writeFolderTabs(state, A, { open: ['s1'], active: 's1' });
  assert.deepEqual(tabsOf(next, A), { open: ['s1'], active: 's1' });
  assert.deepEqual(tabsOf(next, B), { open: ['s2'], active: undefined });
  assert.deepEqual(tabsOf(state, A), { open: [] });
});

// pinned: old state without pins, ordering, pin/unpin, stale pins.
check('state written without pins keeps the v2 shape', () => {
  const state = migrateTabs({ activeDirectory: A, folders: { [A]: { open: ['s1', 's2'] } } }, folders, HOME);
  assert.deepEqual(state.folders[A], { open: ['s1', 's2'] });
  assert.equal(isPinned(tabsOf(state, A), 's1'), false);
});
check('stored pins survive a reload in their own order', () => {
  const state = migrateTabs(
    { activeDirectory: A, folders: { [A]: { open: ['s1', 's2', 's3'], pinned: ['s3', 's1'] } } },
    folders,
    HOME,
  );
  assert.deepEqual(tabsOf(state, A), {
    open: ['s1', 's2', 's3'],
    active: undefined,
    pinned: ['s3', 's1'],
  });
  assert.deepEqual(orderTabs(tabsOf(state, A)), ['s3', 's1', 's2']);
  assert.equal(isPinned(tabsOf(state, A), 's3'), true);
  assert.equal(isPinned(tabsOf(state, A), 's2'), false);
});
check('pins of tabs that are no longer open are dropped on read', () => {
  const state = migrateTabs(
    { activeDirectory: A, folders: { [A]: { open: ['s1'], pinned: ['s1', 'gone', 5] } } },
    folders,
    HOME,
  );
  assert.deepEqual(tabsOf(state, A), { open: ['s1'], active: undefined, pinned: ['s1'] });
  const clean = migrateTabs(
    { activeDirectory: A, folders: { [A]: { open: ['s1'], pinned: ['gone'] } } },
    folders,
    HOME,
  );
  assert.deepEqual(tabsOf(clean, A), { open: ['s1'], active: undefined });
});
check('setPinned is idempotent and keeps the first pin position', () => {
  const tabs = { open: ['s1', 's2', 's3'] };
  const once = setPinned(tabs, 's2', true);
  const again = setPinned(once, 's2', true);
  assert.deepEqual(orderTabs(once), ['s2', 's1', 's3']);
  assert.equal(again, once);
  assert.deepEqual(setPinned(once, 's3', true).pinned, ['s2', 's3']);
});
check('unpinning restores the stored order and an unknown tab is ignored', () => {
  const pinned = setPinned({ open: ['s1', 's2'] }, 's1', true);
  assert.deepEqual(setPinned(pinned, 's1', false), { open: ['s1', 's2'], active: undefined });
  assert.deepEqual(setPinned(pinned, 'gone', true), pinned);
});
check('writeFolderTabs keeps pins of the folder it writes and drops closed ones', () => {
  const state = migrateTabs(
    { activeDirectory: A, folders: { [A]: { open: ['s1', 's2'], pinned: ['s2'] }, [B]: { open: ['s9'], pinned: ['s9'] } } },
    folders,
    HOME,
  );
  const closed = writeFolderTabs(state, A, { open: ['s1'], active: 's1', pinned: ['s2'] });
  assert.deepEqual(tabsOf(closed, A), { open: ['s1'], active: 's1' });
  assert.deepEqual(tabsOf(closed, B), { open: ['s9'], active: undefined, pinned: ['s9'] });
  assert.deepEqual(tabsOf(state, A), { open: ['s1', 's2'], active: undefined, pinned: ['s2'] });
});

// migrateSelection: v1 -> v2 and back-compat of the byDirectory shape.
check('v1 selected session migrates to its folder', () => {
  const state = migrateSelection({ directory: B, sessionID: 's2' }, folders, HOME);
  assert.equal(state.activeDirectory, B);
  assert.equal(selectionOf(state, B), 's2');
});
check('v1 selection of a folder that left the workspace is dropped', () => {
  const state = migrateSelection({ directory: '/work/old', sessionID: 's1' }, folders, HOME);
  assert.deepEqual(state.byDirectory, {});
  assert.equal(selectionOf(state, '/work/old'), undefined);
});
check('v2 selection keeps sibling folders', () => {
  const state = migrateSelection(
    { activeDirectory: B, byDirectory: { [A]: 's1', [B]: 's2' } },
    folders,
    HOME,
  );
  const next = writeSelection(state, A, 's3');
  assert.equal(selectionOf(next, A), 's3');
  assert.equal(selectionOf(next, B), 's2');
  assert.equal(next.activeDirectory, B);
});
check('selection junk degrades to an empty map', () => {
  assert.deepEqual(migrateSelection('nope', [], HOME), { activeDirectory: HOME, byDirectory: {} });
});

if (failures > 0) {
  console.error(`${failures} workspace-folder check(s) failed`);
  process.exit(1);
}
console.log('workspace folders: all checks passed');
