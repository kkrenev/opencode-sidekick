/**
 * Workspace session search: the lists of every folder merged into one, deduped
 * by session id and ordered by a client-side fuzzy score over the title.
 *
 * Kept free of `vscode` and DOM so `scripts/check-session-search.mjs` can load
 * the compiled module. A server hit that only matched the text of a message has
 * no title match at all; it scores 0 and, far from disappearing, stays behind
 * the title matches in recency order, so nothing the server found is lost.
 */

export type HistoryScope = 'folder' | 'workspace';

/** The fields the ranking needs; structurally compatible with `SessionSummary`. */
export interface SearchableSession {
  readonly id: string;
  readonly title: string;
  readonly updated: number;
  readonly directory?: string;
  readonly running: boolean;
}

/** Sessions of one folder, as the server returned them. */
export interface SessionSource<T extends SearchableSession = SearchableSession> {
  readonly directory: string;
  readonly sessions: readonly T[];
}

/** One session together with the folder it belongs to. */
export interface WorkspaceSession<T extends SearchableSession = SearchableSession> {
  readonly session: T;
  /** `session.directory` when the server sent one, else the folder that listed it. */
  readonly directory: string;
}

const MATCH_CHAR = 1;
const CONTIGUOUS_BONUS = 3;
const WORD_START_BONUS = 3;
const WORD_BREAK = /[^\p{L}\p{N}_]/u;

/**
 * How well `query` matches `title`, 0 when it does not match at all.
 *
 * The query is a case-insensitive subsequence of the title; each matched
 * character scores, and a run of adjacent characters or a match at the start of
 * a word (including camelCase) scores more. The title is only folded for
 * comparison, so a fold that changes the length (`İ` becomes two code units)
 * cannot break the score. An empty query scores 0, so the ranking falls back to
 * recency without any fuzzy work.
 */
export function fuzzyScore(title: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return 0;
  }
  const haystack = title.toLowerCase();
  // A plain leftmost walk would match "Search sessions" starting inside the
  // first word and score a full word lower than a spread-out match. Every
  // position of the first character is therefore a candidate start, and the
  // best walk wins; titles are short enough for this to stay cheap.
  let best = 0;
  for (
    let start = haystack.indexOf(needle[0]);
    start !== -1;
    start = haystack.indexOf(needle[0], start + 1)
  ) {
    best = Math.max(best, scoreFrom(title, haystack, needle, start));
  }
  return best;
}

function scoreFrom(title: string, haystack: string, needle: string, start: number): number {
  let score = 0;
  let cursor = start;
  let previous = -2;
  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index === -1) {
      return 0;
    }
    score += MATCH_CHAR;
    if (index === previous + 1) {
      score += CONTIGUOUS_BONUS;
    }
    if (isWordStart(title, index)) {
      score += WORD_START_BONUS;
    }
    previous = index;
    cursor = index + 1;
  }
  return score;
}

function isWordStart(title: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = title[index - 1];
  if (WORD_BREAK.test(previous)) {
    return true;
  }
  const current = title[index];
  return current !== current.toLowerCase() && previous === previous.toLowerCase();
}

/**
 * Concatenates the per-folder lists in the given order, keeping the first copy
 * of a session id: the same id can be listed by two folders, and one row is
 * enough. The folder of a row is the directory the server attached to the
 * session when it sent one, else the folder whose request returned it.
 */
export function mergeWorkspaceSessions<T extends SearchableSession>(
  sources: readonly SessionSource<T>[],
): WorkspaceSession<T>[] {
  const seen = new Set<string>();
  const merged: WorkspaceSession<T>[] = [];
  for (const source of sources) {
    for (const session of source.sessions) {
      if (seen.has(session.id)) {
        continue;
      }
      seen.add(session.id);
      const own = session.directory;
      merged.push({
        session,
        directory: own && own.length > 0 ? own : source.directory,
      });
    }
  }
  return merged;
}

/**
 * Orders the merged list for a query: best title score first, then the newest
 * session, then the order the server returned. The server itself lists a folder
 * by recency, so a single folder keeps its order and the palette shows the
 * newest sessions of every folder first when the query is empty.
 */
export function rankSessions<T extends SearchableSession>(
  sessions: readonly WorkspaceSession<T>[],
  query: string,
): WorkspaceSession<T>[] {
  const trimmed = query.trim();
  return sessions
    .map((entry, index) => ({ entry, index, score: fuzzyScore(entry.session.title, trimmed) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.entry.session.updated - left.entry.session.updated ||
        left.index - right.index,
    )
    .map((row) => row.entry);
}
