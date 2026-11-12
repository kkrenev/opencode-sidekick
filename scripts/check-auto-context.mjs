import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bridge contract for the automatic active-file chip. `src/sidekick-view.ts`
 * imports `vscode`, so the host frame cannot be executed here; the check reads
 * the exact method and the webview handler to make sure both sides use the
 * `autoContext` field. A host that posts `attachment` instead makes the chip
 * disappear, which is what this guards against.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const host = read('src/sidekick-view.ts');
const webview = read('src/webview/app/model/useAttachments.ts');
const protocol = read('src/webview/shared/api/protocol.ts');

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const hostFrame = /private postAutoContext\([\s\S]*?\n  \}/.exec(host)?.[0] ?? '';

check('the host posts the autoContext field, not attachment', () => {
  assert.ok(hostFrame.length > 0, 'postAutoContext was not found');
  assert.match(hostFrame, /type:\s*'autoContext'/);
  assert.match(hostFrame, /autoContext:\s*attachment\s*\?\?\s*null/);
  assert.doesNotMatch(hostFrame, /attachment:\s*attachment\s*\?\?\s*null/);
});

check('the host frame names the chat', () => {
  assert.match(hostFrame, /sessionID:\s*this\.session\.id/);
});

check('the host frame names the folder', () => {
  assert.match(hostFrame, /directory:\s*this\.activeDirectory/);
});

check('the webview listens for the autoContext frame', () => {
  assert.match(webview, /message\.type === 'autoContext'/);
});

check('the webview reads the autoContext field', () => {
  assert.match(webview, /message\.autoContext/);
});

check('the protocol carries the autoContext field', () => {
  assert.match(protocol, /autoContext\?:\s*PendingAttachment \| null;/);
});

if (failures > 0) {
  console.error(`${failures} auto-context bridge check(s) failed`);
  process.exit(1);
}
console.log('auto-context bridge checks passed');
