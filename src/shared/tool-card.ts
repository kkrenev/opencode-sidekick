/**
 * Pure view model of a tool card: how much of its output is rendered and how a
 * duration or an exit code is spelled. It must stay free of DOM, React and
 * `vscode` imports: the panel bundles it and `npm run check:tool-card` loads the
 * compiled `out/shared/tool-card.js`.
 *
 * Truncation lives here and only here. `UiPart.input` and `UiPart.output` keep
 * the whole text, because the transcript search scans them; the card renders a
 * window and the search jump expands that window when a hit falls behind it.
 */

/** Lines of tool input or output shown before the card collapses them. */
export const TOOL_OUTPUT_LINES = 200;
/** Characters rendered in either mode; one long line cannot bypass the window. */
export const TOOL_OUTPUT_MAX_CHARS = 200_000;

export interface ToolOutputWindow {
  /** Text the card renders; the rest stays in `UiPart` for the search. */
  readonly text: string;
  /** Whole lines that are not rendered; a char cap may cut one in half. */
  readonly hiddenLines: number;
  readonly hiddenChars: number;
  /** The window stopped at `TOOL_OUTPUT_MAX_CHARS`, not at a line boundary. */
  readonly capped: boolean;
}

/**
 * First `TOOL_OUTPUT_LINES` lines while collapsed, the whole text up to
 * `TOOL_OUTPUT_MAX_CHARS` while expanded. The character cap applies in both
 * modes, so a single line of megabytes is never rendered whole. An empty
 * string stays empty.
 */
export function toolOutputWindow(text: string, expanded: boolean): ToolOutputWindow {
  if (text.length === 0) {
    return { text, hiddenLines: 0, hiddenChars: 0, capped: false };
  }

  const cut = expanded ? text.length : (nthNewline(text, TOOL_OUTPUT_LINES) ?? text.length);
  // The cap wins over the line boundary: one long line must not skip it.
  if (cut > TOOL_OUTPUT_MAX_CHARS) {
    const shown = text.slice(0, TOOL_OUTPUT_MAX_CHARS);
    const hidden = text.slice(TOOL_OUTPUT_MAX_CHARS);
    return {
      text: shown,
      hiddenLines: lineBreaks(hidden),
      hiddenChars: hidden.length,
      capped: true,
    };
  }
  if (cut + 1 >= text.length) {
    return { text, hiddenLines: 0, hiddenChars: 0, capped: false };
  }
  // A CRLF pair belongs to the hidden part, so the visible text never ends
  // with a lone carriage return that `pre` would paint as an extra line.
  const shown = text.slice(0, cut).replace(/\r$/, '');
  const hidden = text.slice(cut + 1);
  return {
    text: shown,
    hiddenLines: lineBreaks(hidden) + 1,
    hiddenChars: text.length - shown.length,
    capped: false,
  };
}

/** `340ms` / `1.2s` / `2m 05s`; empty for a zero, negative or unknown time. */
export function formatDuration(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${trimDecimal(ms / 1000)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  // 59.6 seconds rounds up to a full minute instead of printing `1m 60s`.
  return seconds === 60 ? `${minutes + 1}m 00s` : `${minutes}m ${pad2(seconds)}s`;
}

/** `exit 0`; empty when the tool reported no exit code. */
export function exitLabel(code: number | undefined): string {
  if (typeof code !== 'number' || !Number.isFinite(code)) {
    return '';
  }
  return `exit ${Math.trunc(code)}`;
}

/** Index of the `n`-th newline, or undefined when the text is shorter. */
function nthNewline(text: string, n: number): number | undefined {
  let index = -1;
  for (let line = 0; line < n; line += 1) {
    index = text.indexOf('\n', index + 1);
    if (index === -1) {
      return undefined;
    }
  }
  return index;
}

function lineBreaks(text: string): number {
  let count = 0;
  let index = text.indexOf('\n');
  while (index !== -1) {
    count += 1;
    index = text.indexOf('\n', index + 1);
  }
  return count;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
