import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  contextLimit,
  normalizeThresholds,
  readCompactionTimes,
  readTokens,
  shouldAutoCompact,
  usageAfterCompaction,
  usageFromMessages,
  usageLevel,
  usagePercent,
} = require(resolve(root, 'out/shared/context-usage.js'));

const models = [
  { id: 'big', providerID: 'acme', contextLimit: 200_000 },
  { id: 'small', providerID: 'acme', contextLimit: 8_000 },
  { id: 'no-limit', providerID: 'acme' },
  { id: 'big', providerID: 'other', contextLimit: 32_000 },
];
let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

// used: only the newest assistant turn that reported tokens counts.
check('used is input plus cache read and write of the last completed turn', () => {
  const usage = usageFromMessages([
    { type: 'user' },
    {
      type: 'assistant',
      tokens: { input: 1_000, output: 50, reasoning: 10, cache: { read: 4_000, write: 200 } },
      time: { created: 10 },
    },
  ]);
  assert.deepEqual(usage, { used: 5_200, at: 10 });
});
check('an assistant without tokens is ignored', () => {
  const usage = usageFromMessages([
    {
      type: 'assistant',
      tokens: { input: 100, cache: { read: 900 } },
      time: { created: 5 },
    },
    { type: 'assistant', time: { created: 6 } },
  ]);
  assert.equal(usage.used, 1_000);
  assert.equal(usage.at, 5);
});
check('compaction and user messages never become the used value', () => {
  const usage = usageFromMessages([
    { type: 'user' },
    { type: 'compaction', tokens: { input: 999_999 } },
    { type: 'assistant', tokens: { input: 7 } },
  ]);
  assert.equal(usage.used, 7);
});
check('the newest turn is picked by time, not by array position', () => {
  const usage = usageFromMessages([
    { id: 'msg_b', type: 'assistant', tokens: { input: 500 }, time: { created: 200 } },
    { id: 'msg_a', type: 'assistant', tokens: { input: 100 }, time: { created: 100 } },
  ]);
  assert.deepEqual(usage, { used: 500, at: 200 });
});
check('equal timestamps break the tie by message id', () => {
  const usage = usageFromMessages([
    { id: 'msg_a', type: 'assistant', tokens: { input: 100 }, time: { created: 100 } },
    { id: 'msg_b', type: 'assistant', tokens: { input: 200 }, time: { created: 100 } },
  ]);
  assert.deepEqual(usage, { used: 200, at: 100 });
});
check('a transcript without a completed assistant has no usage', () => {
  assert.equal(usageFromMessages([]), null);
  assert.equal(usageFromMessages([{ type: 'user' }, { type: 'assistant' }]), null);
});
check('a turn at or before the compaction no longer measures the context', () => {
  const messages = [
    { id: 'msg_a', type: 'assistant', tokens: { input: 100 }, time: { created: 100 } },
  ];
  assert.equal(usageAfterCompaction(messages, 100), null);
  assert.equal(usageAfterCompaction(messages, 200), null);
});
check('a turn after the compaction restores the measurement', () => {
  const messages = [
    { id: 'msg_b', type: 'assistant', tokens: { input: 500 }, time: { created: 300 } },
  ];
  assert.deepEqual(usageAfterCompaction(messages, 200), { used: 500, at: 300 });
  assert.deepEqual(usageAfterCompaction(messages, undefined), { used: 500, at: 300 });
});
check('missing token fields read as zero', () => {
  assert.deepEqual(readTokens(undefined), {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.deepEqual(readTokens({ input: -5, cache: { read: 2 } }), {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 2,
    cacheWrite: 0,
  });
});
check('persisted compaction times drop junk entries', () => {
  assert.deepEqual(readCompactionTimes({ a: 10, b: 'x', c: -1, d: 0, e: 5.5 }), {
    a: 10,
    e: 5.5,
  });
  assert.deepEqual(readCompactionTimes(null), {});
  assert.deepEqual(readCompactionTimes([10]), {});
});

// limit: id plus provider, then the default-model fallback.
check('the limit is matched by model id and provider id', () => {
  assert.equal(contextLimit(models, { id: 'big', providerID: 'acme' }), 200_000);
  assert.equal(contextLimit(models, { id: 'big', providerID: 'other' }), 32_000);
});
check('an unknown model falls back to the default selection', () => {
  assert.equal(
    contextLimit(models, { id: 'gone', providerID: 'acme' }, { id: 'small', providerID: 'acme' }),
    8_000,
  );
});
check('no limit means undefined, not zero', () => {
  assert.equal(contextLimit(models, { id: 'no-limit', providerID: 'acme' }), undefined);
  assert.equal(contextLimit(models, undefined, undefined), undefined);
  assert.equal(contextLimit([], { id: 'big', providerID: 'acme' }), undefined);
});
check('a known model without a limit does not borrow the default window', () => {
  assert.equal(
    contextLimit(
      models,
      { id: 'no-limit', providerID: 'acme' },
      { id: 'big', providerID: 'acme' },
    ),
    undefined,
  );
});

// thresholds: clamped to 1..100 and warn always below compact.
check('thresholds keep sane defaults', () => {
  assert.deepEqual(normalizeThresholds(80, 95), { warn: 80, compact: 95 });
});
check('thresholds are clamped into 1..100', () => {
  assert.deepEqual(normalizeThresholds(0, 150), { warn: 1, compact: 100 });
  assert.deepEqual(normalizeThresholds(-20, -5), { warn: 1, compact: 1 });
});
check('a warn at or above compact is pulled below it', () => {
  assert.deepEqual(normalizeThresholds(96, 95), { warn: 90, compact: 95 });
  assert.deepEqual(normalizeThresholds(95, 95), { warn: 90, compact: 95 });
  assert.deepEqual(normalizeThresholds(2, 1), { warn: 1, compact: 1 });
});
check('non-numeric thresholds fall back to defaults', () => {
  assert.deepEqual(normalizeThresholds('x', null), { warn: 80, compact: 95 });
});

// levels: the 80/95 boundaries and the unknown states.
check('80 percent is a warning, 95 starts compaction', () => {
  assert.equal(usageLevel(79_999, 100_000, 80, 95), 'ok');
  assert.equal(usageLevel(80_000, 100_000, 80, 95), 'warn');
  assert.equal(usageLevel(94_999, 100_000, 80, 95), 'warn');
  assert.equal(usageLevel(95_000, 100_000, 80, 95), 'compact');
  assert.equal(usageLevel(120_000, 100_000, 80, 95), 'compact');
});
check('used without a limit is unknown, so auto-compaction stays off', () => {
  assert.equal(usageLevel(null, 100_000, 80, 95), 'unknown');
  assert.equal(usageLevel(90_000, undefined, 80, 95), 'unknown');
  assert.equal(usageLevel(90_000, 0, 80, 95), 'unknown');
  assert.equal(usageLevel(90_000, null, 80, 95), 'unknown');
});
check('the displayed percentage is rounded and capped', () => {
  assert.equal(usagePercent(38_400, 100_000), 38);
  assert.equal(usagePercent(1_200, 1_000), 100);
  assert.equal(usagePercent(null, 1_000), undefined);
  assert.equal(usagePercent(10, undefined), undefined);
});

// auto-compaction: first observation fires, then the episode stays spent.
const autoBase = {
  level: 'compact',
  active: true,
  busy: false,
  compacting: false,
  spent: false,
  sinceLastMs: 60_000,
  cooldownMs: 30_000,
};
check('a session first seen above the threshold compacts automatically', () => {
  assert.equal(shouldAutoCompact(autoBase), true);
});
check('one automatic pass per high-usage episode', () => {
  assert.equal(shouldAutoCompact({ ...autoBase, spent: true }), false);
});
check('busy, compacting, inactive and cooldown block the automatic pass', () => {
  assert.equal(shouldAutoCompact({ ...autoBase, busy: true }), false);
  assert.equal(shouldAutoCompact({ ...autoBase, compacting: true }), false);
  assert.equal(shouldAutoCompact({ ...autoBase, active: false }), false);
  assert.equal(shouldAutoCompact({ ...autoBase, sinceLastMs: 29_999 }), false);
});
check('warn and unknown levels never trigger the automatic pass', () => {
  assert.equal(shouldAutoCompact({ ...autoBase, level: 'warn' }), false);
  assert.equal(shouldAutoCompact({ ...autoBase, level: 'unknown' }), false);
});

if (failures > 0) {
  console.error(`${failures} context-usage check(s) failed`);
  process.exit(1);
}
console.log('context usage: all checks passed');
