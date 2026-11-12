/**
 * Turn diff model shared by the host, the chat card and the diff panel.
 *
 * The server reports one turn as `FileDiff.Info[]`; the patch text can be large
 * (hundreds of KB for a real session), so it never goes into the chat snapshot:
 * the card carries totals and metadata, the panel fetches the patches on demand.
 */

export type FileDiffStatus = 'added' | 'deleted' | 'modified';

/** `FileDiff.Info` of the OpenCode API. */
export interface FileDiffInfo {
  readonly file: string;
  readonly patch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: FileDiffStatus;
  /** The server cut the patch of this file. */
  readonly more?: boolean;
}

/** One file of a turn without its patch. */
export interface TurnDiffFile {
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: FileDiffStatus;
  readonly more?: boolean;
}

/** Fields a summary needs; a patch-carrying entry satisfies it too. */
export interface DiffTotals {
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: FileDiffStatus;
  readonly more?: boolean;
}

/**
 * `Session.Revert` of the API: the user message a staged revert goes back to
 * and the files the stage already changed on disk. Patches are dropped on the
 * way in, so a revert can live in the chat snapshot.
 */
export interface RevertInfo {
  readonly messageID: string;
  readonly files?: readonly TurnDiffFile[];
}

/** Totals of one turn, rendered by the footer card. */
export interface TurnDiffSummary {
  readonly sessionID: string;
  readonly from: string;
  readonly additions: number;
  readonly deletions: number;
  readonly files: readonly TurnDiffFile[];
  /** At least one file was cut by the server or by the local size cap. */
  readonly truncated?: boolean;
}

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'ctx';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/** One user message the panel can navigate to. */
export interface TurnRef {
  readonly id: string;
  readonly time: number;
}

/** The message fields needed to group user messages into turns. */
export interface TurnMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly time: number;
  /** Completion time of an assistant message; steering lands before it. */
  readonly completed?: number;
}

/** Host → panel: the turn to show and the turns around it. */
export interface TurnDiffInit {
  readonly sessionID: string;
  readonly title: string;
  readonly directory: string;
  readonly turns: readonly TurnRef[];
  readonly from: string;
}

/** Host → panel: patches of one turn. */
export interface TurnDiffResult {
  readonly requestId: string;
  readonly sessionID: string;
  readonly from: string;
  readonly files: readonly FileDiffInfo[];
  readonly truncated?: boolean;
  /** The patches exceeded `DIFF_MAX_BYTES` and were replaced with metadata. */
  readonly tooLarge?: boolean;
}

/**
 * Panel → host: fetch exactly the turn that starts at `from`. There is no
 * `to`: the server treats it as an upper bound that extends the range to the
 * turn starting there, which would show two turns at once.
 */
export interface TurnDiffRequest {
  readonly type: 'diff';
  readonly requestId: string;
  readonly from: string;
}

export function turnDiffRequest(requestId: string, from: string): TurnDiffRequest {
  return { type: 'diff', requestId, from };
}

/** Lines of context the panel asks the server for. */
export const DIFF_CONTEXT = 3;
/** Patches above this size are listed without content. */
export const DIFF_MAX_BYTES = 8_000_000;
/** Turns kept in the host cache; the newest wins. */
export const TURN_DIFF_CACHE_LIMIT = 30;
/** Lines rendered per file; a larger patch is cut instead of freezing the panel. */
export const PATCH_LINE_LIMIT = 4000;

export function summarizeTurnDiff(
  files: readonly DiffTotals[],
  sessionID: string,
  from: string,
): TurnDiffSummary {
  let additions = 0;
  let deletions = 0;
  let truncated = false;
  const entries: TurnDiffFile[] = [];

  for (const file of files) {
    const fileAdditions = count(file.additions);
    const fileDeletions = count(file.deletions);
    additions += fileAdditions;
    deletions += fileDeletions;
    if (file.more === true) {
      truncated = true;
    }
    entries.push({
      file: typeof file.file === 'string' ? file.file : '',
      additions: fileAdditions,
      deletions: fileDeletions,
      status: statusOf(file.status),
      more: file.more === true ? true : undefined,
    });
  }

  return {
    sessionID,
    from,
    additions,
    deletions,
    files: entries,
    truncated: truncated ? true : undefined,
  };
}

/**
 * Reads a `Session.Revert` from any API payload (session info, stage response,
 * stream event) and drops the patches: the card only needs totals.
 */
export function readRevert(value: unknown): RevertInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as { readonly messageID?: unknown; readonly files?: unknown };
  if (typeof raw.messageID !== 'string' || raw.messageID.length === 0) {
    return undefined;
  }
  if (!Array.isArray(raw.files)) {
    return { messageID: raw.messageID };
  }
  const files: TurnDiffFile[] = [];
  for (const entry of raw.files) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const file = entry as { readonly [key: string]: unknown };
    files.push({
      file: typeof file.file === 'string' ? file.file : '',
      additions: count(file.additions),
      deletions: count(file.deletions),
      status: statusOf(file.status),
      more: file.more === true ? true : undefined,
    });
  }
  return { messageID: raw.messageID, files };
}

/** Card of a staged revert; null when the session has no revert. */
export function revertSummary(
  revert: RevertInfo | undefined,
  sessionID: string,
): TurnDiffSummary | null {
  if (!revert) {
    return null;
  }
  return summarizeTurnDiff(revert.files ?? [], sessionID, revert.messageID);
}

/** What a `Session.Info` payload means for the staged card of one session. */
export type RevertDecision =
  /** A revert transition happened after the payload was requested. */
  | { readonly action: 'stale' }
  | { readonly action: 'set'; readonly summary: TurnDiffSummary }
  /** The payload is current and the session has no staged revert. */
  | { readonly action: 'clear' };

/**
 * Resolves a `Session.Info.revert` payload against the epoch it was requested
 * in. A stale payload must neither add nor remove the card; a current payload
 * without a revert means the session has none, so the card has to go.
 */
export function decideRevert(
  revert: RevertInfo | undefined,
  sessionID: string,
  payloadEpoch: number,
  currentEpoch: number,
): RevertDecision {
  if (payloadEpoch !== currentEpoch) {
    return { action: 'stale' };
  }
  if (!revert || typeof revert.messageID !== 'string' || revert.messageID.length === 0) {
    return { action: 'clear' };
  }
  return {
    action: 'set',
    summary: summarizeTurnDiff(revert.files ?? [], sessionID, revert.messageID),
  };
}

/**
 * Messages of a committed revert: the boundary message and everything after it
 * are gone on the server. A boundary that is not in the cache leaves it alone,
 * because a partial page cannot prove the turn was removed.
 */
export function truncateMessagesAt<T extends { readonly id: string }>(
  messages: readonly T[],
  boundaryID: string,
): readonly T[] {
  const index = messages.findIndex((message) => message.id === boundaryID);
  if (index < 0) {
    return messages;
  }
  return messages.slice(0, index);
}

/**
 * One entry per turn. A user message created while the previous assistant was
 * still running is a steering message of that turn, not a new turn.
 */
export function turnRefs(messages: readonly TurnMessage[]): TurnRef[] {
  const turns: TurnRef[] = [];
  let completed = 0;
  for (const message of messages) {
    if (message.role === 'assistant') {
      completed = Math.max(completed, message.completed ?? message.time ?? 0);
      continue;
    }
    if (message.role !== 'user') {
      continue;
    }
    const created = message.time ?? 0;
    if (turns.length > 0 && completed > 0 && created > 0 && created <= completed) {
      continue;
    }
    turns.push({ id: message.id, time: created });
  }
  return turns;
}

/**
 * First user message after `baseline` in transcript order. `null` means there
 * was no previous user message, so the first user message wins. `undefined`
 * means the caller did not record a baseline and must use another fallback.
 */
export function firstUserMessageAfter(
  messages: readonly TurnMessage[],
  baseline: string | null | undefined,
): string | undefined {
  if (baseline === undefined) {
    return undefined;
  }
  let seen = baseline === null;
  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }
    if (!seen) {
      if (message.id === baseline) {
        seen = true;
      }
      continue;
    }
    return message.id;
  }
  return undefined;
}

export interface ParsedPatch {
  readonly lines: readonly DiffLine[];
  /** The patch has more lines than the render limit. */
  readonly truncated: boolean;
}

/**
 * Splits a unified patch into renderable lines and reports whether the render
 * limit cut it. File headers (`+++`, `---`) are meta only before a hunk;
 * inside a hunk the same prefix is a changed line whose content starts with
 * those characters.
 */
export function parsePatch(patch: string, limit = PATCH_LINE_LIMIT): ParsedPatch {
  if (typeof patch !== 'string' || patch.length === 0) {
    return { lines: [], truncated: false };
  }
  const max = Math.max(0, Math.floor(limit));
  const all = patch.split('\n');
  // A trailing newline terminates the last line instead of adding an empty one.
  const total = patch.endsWith('\n') ? all.length - 1 : all.length;
  const result: DiffLine[] = [];
  let inHunk = false;
  for (const line of all) {
    if (result.length >= max) {
      break;
    }
    if (line.startsWith('diff ')) {
      inHunk = false;
    }
    result.push({ kind: lineKind(line, inHunk), text: line });
    if (line.startsWith('@@')) {
      inHunk = true;
    }
  }
  return { lines: result, truncated: total > result.length };
}

/** Lines only; use `parsePatch` when the truncation flag matters. */
export function parsePatchLines(patch: string, limit = PATCH_LINE_LIMIT): DiffLine[] {
  return [...parsePatch(patch, limit).lines];
}

/**
 * First line of the new file that the patch touches. A patch without a hunk
 * (for example a deleted file) has no target line, so the editor opens at 1.
 */
export function firstChangedLine(patch: string): number {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m.exec(patch);
  if (!match) {
    return 1;
  }
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : 1;
}

/** A patch with no binary marker can be rendered as text. */
export function isTextPatch(patch: string): boolean {
  if (typeof patch !== 'string') {
    return false;
  }
  if (patch.includes('\u0000')) {
    return false;
  }
  return !/^(?:Binary files .* differ|GIT binary patch)$/m.test(patch);
}

/** UTF-8 size of every patch, without depending on Buffer or TextEncoder. */
export function patchBytes(files: readonly FileDiffInfo[]): number {
  let total = 0;
  for (const file of files) {
    total += utf8Bytes(typeof file.patch === 'string' ? file.patch : '');
  }
  return total;
}

export function diffCacheKey(sessionID: string, from: string): string {
  return `${sessionID}\u0000${from}`;
}

/**
 * Absolute path of a patch file inside `root`. The API reports workspace
 * relative paths, so anything absolute or escaping the root is rejected.
 */
export function resolveDiffPath(root: string, file: string): string | undefined {
  if (typeof root !== 'string' || root.length === 0 || typeof file !== 'string') {
    return undefined;
  }
  const normalized = file.trim().replace(/\\/g, '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (part.length === 0 || part === '.') {
      continue;
    }
    if (part === '..') {
      return undefined;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    return undefined;
  }
  const base = root.replace(/[\\/]+$/, '');
  return `${base}/${parts.join('/')}`;
}

function lineKind(line: string, inHunk: boolean): DiffLineKind {
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch')
  ) {
    return 'meta';
  }
  // File headers exist only outside a hunk; inside one, `---`/`+++` are a
  // removed or added line whose content starts with those characters.
  if (!inHunk && (line.startsWith('+++') || line.startsWith('---'))) {
    return 'meta';
  }
  if (line.startsWith('+')) {
    return 'add';
  }
  if (line.startsWith('-')) {
    return 'del';
  }
  return 'ctx';
}

function statusOf(value: unknown): FileDiffStatus {
  return value === 'added' || value === 'deleted' ? value : 'modified';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
