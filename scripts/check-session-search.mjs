import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { fuzzyScore, mergeWorkspaceSessions, rankSessions } = require(
  resolve(root, 'out/shared/session-search.js'),
);

const A = '/work/alpha';
const B = '/work/beta';
let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const session = (id, title, overrides = {}) => ({
  id,
  title,
  updated: 0,
  running: false,
  ...overrides,
});

// fuzzyScore: empty query, case, subsequence, word starts.
check('an empty or blank query scores 0', () => {
  assert.equal(fuzzyScore('Fix login bug', ''), 0);
  assert.equal(fuzzyScore('Fix login bug', '   '), 0);
});
check('matching ignores case', () => {
  assert.equal(fuzzyScore('Fix Login Bug', 'LOGIN'), fuzzyScore('Fix Login Bug', 'login'));
  assert.ok(fuzzyScore('Fix Login Bug', 'login') > 0);
});
check('a subsequence matches and a non-match scores 0', () => {
  assert.ok(fuzzyScore('Fix login bug', 'flb') > 0);
  assert.equal(fuzzyScore('Fix login bug', 'zzz'), 0);
});
check('adjacent characters score higher than the same characters with gaps', () => {
  assert.ok(fuzzyScore('restore', 'rest') > fuzzyScore('rxexsxtore', 'rest'));
});
check('a word start beats a match inside a word', () => {
  assert.ok(fuzzyScore('Search sessions', 'sessions') > fuzzyScore('Obsessions', 'sessions'));
});
check('camelCase counts as a word start', () => {
  assert.ok(fuzzyScore('fixLoginBug', 'login') > fuzzyScore('fixloginbug', 'login'));
});

// mergeWorkspaceSessions: dedupe and the folder of a row.
check('every folder contributes its sessions in order', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('s1', 'One'), session('s2', 'Two')] },
    { directory: B, sessions: [session('s3', 'Three')] },
  ]);
  assert.deepEqual(
    merged.map((entry) => [entry.session.id, entry.directory]),
    [
      ['s1', A],
      ['s2', A],
      ['s3', B],
    ],
  );
});
check('a duplicated id keeps the first row only', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('s1', 'First copy')] },
    { directory: B, sessions: [session('s1', 'Second copy')] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].session.title, 'First copy');
  assert.equal(merged[0].directory, A);
});
check('the directory the server sent wins over the folder that listed it', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('s1', 'Moved', { directory: B })] },
  ]);
  assert.equal(merged[0].directory, B);
});
check('an empty directory on the session falls back to the folder', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('s1', 'Blank', { directory: '' })] },
  ]);
  assert.equal(merged[0].directory, A);
});
check('no sources merge to an empty list', () => {
  assert.deepEqual(mergeWorkspaceSessions([]), []);
});

// rankSessions: order, ties, empty query.
check('an empty query keeps the server recency order', () => {
  const merged = mergeWorkspaceSessions([
    {
      directory: A,
      sessions: [session('s2', 'Beta', { updated: 20 }), session('s1', 'Alpha', { updated: 10 })],
    },
  ]);
  assert.deepEqual(
    rankSessions(merged, '').map((entry) => entry.session.id),
    ['s2', 's1'],
  );
});
check('an empty query puts the newest session of every folder first', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('old', 'Old', { updated: 10 })] },
    { directory: B, sessions: [session('new', 'New', { updated: 30 })] },
  ]);
  assert.deepEqual(
    rankSessions(merged, '').map((entry) => entry.session.id),
    ['new', 'old'],
  );
});
check('a better title match comes first', () => {
  const merged = mergeWorkspaceSessions([
    {
      directory: A,
      sessions: [session('s1', 'Unrelated', { updated: 40 }), session('s2', 'Session restore')],
    },
  ]);
  assert.deepEqual(
    rankSessions(merged, 'session').map((entry) => entry.session.id),
    ['s2', 's1'],
  );
});
check('a server hit without a title match stays at the tail, newest first', () => {
  const merged = mergeWorkspaceSessions([
    {
      directory: A,
      sessions: [
        session('s3', 'Untitled', { updated: 20 }),
        session('s2', 'Session restore', { updated: 10 }),
      ],
    },
    { directory: B, sessions: [session('s1', 'Login help', { updated: 5 })] },
  ]);
  assert.deepEqual(
    rankSessions(merged, 'login').map((entry) => entry.session.id),
    ['s1', 's3', 's2'],
  );
});
check('equal scores and times keep the server order and the input is not mutated', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('s2', 'Chat'), session('s1', 'Chat')] },
  ]);
  const before = merged.map((entry) => entry.session.id);
  assert.deepEqual(
    rankSessions(merged, 'chat').map((entry) => entry.session.id),
    ['s2', 's1'],
  );
  assert.deepEqual(
    merged.map((entry) => entry.session.id),
    before,
  );
});
check('ranking never drops a row', () => {
  const merged = mergeWorkspaceSessions([
    { directory: A, sessions: [session('s1', 'Alpha'), session('s2', 'Beta')] },
    { directory: B, sessions: [session('s3', 'Gamma')] },
  ]);
  assert.equal(rankSessions(merged, 'zzz').length, 3);
});

if (failures > 0) {
  console.error(`${failures} session-search check(s) failed`);
  process.exit(1);
}
console.log('session search: all checks passed');
