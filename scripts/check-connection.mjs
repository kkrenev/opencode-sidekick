import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  RECONNECT_BASE_MS,
  RECONNECT_CAP_MS,
  RECONNECT_JITTER,
  SEEN_EVENT_LIMIT,
  STREAM_STABLE_MS,
  createEventDeduper,
  reconnectDelay,
} = require(resolve(root, 'out/shared/reconnect.js'));
const packageJson = require(resolve(root, 'package.json'));

let failures = 0;

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The middle of the jitter range, which is exactly the exponential step. */
const middle = () => 0.5;

await check('the first retry waits the base delay', async () => {
  assert.equal(RECONNECT_BASE_MS, 1000);
  assert.equal(reconnectDelay(0, middle), RECONNECT_BASE_MS);
  assert.equal(reconnectDelay(1, middle), RECONNECT_BASE_MS * 2);
  assert.equal(reconnectDelay(2, middle), RECONNECT_BASE_MS * 4);
});

// The panel must back off instead of retrying a dead server every 1.5s.
await check('the delay grows until the cap', async () => {
  const steps = [0, 1, 2, 3, 4, 5, 6, 20].map((attempt) => reconnectDelay(attempt, middle));
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(steps[index] >= steps[index - 1], `${steps[index]} < ${steps[index - 1]}`);
  }
  assert.equal(steps[steps.length - 1], RECONNECT_CAP_MS);
  assert.equal(RECONNECT_CAP_MS, 30000);
});

await check('no attempt ever waits longer than the cap', async () => {
  for (const attempt of [0, 4, 5, 9, 40, 1000]) {
    for (const random of [0, 0.5, 1]) {
      const delay = reconnectDelay(attempt, () => random);
      assert.ok(delay <= RECONNECT_CAP_MS, `attempt ${attempt} random ${random} -> ${delay}`);
      assert.ok(delay >= RECONNECT_BASE_MS / 2, `attempt ${attempt} random ${random} -> ${delay}`);
    }
  }
});

await check('the jitter stays inside the declared share', async () => {
  assert.equal(RECONNECT_JITTER, 0.25);
  assert.equal(reconnectDelay(0, () => 0), 750);
  assert.equal(reconnectDelay(0, () => 1), 1250);
  assert.equal(reconnectDelay(3, () => 0), 6000);
  assert.equal(reconnectDelay(3, () => 1), 10000);
});

// A garbage attempt (a counter reset by a bug) must not produce NaN or a
// negative timeout that fires immediately.
await check('an unknown attempt falls back to the base step', async () => {
  for (const attempt of [-1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '2']) {
    assert.equal(reconnectDelay(attempt, middle), RECONNECT_BASE_MS, String(attempt));
  }
});

await check('a random source outside 0..1 is clamped', async () => {
  assert.equal(reconnectDelay(0, () => -5), 750);
  assert.equal(reconnectDelay(0, () => 5), 1250);
  assert.equal(reconnectDelay(0, () => Number.NaN), RECONNECT_BASE_MS);
});

// Dedup: a resubscribed stream replays frames of the turn that was running.
await check('a repeated envelope id is dropped once', async () => {
  const deduper = createEventDeduper();
  assert.equal(deduper.isNew('evt_1'), true);
  assert.equal(deduper.isNew('evt_1'), false);
  assert.equal(deduper.isNew('evt_2'), true);
  assert.equal(deduper.isNew('evt_1'), false);
});

// Frames without an id keep the old behaviour: deltas only move forward and
// structural duplicates are already handled by the host.
await check('a frame without an id is always new', async () => {
  const deduper = createEventDeduper();
  assert.equal(deduper.isNew(undefined), true);
  assert.equal(deduper.isNew(undefined), true);
  assert.equal(deduper.isNew(''), true);
  assert.equal(deduper.isNew(''), true);
});

await check('the oldest id is forgotten at the limit', async () => {
  assert.equal(SEEN_EVENT_LIMIT, 512);
  const deduper = createEventDeduper(3);
  assert.equal(deduper.isNew('a'), true);
  assert.equal(deduper.isNew('b'), true);
  assert.equal(deduper.isNew('c'), true);
  assert.equal(deduper.isNew('a'), false);
  assert.equal(deduper.isNew('d'), true);
  // `a` fell out of the window, so a very old replay passes again.
  assert.equal(deduper.isNew('a'), true);
  assert.equal(deduper.isNew('d'), false);
});

await check('a zero limit disables dedup instead of growing', async () => {
  const deduper = createEventDeduper(0);
  assert.equal(deduper.isNew('evt_1'), true);
  assert.equal(deduper.isNew('evt_1'), true);
});

await check('the buffer keeps at most the configured ids', async () => {
  const deduper = createEventDeduper(SEEN_EVENT_LIMIT);
  for (let index = 0; index < SEEN_EVENT_LIMIT; index += 1) {
    assert.equal(deduper.isNew(`evt_${index}`), true);
  }
  assert.equal(deduper.isNew(`evt_${SEEN_EVENT_LIMIT - 1}`), false);
  assert.equal(deduper.isNew('evt_overflow'), true);
  assert.equal(deduper.isNew('evt_0'), true);
});

// An idle stream carries no frames, so only its age can prove it was healthy:
// a stream open this long starts a fresh backoff on the next drop.
await check('a stream has to stay open five seconds to count as healthy', async () => {
  assert.equal(STREAM_STABLE_MS, 5000);
  assert.ok(STREAM_STABLE_MS < RECONNECT_CAP_MS, 'a healthy stream is shorter than the cap');
});

// The check is only useful when `compile` runs it before the webview build.
await check('package.json runs the check as part of compile', async () => {
  assert.equal(packageJson.scripts['check:connection'], 'node scripts/check-connection.mjs');
  assert.ok(
    packageJson.scripts.compile.includes('npm run check:connection'),
    'check:connection is part of compile',
  );
});

if (failures > 0) {
  console.error(`${failures} connection check(s) failed`);
  process.exit(1);
}
console.log('connection: all checks passed');
