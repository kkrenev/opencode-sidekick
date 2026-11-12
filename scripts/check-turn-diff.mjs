import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  DIFF_MAX_BYTES,
  diffCacheKey,
  firstChangedLine,
  firstUserMessageAfter,
  isTextPatch,
  PATCH_LINE_LIMIT,
  parsePatch,
  parsePatchLines,
  patchBytes,
  readRevert,
  decideRevert,
  resolveDiffPath,
  revertSummary,
  summarizeTurnDiff,
  truncateMessagesAt,
  turnDiffRequest,
  turnRefs,
} = require(resolve(root, 'out/shared/turn-diff.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const added = [
  'diff --git a/src/a.ts b/src/a.ts',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/src/a.ts',
  '@@ -0,0 +1,3 @@',
  '+one',
  '+two',
  '+three',
].join('\n');

const modified = [
  'diff --git a/src/b.ts b/src/b.ts',
  'index 2222222..3333333 100644',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -10,4 +12,5 @@ function b() {',
  ' context',
  '-old',
  '+new',
  '+extra',
  ' context',
].join('\n');

const deleted = [
  'diff --git a/src/c.ts b/src/c.ts',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/src/c.ts',
  '+++ /dev/null',
  '@@ -1,5 +0,0 @@',
  '-one',
  '-two',
].join('\n');

// firstChangedLine: the target line of the first hunk, 1 without a hunk.
check('an added file starts at its first line', () => {
  assert.equal(firstChangedLine(added), 1);
});

check('a modified file starts at the first target line of the first hunk', () => {
  assert.equal(firstChangedLine(modified), 12);
  assert.equal(
    firstChangedLine('@@ -1,2 +1,3 @@\n a\n@@ -20,1 +21,2 @@\n b'),
    1,
  );
});

check('a deleted file and a patch without hunks open at line 1', () => {
  assert.equal(firstChangedLine(deleted), 1);
  assert.equal(firstChangedLine('diff --git a/x b/x\nBinary files a/x and b/x differ'), 1);
  assert.equal(firstChangedLine(''), 1);
});

// parsePatchLines: header lines win over the add/delete prefixes.
check('patch lines are classified as meta, hunk, add, delete and context', () => {
  const kinds = parsePatchLines(modified).map((line) => line.kind);
  assert.deepEqual(kinds, ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'add', 'ctx']);
  assert.equal(parsePatchLines(modified)[6].text, '-old');
  assert.equal(parsePatchLines(modified)[8].text, '+extra');
});

check('the render limit cuts a long patch instead of returning all of it', () => {
  assert.equal(parsePatchLines('+a\n+b\n+c\n+d', 2).length, 2);
  assert.equal(parsePatchLines('+a', 0).length, 0);
  assert.equal(parsePatchLines('').length, 0);
});

check('header characters inside a hunk stay add and delete lines', () => {
  const patch = '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n---sql comment\n+++new header';
  assert.deepEqual(
    parsePatchLines(patch).map((line) => line.kind),
    ['meta', 'meta', 'hunk', 'del', 'add'],
  );
});

check('parsePatch reports when the render limit cut the patch', () => {
  const full = parsePatch('+a\n+b', 5);
  assert.equal(full.lines.length, 2);
  assert.equal(full.truncated, false);
  const cut = parsePatch('+a\n+b\n+c', 2);
  assert.equal(cut.lines.length, 2);
  assert.equal(cut.truncated, true);
});

check('a patch of exactly the render limit is not truncated', () => {
  const exactLines = Array.from({ length: PATCH_LINE_LIMIT }, (_, index) => `+line${index}`);
  const exact = parsePatch(`${exactLines.join('\n')}\n`, PATCH_LINE_LIMIT);
  assert.equal(exact.lines.length, PATCH_LINE_LIMIT);
  assert.equal(exact.truncated, false);
  const over = parsePatch(`${[...exactLines, '+extra'].join('\n')}\n`, PATCH_LINE_LIMIT);
  assert.equal(over.lines.length, PATCH_LINE_LIMIT);
  assert.equal(over.truncated, true);
});

// turnRefs: steering user messages belong to the turn that started them.
check('steering messages collapse into the turn that started them', () => {
  const turns = turnRefs([
    { id: 'u1', role: 'user', time: 10 },
    { id: 'a1', role: 'assistant', time: 11, completed: 50 },
    { id: 'u2', role: 'user', time: 20 },
    { id: 'u3', role: 'user', time: 60 },
    { id: 'a2', role: 'assistant', time: 61, completed: 70 },
  ]);
  assert.deepEqual(turns, [
    { id: 'u1', time: 10 },
    { id: 'u3', time: 60 },
  ]);
});

check('consecutive turns without steering stay separate', () => {
  const turns = turnRefs([
    { id: 'u1', role: 'user', time: 10 },
    { id: 'a1', role: 'assistant', time: 11, completed: 50 },
    { id: 'u2', role: 'user', time: 60 },
  ]);
  assert.deepEqual(turns, [
    { id: 'u1', time: 10 },
    { id: 'u2', time: 60 },
  ]);
});

// firstUserMessageAfter: the turn starts after the send baseline.
check('the turn starts at the first user message after the baseline', () => {
  const messages = [
    { id: 'u1', role: 'user', time: 10 },
    { id: 'a1', role: 'assistant', time: 11, completed: 50 },
    { id: 'u2', role: 'user', time: 20 },
    { id: 'u3', role: 'user', time: 60 },
  ];
  assert.equal(firstUserMessageAfter(messages, 'u1'), 'u2');
  assert.equal(firstUserMessageAfter(messages, null), 'u1');
  assert.equal(firstUserMessageAfter(messages, undefined), undefined);
  assert.equal(firstUserMessageAfter(messages, 'missing'), undefined);
});

// The panel asks for exactly one turn and never sends a `to` bound.
check('the panel diff request has no to bound', () => {
  const message = turnDiffRequest('7', 'msg_1');
  assert.deepEqual(message, { type: 'diff', requestId: '7', from: 'msg_1' });
  assert.equal('to' in message, false);
});

// summarizeTurnDiff: totals, metadata only, and the server `more` flag.
check('a summary sums additions and deletions without the patches', () => {
  const summary = summarizeTurnDiff(
    [
      { file: 'src/a.ts', patch: added, additions: 3, deletions: 0, status: 'added' },
      { file: 'src/b.ts', patch: modified, additions: 2, deletions: 1, status: 'modified' },
    ],
    'ses_1',
    'msg_1',
  );
  assert.equal(summary.additions, 5);
  assert.equal(summary.deletions, 1);
  assert.equal(summary.files.length, 2);
  assert.equal(summary.truncated, undefined);
  assert.equal('patch' in summary.files[0], false);
  assert.deepEqual(summary.files[0], {
    file: 'src/a.ts',
    additions: 3,
    deletions: 0,
    status: 'added',
    more: undefined,
  });
});

check('a server-truncated file marks the whole turn as truncated', () => {
  const summary = summarizeTurnDiff(
    [
      { file: 'src/a.ts', patch: '', additions: 3, deletions: 0, status: 'added', more: true },
    ],
    'ses_1',
    'msg_1',
  );
  assert.equal(summary.truncated, true);
  assert.equal(summary.files[0].more, true);
});

check('junk counts and an unknown status fall back to zero and modified', () => {
  const summary = summarizeTurnDiff(
    [{ file: 'src/a.ts', patch: '', additions: -4, deletions: 'x', status: 'renamed' }],
    'ses_1',
    'msg_1',
  );
  assert.equal(summary.additions, 0);
  assert.equal(summary.deletions, 0);
  assert.equal(summary.files[0].status, 'modified');
});

// readRevert: any API payload becomes a patch-free revert for the card.
check('a revert keeps the boundary and drops the patches', () => {
  const revert = readRevert({
    messageID: 'msg_7',
    partID: 'prt_1',
    snapshot: 'snp_1',
    files: [
      { file: 'src/a.ts', patch: added, additions: 3, deletions: 0, status: 'added' },
      { file: 'src/b.ts', patch: modified, additions: 2, deletions: 1, status: 'modified', more: true },
    ],
  });
  assert.equal(revert.messageID, 'msg_7');
  assert.equal(revert.files.length, 2);
  assert.equal('patch' in revert.files[0], false);
  assert.deepEqual(revert.files[1], {
    file: 'src/b.ts',
    additions: 2,
    deletions: 1,
    status: 'modified',
    more: true,
  });
});

check('a revert without files and a junk payload', () => {
  assert.deepEqual(readRevert({ messageID: 'msg_7' }), { messageID: 'msg_7' });
  assert.equal(readRevert(undefined), undefined);
  assert.equal(readRevert(null), undefined);
  assert.equal(readRevert({}), undefined);
  assert.equal(readRevert({ messageID: '' }), undefined);
  assert.equal(readRevert({ messageID: 7 }), undefined);
});

// revertSummary: the staged revert reuses the turn card model.
check('a staged revert becomes the card of its boundary turn', () => {
  const summary = revertSummary(
    {
      messageID: 'msg_7',
      files: [
        { file: 'src/a.ts', additions: 3, deletions: 0, status: 'added' },
        { file: 'src/b.ts', additions: 2, deletions: 1, status: 'modified' },
      ],
    },
    'ses_1',
  );
  assert.equal(summary.sessionID, 'ses_1');
  assert.equal(summary.from, 'msg_7');
  assert.equal(summary.additions, 5);
  assert.equal(summary.deletions, 1);
  assert.equal(summary.files.length, 2);
});

check('a session without a revert has no card', () => {
  assert.equal(revertSummary(undefined, 'ses_1'), null);
});

check('a revert without files still has a card, so it can be kept', () => {
  const summary = revertSummary({ messageID: 'msg_7' }, 'ses_1');
  assert.deepEqual(summary.files, []);
  assert.equal(summary.additions, 0);
  assert.equal(summary.from, 'msg_7');
});

// decideRevert: a Session.Info payload only wins in its own epoch.
check('a stale session payload neither adds nor clears the card', () => {
  assert.deepEqual(decideRevert({ messageID: 'msg_7', files: [] }, 'ses_1', 1, 2), {
    action: 'stale',
  });
  assert.deepEqual(decideRevert(undefined, 'ses_1', 1, 2), { action: 'stale' });
});

check('a current payload with a revert sets the card', () => {
  const decision = decideRevert(
    {
      messageID: 'msg_7',
      files: [{ file: 'src/a.ts', additions: 2, deletions: 1, status: 'modified' }],
    },
    'ses_1',
    3,
    3,
  );
  assert.equal(decision.action, 'set');
  assert.equal(decision.summary.from, 'msg_7');
  assert.equal(decision.summary.additions, 2);
  assert.equal(decision.summary.deletions, 1);
});

check('a current payload without a revert clears the card', () => {
  assert.deepEqual(decideRevert(undefined, 'ses_1', 3, 3), { action: 'clear' });
  assert.deepEqual(decideRevert({ messageID: '' }, 'ses_1', 3, 3), { action: 'clear' });
  const empty = decideRevert({ messageID: 'msg_7' }, 'ses_1', 3, 3);
  assert.equal(empty.action, 'set');
  assert.deepEqual(empty.summary.files, []);
});

// truncateMessagesAt: a committed revert drops the boundary and everything after.
check('a committed revert cuts the transcript at its boundary', () => {
  const messages = [{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }, { id: 'a2' }];
  assert.deepEqual(truncateMessagesAt(messages, 'u2'), [{ id: 'u1' }, { id: 'a1' }]);
  assert.deepEqual(truncateMessagesAt(messages, 'u1'), []);
  assert.equal(truncateMessagesAt(messages, 'missing'), messages);
  assert.equal(truncateMessagesAt([], 'u1').length, 0);
});

// isTextPatch: binary markers and NUL bytes are not renderable.
check('binary patches are detected', () => {
  assert.equal(isTextPatch(modified), true);
  assert.equal(isTextPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n'), false);
  assert.equal(isTextPatch('GIT binary patch\nliteral 10\n'), false);
  assert.equal(isTextPatch('+a\u0000b'), false);
  assert.equal(isTextPatch(''), true);
});

// patchBytes: the size cap is measured in UTF-8 bytes, not characters.
check('patch size counts UTF-8 bytes', () => {
  const ascii = { file: 'a', patch: 'abcd', additions: 1, deletions: 0, status: 'modified' };
  const wide = { file: 'b', patch: 'é€😀', additions: 1, deletions: 0, status: 'modified' };
  assert.equal(patchBytes([ascii]), 4);
  assert.equal(patchBytes([wide]), 2 + 3 + 4);
  assert.equal(patchBytes([]), 0);
  assert.equal(DIFF_MAX_BYTES, 8_000_000);
});

// diffCacheKey: one key per session and turn.
check('cache keys separate sessions and turns', () => {
  assert.equal(diffCacheKey('ses_1', 'msg_1'), 'ses_1\u0000msg_1');
  assert.notEqual(diffCacheKey('ses_1', 'msg_1'), diffCacheKey('ses_1', 'msg_2'));
  assert.notEqual(diffCacheKey('ses_1', 'msg_1'), diffCacheKey('ses_2', 'msg_1'));
});

// resolveDiffPath: only workspace-relative paths stay inside the root.
check('relative patch paths resolve inside the root', () => {
  assert.equal(resolveDiffPath('/work/project', 'src/a.ts'), '/work/project/src/a.ts');
  assert.equal(resolveDiffPath('/work/project/', 'src/a.ts'), '/work/project/src/a.ts');
  assert.equal(resolveDiffPath('/work/project', 'src/./nested/b.ts'), '/work/project/src/nested/b.ts');
  assert.equal(resolveDiffPath('/work/project', 'src\\nested\\b.ts'), '/work/project/src/nested/b.ts');
});

check('absolute and escaping paths are rejected', () => {
  assert.equal(resolveDiffPath('/work/project', '../secrets.txt'), undefined);
  assert.equal(resolveDiffPath('/work/project', 'src/../../secrets.txt'), undefined);
  assert.equal(resolveDiffPath('/work/project', '/etc/passwd'), undefined);
  assert.equal(resolveDiffPath('/work/project', 'C:\\Windows\\win.ini'), undefined);
  assert.equal(resolveDiffPath('/work/project', 'C:/Windows/win.ini'), undefined);
  assert.equal(resolveDiffPath('/work/project', ''), undefined);
  assert.equal(resolveDiffPath('/work/project', '.'), undefined);
  assert.equal(resolveDiffPath('', 'src/a.ts'), undefined);
});

if (failures > 0) {
  console.error(`${failures} turn-diff check(s) failed`);
  process.exit(1);
}
console.log('turn diff: all checks passed');
