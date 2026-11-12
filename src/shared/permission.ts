/**
 * Permission requests shared by the host and the chat card.
 *
 * The server sends `Permission.Request` with the action, the patterns it asks
 * for and, for some tools, `metadata` that can carry file patches or command
 * output. Only what the card needs is kept here: `metadata` is dropped on the
 * way in, so secrets from commands never reach the chat snapshot.
 */

/** What answering a request means; mirrors `Permission.Reply`. */
export type PermissionDecision = 'once' | 'always' | 'reject';

/** How dangerous the requested action is; drives the chip on the card. */
export type PermissionRisk = 'read' | 'write' | 'shell' | 'network' | 'external' | 'other';

/** Tool a request came from; only the fields the panel routes on. */
export interface PermissionSource {
  readonly type: string;
  readonly messageID?: string;
  readonly id?: string;
}

/** `Permission.Request` reduced to what the panel shows and answers. */
export interface PermissionRequest {
  readonly id: string;
  readonly sessionID: string;
  readonly action: string;
  readonly resources: readonly string[];
  /** Patterns an `always` answer would store; empty means there is no rule. */
  readonly save?: readonly string[];
  /** Explanation the server attached to the request. */
  readonly message?: string;
  readonly source?: PermissionSource;
}

/** `PermissionSaved.Info` of one stored rule. */
export interface SavedPermission {
  readonly id: string;
  readonly projectID: string;
  readonly action: string;
  readonly resource: string;
  readonly created: number;
}

/** Title and optional command line of a request, following the TUI wording. */
export interface PermissionSummary {
  readonly title: string;
  readonly detail?: string;
}

/**
 * Tools the panel may answer on its own when auto-approve is on. The list is
 * exact on purpose: a new or renamed tool asks, and an unknown action never
 * matches.
 */
export const SAFE_PERMISSION_ACTIONS: readonly string[] = [
  'read',
  'glob',
  'grep',
  'list',
  'find',
];

/** Resolved request ids kept to keep a stale list from resurrecting a card. */
export const RESOLVED_PERMISSION_LIMIT = 200;

/** Requests above this count are cut; the card shows the first three. */
const RESOURCE_LIMIT = 20;
const TITLE_RESOURCE_LIMIT = 240;
const DETAIL_LIMIT = 400;
const MESSAGE_LIMIT = 2000;

/** Exact match only: no prefixes, no case folding, unknown actions ask. */
export function isSafePermissionAction(action: unknown): boolean {
  return typeof action === 'string' && SAFE_PERMISSION_ACTIONS.includes(action);
}

/**
 * Auto-approve needs both a read-only action and a tool source: a request the
 * server did not attribute to a tool is answered by the user.
 */
export function isAutoApprovable(request: PermissionRequest): boolean {
  return request.source?.type === 'tool' && isSafePermissionAction(request.action);
}

/**
 * `Always allow` needs patterns the server offered to store. The host checks it
 * again before replying: the webview must not be able to create an empty rule.
 */
export function canAlwaysAllow(request: PermissionRequest): boolean {
  return (request.save?.length ?? 0) > 0;
}

export function permissionRisk(action: unknown): PermissionRisk {
  switch (normalizeAction(action)) {
    case 'read':
    case 'list':
    case 'glob':
    case 'grep':
    case 'find':
    case 'context':
      return 'read';
    case 'edit':
    case 'write':
    case 'patch':
      return 'write';
    case 'shell':
      return 'shell';
    case 'webfetch':
    case 'websearch':
    case 'fetch':
      return 'network';
    case 'external_directory':
      return 'external';
    default:
      return 'other';
  }
}

/**
 * Reads a `Permission.Request` from any API payload (list entry, stream event)
 * and keeps only the fields the card uses.
 */
export function readPermissionRequest(value: unknown): PermissionRequest | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const sessionID = typeof raw.sessionID === 'string' ? raw.sessionID : '';
  const action = typeof raw.action === 'string' ? raw.action : '';
  if (id.length === 0 || sessionID.length === 0 || action.length === 0) {
    return undefined;
  }
  const resources = stringList(raw.resources, RESOURCE_LIMIT);
  const save = stringList(raw.save, RESOURCE_LIMIT);
  const message =
    typeof raw.message === 'string' && raw.message.length > 0
      ? clip(raw.message, MESSAGE_LIMIT)
      : undefined;
  return {
    id,
    sessionID,
    action,
    resources,
    save: save.length > 0 ? save : undefined,
    message,
    source: readSource(raw.source),
  };
}

/** Reads a `PermissionSaved.Info` from the saved-rules list. */
export function readSavedPermission(value: unknown): SavedPermission | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const projectID = typeof raw.projectID === 'string' ? raw.projectID : '';
  const action = typeof raw.action === 'string' ? raw.action : '';
  const resource = typeof raw.resource === 'string' ? raw.resource : '';
  if (id.length === 0 || projectID.length === 0 || action.length === 0) {
    return undefined;
  }
  const time = raw.time && typeof raw.time === 'object' ? (raw.time as Record<string, unknown>) : {};
  const created = typeof time.created === 'number' && Number.isFinite(time.created) ? time.created : 0;
  return { id, projectID, action, resource, created };
}

/** Replaces the request with the same id, otherwise appends; order is kept. */
export function upsertPermission(
  list: readonly PermissionRequest[],
  request: PermissionRequest,
): PermissionRequest[] {
  const index = list.findIndex((entry) => entry.id === request.id);
  if (index < 0) {
    return [...list, request];
  }
  const next = [...list];
  next[index] = request;
  return next;
}

export function removePermission(
  list: readonly PermissionRequest[],
  requestID: string,
): PermissionRequest[] {
  return list.filter((entry) => entry.id !== requestID);
}

/** Drops requests answered here or in another client. */
export function filterResolved(
  list: readonly PermissionRequest[],
  resolved: ReadonlySet<string>,
): PermissionRequest[] {
  if (resolved.size === 0) {
    return [...list];
  }
  return list.filter((entry) => !resolved.has(entry.id));
}

/**
 * Applies a server list to the pending cards without losing a request that
 * arrived while the list was in flight. `knownBefore` is the set of ids the
 * host had when it started the read: an entry outside both the server list and
 * that set is newer than the response and stays; an older entry the server no
 * longer has was answered or expired, so it goes.
 */
export function mergePermissionList(
  server: readonly PermissionRequest[],
  current: readonly PermissionRequest[],
  knownBefore: ReadonlySet<string>,
): PermissionRequest[] {
  let merged = [...server];
  const serverIDs = new Set(server.map((entry) => entry.id));
  for (const entry of current) {
    if (knownBefore.has(entry.id) || serverIDs.has(entry.id)) {
      continue;
    }
    merged = upsertPermission(merged, entry);
    serverIDs.add(entry.id);
  }
  return merged;
}

/** Bounded FIFO of answered ids: an old request may come back after a reload. */
export function rememberResolved(
  resolved: Set<string>,
  requestID: string,
  limit = RESOLVED_PERMISSION_LIMIT,
): void {
  resolved.delete(requestID);
  resolved.add(requestID);
  while (resolved.size > Math.max(1, limit)) {
    const oldest = resolved.values().next().value;
    if (oldest === undefined) {
      return;
    }
    resolved.delete(oldest);
  }
}

/**
 * Card title and command line of a request. Wording follows the terminal UI so
 * a user who knows one panel reads the other without learning new labels.
 */
export function permissionSummary(request: PermissionRequest): PermissionSummary {
  const first = request.resources[0] ?? '';
  const path = first.length > 0 ? clip(first, TITLE_RESOURCE_LIMIT) : '';
  const action = normalizeAction(request.action);
  switch (action) {
    case 'read':
      return { title: path.length > 0 ? `Read ${path}` : 'Read files' };
    case 'list':
      return { title: path.length > 0 ? `List ${path}` : 'List files' };
    case 'glob':
      return { title: path.length > 0 ? `Glob "${path}"` : 'Glob' };
    case 'grep':
      return { title: path.length > 0 ? `Grep "${path}"` : 'Grep' };
    case 'shell':
      return {
        title: 'Shell command',
        detail: first.length > 0 ? `$ ${clip(first, DETAIL_LIMIT)}` : undefined,
      };
    case 'edit':
    case 'write':
    case 'patch':
      return { title: path.length > 0 ? `Edit ${path}` : 'Edit files' };
    case 'webfetch':
      return { title: path.length > 0 ? `WebFetch ${path}` : 'WebFetch' };
    case 'websearch':
      return { title: path.length > 0 ? `Web search "${path}"` : 'Web search' };
    case 'external_directory':
      return {
        title:
          path.length > 0
            ? `Access external directory ${directoryOf(first)}`
            : 'Access external directory',
      };
    default:
      return { title: `Call tool ${request.action}` };
  }
}

/** Chip label of a risk level. */
export function permissionRiskLabel(risk: PermissionRisk): string {
  switch (risk) {
    case 'read':
      return 'Read-only';
    case 'write':
      return 'Writes files';
    case 'shell':
      return 'Runs a command';
    case 'network':
      return 'Network';
    case 'external':
      return 'Outside the workspace';
    default:
      return 'Tool';
  }
}

function normalizeAction(action: unknown): string {
  if (typeof action !== 'string') {
    return '';
  }
  const lower = action.trim().toLowerCase();
  if (lower === 'bash') {
    return 'shell';
  }
  if (lower === 'apply_patch') {
    return 'patch';
  }
  return lower;
}

function readSource(value: unknown): PermissionSource | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string' || raw.type.length === 0) {
    return undefined;
  }
  return {
    type: raw.type,
    messageID: typeof raw.messageID === 'string' ? raw.messageID : undefined,
    id: typeof raw.id === 'string' ? raw.id : undefined,
  };
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    if (result.length >= limit) {
      break;
    }
    if (typeof entry === 'string' && entry.length > 0) {
      result.push(entry);
    }
  }
  return result;
}

/** `…/dir/*` patterns keep the directory, like the terminal card does. */
function directoryOf(pattern: string): string {
  const star = pattern.indexOf('*');
  if (star < 0) {
    return pattern;
  }
  const prefix = pattern.slice(0, star);
  if (/^[\\/]+$/.test(prefix) || /^[A-Za-z]:[\\/]$/.test(prefix)) {
    return prefix;
  }
  return prefix.replace(/[\\/]+$/, '');
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
