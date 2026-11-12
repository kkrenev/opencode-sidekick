import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  SEARCH_HIT_LIMIT,
  SEARCH_REGION_LIMIT,
  findMatches,
  searchMessages,
  searchRegionKey,
  stepHit,
} = require(resolve(root, 'out/shared/chat-search.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const user = (id, ...texts) => ({
  id,
  role: 'user',
  parts: texts.map((text) => ({ kind: 'text', text })),
});
const assistant = (id, parts) => ({ id, role: 'assistant', parts });
const text = (value) => ({ kind: 'text', text: value });

check('an empty or blank query has no hits', () => {
  const messages = [user('u1', 'hello')];
  assert.deepEqual(searchMessages(messages, ''), { hits: [], truncated: false });
  assert.deepEqual(searchMessages(messages, '   '), { hits: [], truncated: false });
});

check('matching is case-insensitive and offsets stay in the source', () => {
  const { hits } = searchMessages([assistant('a1', [text('Hello HELLO hello')])], 'hello');
  assert.deepEqual(
    hits.map((hit) => [hit.region, hit.offset, hit.length]),
    [
      ['0', 0, 5],
      ['0', 6, 5],
      ['0', 12, 5],
    ],
  );
});

// `İ`.toLowerCase() is two code units; a lowercased haystack would shift every
// later offset by one. The matcher searches the original string instead.
check('unicode text keeps offsets in the original string', () => {
  const afterDotted = searchMessages([user('u1', 'İ abc')], 'abc');
  assert.deepEqual(afterDotted.hits.map((hit) => [hit.offset, hit.length]), [[2, 3]]);

  const dotted = searchMessages([user('u2', 'İstanbul')], 'İstanbul');
  assert.deepEqual(dotted.hits.map((hit) => [hit.offset, hit.length]), [[0, 8]]);

  const sharp = searchMessages([user('u3', 'Straße Straße')], 'straße');
  assert.deepEqual(sharp.hits.map((hit) => hit.offset), [0, 7]);
});

check('regions follow render order, tool output comes last', () => {
  const messages = [
    user('u1', 'needle'),
    assistant('a1', [
      text('needle'),
      { kind: 'reasoning', text: 'needle', ms: 1200 },
      { kind: 'tool', name: 'needle', title: 'needle', input: 'needle', output: 'needle' },
    ]),
  ];
  assert.deepEqual(
    searchMessages(messages, 'needle').hits.map((hit) => searchRegionKey(hit)),
    ['u1:user', 'a1:0', 'a1:1', 'a1:2:name', 'a1:2:title'],
  );
  assert.deepEqual(
    searchMessages(messages, 'needle', { includeOutput: true }).hits.map((hit) =>
      searchRegionKey(hit),
    ),
    [
      'u1:user',
      'a1:0',
      'a1:1',
      'a1:2:name',
      'a1:2:title',
      'a1:2:input',
      'a1:2:output',
    ],
  );
});

check('tool input and output are skipped by default', () => {
  const messages = [
    assistant('a1', [
      { kind: 'tool', name: 'read', title: 'a.ts', input: 'needle-input', output: 'needle-output' },
    ]),
  ];
  assert.deepEqual(searchMessages(messages, 'needle').hits, []);
  const { hits } = searchMessages(messages, 'needle', { includeOutput: true });
  assert.deepEqual(hits.map((hit) => hit.region), ['0:input', '0:output']);
});

check('hidden reasoning is not searched', () => {
  const messages = [assistant('a1', [{ kind: 'reasoning', text: 'secret', ms: 10 }, text('open')])];
  assert.equal(searchMessages(messages, 'secret').hits.length, 1);
  assert.deepEqual(searchMessages(messages, 'secret', { includeReasoning: false }).hits, []);
});

check('the hit list stops at the limit and reports truncation', () => {
  const capped = searchMessages([user('u1', 'a'.repeat(SEARCH_HIT_LIMIT + 20))], 'a');
  assert.equal(capped.hits.length, SEARCH_HIT_LIMIT);
  assert.equal(capped.truncated, true);

  const exact = searchMessages([user('u1', 'a'.repeat(SEARCH_HIT_LIMIT))], 'a');
  assert.equal(exact.hits.length, SEARCH_HIT_LIMIT);
  assert.equal(exact.truncated, false);
});

check('a region over the character limit is not scanned', () => {
  const tooLong = `${'x'.repeat(SEARCH_REGION_LIMIT)}needle`;
  assert.deepEqual(searchMessages([user('u1', tooLong)], 'needle').hits, []);

  const atLimit = `${'x'.repeat(SEARCH_REGION_LIMIT - 6)}needle`;
  assert.equal(searchMessages([user('u1', atLimit)], 'needle').hits.length, 1);
});

check('the user region joins text parts the way the bubble does', () => {
  const { hits } = searchMessages([user('u1', 'first', 'second')], 'second');
  assert.deepEqual(hits.map((hit) => [hit.region, hit.offset]), [['user', 6]]);
});

check('regex characters in the query are literal', () => {
  const messages = [user('u1', 'a.*[ b')];
  assert.deepEqual(
    searchMessages(messages, '.*[').hits.map((hit) => [hit.offset, hit.length]),
    [[1, 3]],
  );
  assert.deepEqual(searchMessages(messages, 'a+b').hits, []);
  assert.deepEqual(searchMessages(messages, '\\').hits, []);
});

check('findMatches mirrors the search inside a text node', () => {
  assert.deepEqual(findMatches('Hello hello', 'HELLO'), [
    { offset: 0, length: 5 },
    { offset: 6, length: 5 },
  ]);
  assert.deepEqual(findMatches('abc', ''), []);
  assert.deepEqual(findMatches('', 'a'), []);
});

check('stepHit cycles and stays at zero for an empty result', () => {
  assert.equal(stepHit(3, 0, 1), 1);
  assert.equal(stepHit(3, 2, 1), 0);
  assert.equal(stepHit(3, 0, -1), 2);
  assert.equal(stepHit(1, 0, 1), 0);
  assert.equal(stepHit(0, 0, 1), 0);
  assert.equal(stepHit(0, 5, -1), 0);
  assert.equal(stepHit(4, 9, 1), 1);
});

if (failures > 0) {
  console.error(`${failures} chat-search check(s) failed`);
  process.exit(1);
}
console.log('chat search: all checks passed');
