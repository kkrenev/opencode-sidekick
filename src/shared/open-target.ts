/**
 * Paths the host may open from the transcript. Pure string logic shared by the
 * host and its checks: no `vscode` and no `node:path` import, because the
 * module is compiled next to the extension and required by a node check.
 */

export interface OpenTarget {
  /** Absolute path of the file to open. */
  readonly fsPath: string;
  /** One-based line the host clamps to the document. */
  readonly line: number;
}

/** What the panel asks the host to open: a `file:` URI wins over a path. */
export interface OpenPathRequest {
  readonly uri?: string;
  readonly path?: string;
  readonly line?: number;
}

/**
 * Request for one attachment or tool file. A `data:` URI is not a file on disk,
 * so an inline image is not openable unless it also carries a path; the panel
 * hides the Open action in that case instead of sending a dead request.
 */
export function openTargetFor(file: OpenPathRequest): OpenPathRequest | undefined {
  const uri = typeof file.uri === 'string' && /^file:/i.test(file.uri) ? file.uri : undefined;
  const path = typeof file.path === 'string' && file.path.length > 0 ? file.path : undefined;
  if (uri === undefined && path === undefined) {
    return undefined;
  }
  return {
    ...(uri !== undefined ? { uri } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(typeof file.line === 'number' ? { line: file.line } : {}),
  };
}

/** Absolute path of a `file:` URI; any other scheme is not a file. */
export function fileUriPath(value: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^file:\/\/(.*)$/i.exec(value);
  if (!match) {
    return undefined;
  }
  const rest = match[1];
  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  let pathname = slash === -1 ? '/' : rest.slice(slash);
  const query = pathname.search(/[?#]/);
  if (query !== -1) {
    pathname = pathname.slice(0, query);
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (host.length > 0 && host.toLowerCase() !== 'localhost') {
    return `//${host}${pathname}`;
  }
  // A Windows drive letter arrives as `/C:/dir`.
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
}

/**
 * A path with forward slashes and without empty, `.` or `..` segments. A `..`
 * is never resolved: an escaping path is refused instead of normalized.
 */
export function cleanPath(value: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().replace(/\\/g, '/');
  if (trimmed.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of trimmed.split('/')) {
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
  if (/^[A-Za-z]:\//.test(trimmed)) {
    return parts.join('/');
  }
  return trimmed.startsWith('/') ? `/${parts.join('/')}` : parts.join('/');
}

/** True when `target` is `roots` itself or sits below one of them. */
export function withinRoots(roots: readonly string[], target: string): boolean {
  const normalized = cleanPath(target);
  if (!normalized || !isAbsolute(normalized)) {
    return false;
  }
  for (const root of roots) {
    const normalizedRoot = cleanPath(root);
    if (!normalizedRoot || !isAbsolute(normalizedRoot)) {
      continue;
    }
    if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
      return true;
    }
  }
  return false;
}

/** Workspace-relative path of `target` under one of `roots`, for display. */
export function relativeToRoot(
  roots: readonly string[],
  target: string,
): string | undefined {
  const normalized = cleanPath(target);
  if (!normalized || !isAbsolute(normalized)) {
    return undefined;
  }
  for (const root of roots) {
    const normalizedRoot = cleanPath(root);
    if (!normalizedRoot || !isAbsolute(normalizedRoot)) {
      continue;
    }
    if (normalized.startsWith(`${normalizedRoot}/`)) {
      return normalized.slice(normalizedRoot.length + 1);
    }
  }
  return undefined;
}

/**
 * Absolute path of a value the host may open: an absolute path, or a relative
 * one resolved against `directory`. `file:` URIs are converted by the caller,
 * so any other scheme is refused here. A target outside `roots` never resolves.
 */
export function resolveOpenTarget(
  roots: readonly string[],
  directory: string,
  value: string,
  line?: number,
): OpenTarget | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const raw = value.trim();
  if (raw.length === 0 || raw === '.') {
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) {
    return undefined;
  }
  const cleaned = cleanPath(raw);
  if (!cleaned) {
    return undefined;
  }
  const fsPath = isAbsolute(cleaned) ? cleaned : resolveRelative(directory, cleaned);
  if (!fsPath || !withinRoots(roots, fsPath)) {
    return undefined;
  }
  return { fsPath, line: normalizeLine(line) };
}

/** One-based line; a 0-based offset is normalized by the caller before this. */
export function normalizeLine(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function resolveRelative(directory: string, relative: string): string | undefined {
  const root = cleanPath(directory);
  if (!root || !isAbsolute(root)) {
    return undefined;
  }
  return cleanPath(`${root}/${relative}`);
}

function isAbsolute(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value);
}
