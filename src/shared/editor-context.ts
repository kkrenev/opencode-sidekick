/**
 * Pure editor-context model: the file, selection or Problems snapshot that a
 * right-click sends to the composer, plus the `@path:start-end` token it turns
 * into. Kept free of the `vscode` API so the line ranges, dedupe and prompt
 * composition can be exercised in node.
 */

export type ContextKind = 'file' | 'selection' | 'problems';

export interface ContextRef {
  readonly kind: ContextKind;
  /** Workspace-relative path used by the mention. */
  readonly path: string;
  /** 1-based first line of a selection. */
  readonly startLine?: number;
  /** 1-based last line of a selection, inclusive. */
  readonly endLine?: number;
  /** Diagnostic count of a Problems attachment. */
  readonly problems?: number;
}

export interface MentionRange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ComposedContext {
  readonly text: string;
  /** Mention ranges of the tokens this call appended, keyed by `@token`. */
  readonly mentions: ReadonlyMap<string, MentionRange>;
}

export interface ProblemItem {
  readonly severity: 'error' | 'warning' | 'info' | 'hint';
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly source?: string;
}

export interface ProblemsDigest {
  readonly text: string;
  /** Total number of problems, including the ones past the cap. */
  readonly count: number;
}

export const PROBLEMS_CAP = 200;

/** Attachment size limit shared by the host and the editor-context checks. */
export const ATTACHMENT_SIZE_LIMIT = 10 * 1024 * 1024;

/** Same token shape `parseAttachments` accepts, so the two never disagree. */
const CONTEXT_TOKEN = /(^|[\s(])@([A-Za-z0-9_.:/-]+)/g;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Turns a VS Code selection into a 1-based, inclusive range. A selection that
 * stops at column 0 does not include that line's text, so the range must not
 * claim the line below it.
 */
export function selectionRange(
  start: { readonly line: number; readonly character: number },
  end: { readonly line: number; readonly character: number },
): { readonly startLine: number; readonly endLine: number } {
  const endLine = end.character === 0 && end.line > start.line ? end.line : end.line + 1;
  return { startLine: start.line + 1, endLine };
}

/** Identity of one context item: a file is its path, a selection adds its range. */
export function contextKey(ref: ContextRef): string {
  if (ref.kind === 'selection' && ref.startLine !== undefined && ref.endLine !== undefined) {
    return `${ref.path}:${ref.startLine}-${ref.endLine}`;
  }
  return ref.path;
}

/** The `@` token a prompt carries for this context. Problems stay mention-free. */
export function contextToken(ref: ContextRef): string {
  if (ref.kind === 'selection' && ref.startLine !== undefined && ref.endLine !== undefined) {
    return `@${ref.path}:${ref.startLine}-${ref.endLine}`;
  }
  return `@${ref.path}`;
}

/** Keeps the first occurrence, so a manual chip never duplicates an auto one. */
export function dedupeRefs(refs: readonly ContextRef[]): ContextRef[] {
  const result: ContextRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.kind}:${contextKey(ref)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(ref);
  }
  return result;
}

/**
 * A selection is read from its line range, so the source file's size does not
 * decide whether it fits; every other attachment carries its own bytes.
 */
export function attachmentFitsLimit(
  size: number,
  context?: ContextRef,
  limit = ATTACHMENT_SIZE_LIMIT,
): boolean {
  if (context?.kind === 'selection') {
    return true;
  }
  return size <= limit;
}

/** Reads a context field that crossed the webview bridge; garbage is dropped. */
export function parseContextRef(value: unknown): ContextRef | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  if (kind !== 'file' && kind !== 'selection' && kind !== 'problems') {
    return undefined;
  }
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (path.length === 0) {
    return undefined;
  }
  if (kind === 'selection') {
    const startLine = readLine(raw.startLine);
    const endLine = readLine(raw.endLine);
    if (startLine === undefined || endLine === undefined || endLine < startLine) {
      return undefined;
    }
    return { kind, path, startLine, endLine };
  }
  if (kind === 'problems') {
    const problems =
      typeof raw.problems === 'number' && Number.isFinite(raw.problems) && raw.problems >= 0
        ? Math.floor(raw.problems)
        : undefined;
    return { kind, path, ...(problems === undefined ? {} : { problems }) };
  }
  return { kind, path };
}

/**
 * Appends the context tokens to the typed text. A token the user already typed
 * is left alone, and an empty draft becomes the tokens without a blank line.
 */
export function composeContextText(
  text: string,
  refs: readonly ContextRef[],
): ComposedContext {
  const body = text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  const present = new Set<string>();
  for (const match of body.matchAll(CONTEXT_TOKEN)) {
    present.add(match[2]);
  }
  const appended: string[] = [];
  for (const ref of dedupeRefs(refs)) {
    // Problems ride as a file attachment with a count; a mention would point
    // at the original file and not at the diagnostics.
    if (ref.kind === 'problems') {
      continue;
    }
    const token = contextToken(ref);
    const bare = token.slice(1);
    if (present.has(bare)) {
      continue;
    }
    present.add(bare);
    appended.push(token);
  }
  const composed =
    appended.length === 0
      ? body
      : body.length === 0
        ? appended.join(' ')
        : `${body}\n\n${appended.join(' ')}`;
  const mentions = new Map<string, MentionRange>();
  if (appended.length > 0) {
    for (const match of composed.matchAll(CONTEXT_TOKEN)) {
      const token = `@${match[2]}`;
      if (!appended.includes(token)) {
        continue;
      }
      const start = (match.index ?? 0) + match[1].length;
      mentions.set(token, { start, end: start + match[2].length + 1, text: token });
    }
  }
  return { text: composed, mentions };
}

/**
 * Renders diagnostics as one attachment body. The list is capped so a file with
 * hundreds of problems cannot flood the prompt; the chip still shows the total.
 */
export function problemsDigest(
  file: string,
  items: readonly ProblemItem[],
  cap = PROBLEMS_CAP,
): ProblemsDigest {
  const sorted = [...items].sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
  const shown = sorted.slice(0, Math.max(0, cap));
  const lines = shown.map(
    (item) =>
      `- ${item.severity} ${item.line}:${item.column} ${item.message}${
        item.source ? ` (${item.source})` : ''
      }`,
  );
  const hidden = sorted.length - shown.length;
  if (hidden > 0) {
    lines.push(`+${hidden} more`);
  }
  return { text: `# Problems: ${file}\n\n${lines.join('\n')}\n`, count: sorted.length };
}

/** Adds the server's 1-based inclusive line range to a `file:` URI. */
export function fileUriWithRange(
  uri: string,
  range?: { readonly startLine: number; readonly endLine: number },
): string {
  if (!range) {
    return uri;
  }
  const hashAt = uri.indexOf('#');
  const beforeHash = hashAt < 0 ? uri : uri.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : uri.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  return `${base}?start=${range.startLine}&end=${range.endLine}${hash}`;
}

/** A `data:` URI carrying exactly the given text, used when a file cannot. */
export function inlineTextUri(text: string): string {
  return `data:text/plain;base64,${base64(text)}`;
}

function readLine(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

/** UTF-8 base64 without `Buffer`, so the module stays usable in the webview. */
function base64(text: string): string {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += BASE64[first >> 2];
    result += BASE64[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    result += second === undefined ? '=' : BASE64[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    result += third === undefined ? '=' : BASE64[third & 0x3f];
  }
  return result;
}
