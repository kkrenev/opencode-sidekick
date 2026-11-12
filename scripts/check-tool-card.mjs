import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  TOOL_OUTPUT_LINES,
  TOOL_OUTPUT_MAX_CHARS,
  exitLabel,
  formatDuration,
  toolOutputWindow,
} = require(resolve(root, 'out/shared/tool-card.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const lines = (count) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');

// A 10k-line tool result is the case that used to freeze the panel.
check('a collapsed window keeps the first 200 lines of 10 000', () => {
  const text = lines(10_000);
  const window = toolOutputWindow(text, false);
  const shown = window.text.split('\n');
  assert.equal(TOOL_OUTPUT_LINES, 200);
  assert.equal(shown.length, 200);
  assert.equal(shown[0], 'line 1');
  assert.equal(shown[199], 'line 200');
  assert.equal(window.hiddenLines, 9800);
  assert.equal(window.hiddenChars, text.length - window.text.length);
  assert.equal(window.capped, false);
  assert.equal(window.text.endsWith('\n'), false);
});

check('expanding a 10k-line result shows all of it', () => {
  const text = lines(10_000);
  const window = toolOutputWindow(text, true);
  assert.equal(window.text, text);
  assert.equal(window.hiddenLines, 0);
  assert.equal(window.hiddenChars, 0);
  assert.equal(window.capped, false);
});

// A single line over the char budget is cut by characters in both modes.
check('an expanded window stops at the character cap', () => {
  const text = 'x'.repeat(TOOL_OUTPUT_MAX_CHARS + 1000);
  const window = toolOutputWindow(text, true);
  assert.equal(window.text.length, TOOL_OUTPUT_MAX_CHARS);
  assert.equal(window.hiddenChars, 1000);
  assert.equal(window.capped, true);
});

check('a collapsed single line is capped by characters too', () => {
  const text = 'x'.repeat(TOOL_OUTPUT_MAX_CHARS + 1000);
  const window = toolOutputWindow(text, false);
  assert.equal(window.text.length, TOOL_OUTPUT_MAX_CHARS);
  assert.equal(window.hiddenChars, 1000);
  assert.equal(window.hiddenLines, 0);
  assert.equal(window.capped, true);
});

check('a collapsed window stops at the character cap before the line limit', () => {
  const text = Array.from({ length: 300 }, () => 'x'.repeat(2000)).join('\n');
  const window = toolOutputWindow(text, false);
  assert.equal(window.text.length, TOOL_OUTPUT_MAX_CHARS);
  assert.equal(window.hiddenChars, text.length - TOOL_OUTPUT_MAX_CHARS);
  assert.equal(window.capped, true);
});

// The card hides the toggle when expanding adds nothing: a collapsed char cap
// already renders exactly what the expanded window would.
check('expanding a capped collapsed window adds nothing', () => {
  const text = 'x'.repeat(TOOL_OUTPUT_MAX_CHARS + 1000);
  assert.equal(
    toolOutputWindow(text, true).text.length,
    toolOutputWindow(text, false).text.length,
  );
});

check('expanding a line-cut window adds the hidden lines', () => {
  const text = lines(1000);
  assert.ok(toolOutputWindow(text, true).text.length > toolOutputWindow(text, false).text.length);
});

check('the cap counts lines behind it', () => {
  const text = `${'x'.repeat(TOOL_OUTPUT_MAX_CHARS)}\nsecond\nthird`;
  const window = toolOutputWindow(text, true);
  assert.equal(window.text, 'x'.repeat(TOOL_OUTPUT_MAX_CHARS));
  assert.equal(window.hiddenLines, 2);
  assert.equal(window.capped, true);
});

check('a short result and an empty result are not truncated', () => {
  assert.deepEqual(toolOutputWindow('', false), {
    text: '',
    hiddenLines: 0,
    hiddenChars: 0,
    capped: false,
  });
  assert.deepEqual(toolOutputWindow('one\ntwo', true), {
    text: 'one\ntwo',
    hiddenLines: 0,
    hiddenChars: 0,
    capped: false,
  });
  assert.deepEqual(toolOutputWindow(lines(TOOL_OUTPUT_LINES), false), {
    text: lines(TOOL_OUTPUT_LINES),
    hiddenLines: 0,
    hiddenChars: 0,
    capped: false,
  });
});

// The visible part of a CRLF result must not end with a lone carriage return.
check('a CRLF result is cut on a line boundary', () => {
  const text = lines(TOOL_OUTPUT_LINES + 1).replace(/\n/g, '\r\n');
  const window = toolOutputWindow(text, false);
  assert.equal(window.text.endsWith('\r'), false);
  assert.equal(window.text.endsWith('\n'), false);
  assert.equal(window.text.split('\r\n').length, TOOL_OUTPUT_LINES);
  assert.equal(window.hiddenLines, 1);
});

check('durations read as milliseconds, seconds and minutes', () => {
  assert.equal(formatDuration(340), '340ms');
  assert.equal(formatDuration(1200), '1.2s');
  assert.equal(formatDuration(1000), '1s');
  assert.equal(formatDuration(59_000), '59s');
  assert.equal(formatDuration(125_000), '2m 05s');
  assert.equal(formatDuration(119_600), '2m 00s');
});

check('an unknown or zero duration is not spelled', () => {
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(-5), '');
  assert.equal(formatDuration(undefined), '');
  assert.equal(formatDuration(Number.NaN), '');
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), '');
});

check('an exit code is spelled, an absent one is not', () => {
  assert.equal(exitLabel(0), 'exit 0');
  assert.equal(exitLabel(2), 'exit 2');
  assert.equal(exitLabel(undefined), '');
  assert.equal(exitLabel(Number.NaN), '');
});

if (failures > 0) {
  console.error(`${failures} tool-card check(s) failed`);
  process.exit(1);
}
console.log('tool card: all checks passed');
