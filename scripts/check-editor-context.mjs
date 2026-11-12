import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  PROBLEMS_CAP,
  attachmentFitsLimit,
  composeContextText,
  contextKey,
  contextToken,
  dedupeRefs,
  fileUriWithRange,
  inlineTextUri,
  parseContextRef,
  problemsDigest,
  selectionRange,
} = require(resolve(root, 'out/shared/editor-context.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

// selectionRange: 1-based and inclusive; a stop at column 0 keeps the line.
check('a selection inside one line covers that line only', () => {
  assert.deepEqual(selectionRange({ line: 2, character: 4 }, { line: 2, character: 9 }), {
    startLine: 3,
    endLine: 3,
  });
});
check('a multi-line selection ends on the last touched line', () => {
  assert.deepEqual(selectionRange({ line: 2, character: 4 }, { line: 6, character: 3 }), {
    startLine: 3,
    endLine: 7,
  });
});
check('a selection that stops at column 0 does not claim the next line', () => {
  assert.deepEqual(selectionRange({ line: 2, character: 4 }, { line: 6, character: 0 }), {
    startLine: 3,
    endLine: 6,
  });
});

// contextToken and contextKey.
check('a file token is its path', () => {
  assert.equal(contextToken({ kind: 'file', path: 'src/a.ts' }), '@src/a.ts');
});
check('a selection token carries the inclusive range', () => {
  assert.equal(
    contextToken({ kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 }),
    '@src/a.ts:3-7',
  );
});
check('a problems token stays a plain path', () => {
  assert.equal(contextToken({ kind: 'problems', path: 'src/a.ts', problems: 2 }), '@src/a.ts');
});
check('a file and a selection of the same path are different keys', () => {
  assert.notEqual(
    contextKey({ kind: 'file', path: 'src/a.ts' }),
    contextKey({ kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 }),
  );
});

// dedupeRefs.
check('duplicate selections collapse to the first one', () => {
  const refs = dedupeRefs([
    { kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 },
    { kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 },
    { kind: 'file', path: 'src/a.ts' },
  ]);
  assert.equal(refs.length, 2);
});

// composeContextText.
check('an empty draft becomes just the tokens', () => {
  const composed = composeContextText('', [
    { kind: 'file', path: 'src/a.ts' },
    { kind: 'selection', path: 'src/b.ts', startLine: 3, endLine: 7 },
  ]);
  assert.equal(composed.text, '@src/a.ts @src/b.ts:3-7');
  assert.equal(composed.mentions.size, 2);
});
check('a typed token is not appended twice', () => {
  const composed = composeContextText('look at @src/a.ts', [
    { kind: 'file', path: 'src/a.ts' },
  ]);
  assert.equal(composed.text, 'look at @src/a.ts');
  assert.equal(composed.mentions.size, 0);
});
check('mentions point at the appended token', () => {
  const composed = composeContextText('why?', [
    { kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 },
  ]);
  assert.equal(composed.text, 'why?\n\n@src/a.ts:3-7');
  const mention = composed.mentions.get('@src/a.ts:3-7');
  assert.ok(mention);
  assert.equal(composed.text.slice(mention.start, mention.end), '@src/a.ts:3-7');
});
check('problems never produce a mention token', () => {
  const composed = composeContextText('fix these', [
    { kind: 'problems', path: 'src/a.ts', problems: 2 },
  ]);
  assert.equal(composed.text, 'fix these');
  assert.equal(composed.mentions.size, 0);
});
check('leading blank lines are dropped', () => {
  const composed = composeContextText('\n\n  hello', [
    { kind: 'file', path: 'src/a.ts' },
  ]);
  assert.equal(composed.text, '  hello\n\n@src/a.ts');
});

// fileUriWithRange.
check('a file URI gains the server range', () => {
  assert.equal(
    fileUriWithRange('file:///work/a.ts', { startLine: 3, endLine: 7 }),
    'file:///work/a.ts?start=3&end=7',
  );
});
check('an existing query is replaced, a hash is kept', () => {
  assert.equal(
    fileUriWithRange('file:///work/a.ts?x=1#L3', { startLine: 3, endLine: 7 }),
    'file:///work/a.ts?start=3&end=7#L3',
  );
});
check('no range keeps the URI untouched', () => {
  assert.equal(fileUriWithRange('file:///work/a.ts'), 'file:///work/a.ts');
});

// inlineTextUri.
check('an inline URI decodes back to the same text', () => {
  const text = 'const x = 1;\n// naïve ✓\n';
  const uri = inlineTextUri(text);
  assert.ok(uri.startsWith('data:text/plain;base64,'));
  assert.equal(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf8'), text);
});

// problemsDigest.
check('problems are sorted by line and keep their count', () => {
  const digest = problemsDigest('src/a.ts', [
    { severity: 'warning', line: 9, column: 2, message: 'late' },
    { severity: 'error', line: 3, column: 1, message: 'early', source: 'ts' },
  ]);
  assert.equal(digest.count, 2);
  assert.equal(
    digest.text,
    '# Problems: src/a.ts\n\n- error 3:1 early (ts)\n- warning 9:2 late\n',
  );
});
check('more than the cap ends with a +N more line', () => {
  const items = Array.from({ length: PROBLEMS_CAP + 100 }, (_, index) => ({
    severity: 'error',
    line: index + 1,
    column: 1,
    message: `problem ${index}`,
  }));
  const digest = problemsDigest('src/a.ts', items);
  assert.equal(digest.count, PROBLEMS_CAP + 100);
  const lines = digest.text.trimEnd().split('\n');
  assert.equal(lines.filter((line) => line.startsWith('- ')).length, PROBLEMS_CAP);
  assert.equal(lines[lines.length - 1], '+100 more');
});

// attachmentFitsLimit: a selection is not rejected by its source file's size.
check('a regular file over the limit does not fit', () => {
  assert.equal(attachmentFitsLimit(20, { kind: 'file', path: 'src/a.ts' }, 10), false);
});
check('a selection fits even when the source file is over the limit', () => {
  assert.equal(
    attachmentFitsLimit(
      20,
      { kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 },
      10,
    ),
    true,
  );
});
check('a file inside the limit fits, and no context is size-checked', () => {
  assert.equal(attachmentFitsLimit(10, { kind: 'file', path: 'src/a.ts' }, 10), true);
  assert.equal(attachmentFitsLimit(20, undefined, 10), false);
});
check('a problems body is still size-checked', () => {
  assert.equal(
    attachmentFitsLimit(20, { kind: 'problems', path: 'src/a.ts', problems: 2 }, 10),
    false,
  );
});

// parseContextRef.
check('a valid selection round-trips', () => {
  assert.deepEqual(
    parseContextRef({ kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 }),
    { kind: 'selection', path: 'src/a.ts', startLine: 3, endLine: 7 },
  );
});
check('a reversed or missing range is dropped', () => {
  assert.equal(
    parseContextRef({ kind: 'selection', path: 'src/a.ts', startLine: 7, endLine: 3 }),
    undefined,
  );
  assert.equal(parseContextRef({ kind: 'selection', path: 'src/a.ts' }), undefined);
});
check('an unknown kind or empty path is dropped', () => {
  assert.equal(parseContextRef({ kind: 'nope', path: 'src/a.ts' }), undefined);
  assert.equal(parseContextRef({ kind: 'file', path: '  ' }), undefined);
  assert.equal(parseContextRef(undefined), undefined);
});
check('problems keep their count and nothing else', () => {
  assert.deepEqual(parseContextRef({ kind: 'problems', path: 'src/a.ts', problems: 4 }), {
    kind: 'problems',
    path: 'src/a.ts',
    problems: 4,
  });
});

if (failures > 0) {
  console.error(`${failures} editor-context check(s) failed`);
  process.exit(1);
}
console.log('editor-context checks passed');
