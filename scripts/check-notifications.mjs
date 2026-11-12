import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  NOTIFICATION_TITLE_LIMIT,
  attentionCount,
  notificationText,
  notificationTitle,
  shouldNotify,
  shouldNotifyApproval,
  strictNotificationMode,
} = require(resolve(root, 'out/shared/notification.js'));
const { SETTING_DEFAULTS, strictBoolean } = require(resolve(root, 'out/shared/settings.js'));
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

/** A chat the user cannot see, which is where a notification is expected. */
const hidden = { mode: 'all', onlyWhenHidden: true, watched: false, sessionActive: true };
/** Both surfaces open and focused on the chat that just finished. */
const watched = { mode: 'all', onlyWhenHidden: true, watched: true, sessionActive: true };

// Mode matrix: every mode against every outcome of a hidden chat.
await check('all notifies for every outcome', async () => {
  for (const outcome of ['succeeded', 'failed', 'interrupted']) {
    assert.equal(shouldNotify({ ...hidden, outcome }), true, outcome);
  }
});

await check('errors notifies only for a failed turn', async () => {
  assert.equal(shouldNotify({ ...hidden, mode: 'errors', outcome: 'failed' }), true);
  assert.equal(shouldNotify({ ...hidden, mode: 'errors', outcome: 'succeeded' }), false);
  assert.equal(shouldNotify({ ...hidden, mode: 'errors', outcome: 'interrupted' }), false);
});

await check('off never notifies', async () => {
  for (const outcome of ['succeeded', 'failed', 'interrupted']) {
    assert.equal(shouldNotify({ ...hidden, mode: 'off', outcome }), false, outcome);
  }
});

// Visibility: only a watched chat of the finished session stays quiet.
await check('a watched active chat is silent', async () => {
  assert.equal(shouldNotify({ ...watched, outcome: 'succeeded' }), false);
});

await check('onlyWhenHidden=false notifies even while watched', async () => {
  assert.equal(
    shouldNotify({ ...watched, onlyWhenHidden: false, outcome: 'succeeded' }),
    true,
  );
});

await check('a background chat notifies while another one is watched', async () => {
  assert.equal(shouldNotify({ ...watched, sessionActive: false, outcome: 'succeeded' }), true);
});

await check('an unfocused window notifies for the active chat', async () => {
  assert.equal(shouldNotify({ ...watched, watched: false, outcome: 'succeeded' }), true);
});

// A pending permission is not a failure: `errors` keeps it on the badge only.
await check('approvals follow the all mode', async () => {
  assert.equal(shouldNotifyApproval({ ...hidden }), true);
  assert.equal(shouldNotifyApproval({ ...hidden, mode: 'errors' }), false);
  assert.equal(shouldNotifyApproval({ ...hidden, mode: 'off' }), false);
});

await check('an approval on screen stays quiet unless always-on is set', async () => {
  assert.equal(shouldNotifyApproval({ ...watched }), false);
  assert.equal(shouldNotifyApproval({ ...watched, onlyWhenHidden: false }), true);
  assert.equal(shouldNotifyApproval({ ...watched, sessionActive: false }), true);
});

// The badge counts chats, not events: unread and a request on one tab is one.
await check('attention counts chats with a reply or a request', async () => {
  assert.equal(attentionCount([]), 0);
  assert.equal(attentionCount([{ unread: false, permissions: 0 }]), 0);
  assert.equal(attentionCount([{ unread: true, permissions: 0 }]), 1);
  assert.equal(attentionCount([{ unread: false, permissions: 2 }]), 1);
  assert.equal(attentionCount([{ unread: true, permissions: 1 }]), 1);
  assert.equal(
    attentionCount([
      { unread: true, permissions: 0 },
      { unread: false, permissions: 1 },
      { unread: false, permissions: 0 },
    ]),
    2,
  );
});

// Text: the outcome is spelled out, the title is one clipped line.
await check('notification text names the outcome', async () => {
  assert.equal(notificationText('Fix the build', 'succeeded'), 'Turn finished: Fix the build');
  assert.equal(notificationText('Fix the build', 'failed'), 'Turn failed: Fix the build');
  assert.equal(notificationText('Fix the build', 'interrupted'), 'Turn interrupted: Fix the build');
});

await check('a long title is clipped to one line', async () => {
  const long = `${'a'.repeat(NOTIFICATION_TITLE_LIMIT + 40)}   with\nspace`;
  const clipped = notificationTitle(long);
  assert.equal(clipped.length, NOTIFICATION_TITLE_LIMIT);
  assert.ok(clipped.endsWith('…'));
  assert.ok(!clipped.includes('\n'));
  assert.equal(notificationTitle('  Two\nlines  '), 'Two lines');
  assert.equal(notificationTitle('   '), 'Untitled');
  assert.equal(notificationTitle('x'.repeat(NOTIFICATION_TITLE_LIMIT)), 'x'.repeat(NOTIFICATION_TITLE_LIMIT));
});

// Settings: the mode and the visibility switch are declared with the defaults.
await check('settings defaults notify for every turn of a hidden chat', async () => {
  assert.equal(SETTING_DEFAULTS.notifications, 'all');
  assert.equal(SETTING_DEFAULTS.notifyOnlyWhenHidden, true);
});

await check('an unknown mode falls back to the default', async () => {
  assert.equal(strictNotificationMode('all'), 'all');
  assert.equal(strictNotificationMode('errors'), 'errors');
  assert.equal(strictNotificationMode('off'), 'off');
  for (const value of ['', 'ALL', 'none', true, 1, null, undefined, {}, []]) {
    assert.equal(strictNotificationMode(value), 'all', String(value));
  }
  assert.equal(strictNotificationMode('nope', 'errors'), 'errors');
});

await check('the visibility switch only accepts a real boolean', async () => {
  assert.equal(strictBoolean(true), true);
  assert.equal(strictBoolean('false', true), true);
  assert.equal(strictBoolean(undefined, SETTING_DEFAULTS.notifyOnlyWhenHidden), true);
});

await check('package.json declares both settings', async () => {
  const properties = packageJson.contributes.configuration.properties;
  const mode = properties['opencodeSidekick.notifications'];
  assert.ok(mode, 'the notification mode is declared');
  assert.equal(mode.type, 'string');
  assert.deepEqual(mode.enum, ['all', 'errors', 'off']);
  assert.equal(mode.enumDescriptions.length, 3);
  assert.equal(mode.default, 'all');
  const hiddenOnly = properties['opencodeSidekick.notifyOnlyWhenHidden'];
  assert.ok(hiddenOnly, 'the visibility switch is declared');
  assert.equal(hiddenOnly.type, 'boolean');
  assert.equal(hiddenOnly.default, true);
});

if (failures > 0) {
  console.error(`${failures} notification check(s) failed`);
  process.exit(1);
}
console.log('notifications: all checks passed');
