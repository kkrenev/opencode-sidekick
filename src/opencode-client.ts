import { OpenCodeEndpoint } from './opencode-endpoint';
import { RawTokenCounts, readTokens, TokenBreakdown } from './shared/context-usage';
import {
  PermissionDecision,
  PermissionRequest,
  readPermissionRequest,
  readSavedPermission,
  SavedPermission,
} from './shared/permission';
import { FileDiffInfo, readRevert, type RevertInfo } from './shared/turn-diff';
import { parseQueueItem, type QueueDelivery, type QueueItem } from './shared/inbox';

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly created: number;
  readonly updated: number;
  readonly directory?: string;
  readonly projectID?: string;
  readonly running: boolean;
  readonly agent?: string;
  readonly model?: ModelSelection;
  /** Session this one was forked from. */
  readonly parentID?: string;
  readonly archived?: boolean;
  /** Cumulative cost of the whole session, in US dollars. */
  readonly cost?: number;
  /** Cumulative tokens of the whole session; not the current context size. */
  readonly tokens?: TokenBreakdown;
  /** Staged revert that survives a panel or server restart. */
  readonly revert?: RevertInfo;
}

/** A request the server rejected; `status` tells 409 (busy) from 404 and 500. */
export class OpenCodeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpenCodeHttpError';
  }
}

export interface ModelVariant {
  readonly id: string;
  readonly effort?: string;
}

export interface ModelEntry {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly variants: readonly ModelVariant[];
  /** Context window of the model; absent when the provider reports none. */
  readonly contextLimit?: number;
}

export interface AgentEntry {
  readonly id: string;
  readonly name: string;
  readonly mode?: string;
  readonly hidden?: boolean;
  readonly description?: string;
  readonly model?: ModelSelection;
}

export interface CommandEntry {
  readonly name: string;
  readonly description?: string;
}

export interface SkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface FileEntry {
  readonly path: string;
  readonly type: 'file' | 'directory';
}

export interface MentionRange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface SkillAttachment {
  readonly id: string;
  readonly mention?: MentionRange;
}

export interface AgentAttachment {
  readonly name: string;
  readonly mention?: MentionRange;
}

export interface FileAttachment {
  readonly uri: string;
  readonly name?: string;
  readonly mention?: MentionRange;
}

export interface PromptAttachments {
  readonly skills?: readonly SkillAttachment[];
  readonly agents?: readonly AgentAttachment[];
  readonly files?: readonly FileAttachment[];
}

export interface ModelSelection {
  readonly id: string;
  readonly providerID: string;
  readonly variant?: string;
}

export interface RawPart {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly executed?: boolean;
  /** MIME type of a `file` part. */
  readonly mime?: string;
  /** Path of a `file` part, when the server reports a path instead of a URI. */
  readonly filename?: string;
  /** `file:`/`data:` URI of a `file` part. */
  readonly uri?: string;
  /** `file:`/`data:` URL of a `file` part, as the server reports it. */
  readonly url?: string;
  readonly state?: RawToolState;
  readonly time?: { readonly created?: number; readonly completed?: number };
}

export interface RawToolState {
  readonly status?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly content?: unknown;
  readonly error?: unknown;
  readonly metadata?: unknown;
}

export interface RawMessage {
  readonly id: string;
  readonly type?: string;
  readonly agent?: string;
  readonly model?: { readonly id?: string; readonly providerID?: string; readonly variant?: string };
  readonly time?: { readonly created?: number; readonly completed?: number };
  readonly text?: string;
  readonly content?: readonly RawPart[];
  readonly files?: readonly { readonly uri?: string; readonly name?: string; readonly mime?: string }[];
  /** Token counts of this message, reported on completed assistant turns. */
  readonly tokens?: RawTokenCounts;
  readonly cost?: number;
}

export interface RawSessionInfo {
  readonly id: string;
  readonly title?: string;
  readonly projectID?: string;
  readonly agent?: string;
  readonly model?: { readonly id?: string; readonly providerID?: string; readonly variant?: string };
  readonly time?: { readonly created?: number; readonly updated?: number; readonly busy?: number; readonly idle?: number };
  readonly location?: { readonly directory?: string };
  readonly parentID?: string;
  readonly archived?: boolean;
  readonly cost?: number;
  readonly tokens?: RawTokenCounts;
  /** Staged revert of this session. */
  readonly revert?: unknown;
}

interface RawModelInfo {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly limit?: { readonly context?: number; readonly output?: number };
  readonly variants?: readonly {
    readonly id: string;
    readonly settings?: Record<string, unknown>;
  }[];
}

export interface MessagePageCursor {
  readonly previous?: string;
  readonly next?: string;
}

export interface MessagePage {
  readonly messages: RawMessage[];
  readonly cursor?: MessagePageCursor;
}

export interface ListMessagesOptions {
  readonly limit?: number;
  readonly order?: 'asc' | 'desc';
  readonly cursor?: string;
}

export interface StreamEvent {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

interface Envelope<T> {
  readonly data: T;
}

export class OpenCodeClient {
  constructor(private readonly endpoint: OpenCodeEndpoint) {}

  async listSessions(directory: string, search?: string): Promise<SessionSummary[]> {
    const query = new URLSearchParams({ directory, limit: '60' });
    if (search && search.trim().length > 0) {
      query.set('search', search.trim());
    }
    const body = await this.request<Envelope<RawSessionInfo[]>>(`/api/session?${query.toString()}`);
    return body.data.map(toSummary);
  }

  async createSession(directory: string): Promise<SessionSummary> {
    const body = await this.request<Envelope<RawSessionInfo>>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ location: { directory } }),
    });
    return toSummary(body.data);
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.request<void>(`/api/session/${encodeURIComponent(sessionID)}`, { method: 'DELETE' });
  }

  async listMessages(
    sessionID: string,
    options: ListMessagesOptions = {},
  ): Promise<MessagePage> {
    const cursor = options.cursor ?? '';
    const query = new URLSearchParams({ limit: String(options.limit ?? 200) });
    if (cursor.length > 0) {
      // The server rejects `order` together with `cursor`: a cursor page keeps
      // the direction it was created with.
      query.set('cursor', cursor);
    } else {
      query.set('order', options.order ?? 'asc');
    }
    const body = await this.request<Envelope<RawMessage[]> & { cursor?: MessagePageCursor }>(
      `/api/session/${encodeURIComponent(sessionID)}/message?${query.toString()}`,
    );
    return { messages: body.data, cursor: body.cursor };
  }

  /**
   * Changes made by exactly one turn. `from` is the user message that started
   * it; the endpoint has a `to` parameter, but it extends the range to the
   * turn that starts there, so one turn is requested with `from` alone.
   * `context` is omitted for full files.
   */
  async sessionDiff(
    sessionID: string,
    options: { readonly from?: string; readonly context?: number } = {},
  ): Promise<FileDiffInfo[]> {
    const query = new URLSearchParams();
    if (options.from) {
      query.set('from', options.from);
    }
    if (options.context !== undefined) {
      query.set('context', String(options.context));
    }
    const suffix = query.toString();
    const body = await this.request<Envelope<FileDiffInfo[]>>(
      `/api/session/${encodeURIComponent(sessionID)}/diff${suffix.length > 0 ? `?${suffix}` : ''}`,
    );
    return Array.isArray(body?.data) ? body.data : [];
  }

  async getSession(sessionID: string): Promise<SessionSummary> {
    const body = await this.request<Envelope<RawSessionInfo>>(
      `/api/session/${encodeURIComponent(sessionID)}`,
    );
    return toSummary(body.data);
  }

  /** Renames a session and/or moves it in or out of the archive. */
  async updateSession(
    sessionID: string,
    patch: { readonly title?: string; readonly archived?: boolean },
  ): Promise<SessionSummary> {
    const body = await this.request<Envelope<RawSessionInfo>>(
      `/api/session/${encodeURIComponent(sessionID)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    return toSummary(body.data);
  }

  /** Copies a session up to `before` (the newest message by default). */
  async forkSession(sessionID: string, before?: string): Promise<SessionSummary> {
    const body = await this.request<Envelope<RawSessionInfo>>(
      `/api/session/${encodeURIComponent(sessionID)}/fork`,
      {
        method: 'POST',
        body: JSON.stringify(before ? { before } : {}),
      },
    );
    return toSummary(body.data);
  }

  /**
   * Sends one prompt. `delivery` is omitted when the caller wants the server
   * default, so an idle send keeps its old body exactly.
   */
  async prompt(
    sessionID: string,
    text: string,
    attachments?: PromptAttachments,
    options: { readonly delivery?: QueueDelivery } = {},
  ): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        ...attachments,
        ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
      }),
    });
  }

  /** Durable inbox of one session, ordered by enqueue sequence. */
  async inbox(sessionID: string): Promise<QueueItem[]> {
    const body = await this.request<Envelope<unknown[]>>(
      `/api/session/${encodeURIComponent(sessionID)}/inbox`,
    );
    const entries = Array.isArray(body?.data) ? body.data : [];
    const result: QueueItem[] = [];
    for (const entry of entries) {
      const item = parseQueueItem(entry);
      if (item) {
        result.push(item);
      }
    }
    return result;
  }

  /** Switches a pending item to `steer`, which wakes the running turn. */
  async inboxDelivery(
    sessionID: string,
    inboxID: string,
    delivery: QueueDelivery,
  ): Promise<void> {
    await this.request(
      `/api/session/${encodeURIComponent(sessionID)}/inbox/${encodeURIComponent(inboxID)}`,
      { method: 'PATCH', body: JSON.stringify({ delivery }) },
    );
  }

  /** Cancels an undelivered item; a delivered one answers 409 or 404. */
  async inboxCancel(sessionID: string, inboxID: string): Promise<void> {
    await this.request(
      `/api/session/${encodeURIComponent(sessionID)}/inbox/${encodeURIComponent(inboxID)}`,
      { method: 'DELETE' },
    );
  }

  async command(
    sessionID: string,
    name: string,
    text: string,
    attachments?: PromptAttachments,
  ): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/command`, {
      method: 'POST',
      body: JSON.stringify({ name, text, ...attachments }),
    });
  }

  async interrupt(sessionID: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/interrupt`, { method: 'POST' });
  }

  /**
   * Stages a revert at `messageID` and, with `files: true`, immediately restores
   * the files to the state before that turn. The response already contains the
   * files the stage changed; the boundary stays staged until commit or clear.
   */
  async revertStage(sessionID: string, messageID: string): Promise<RevertInfo> {
    const body = await this.request<Envelope<unknown>>(
      `/api/session/${encodeURIComponent(sessionID)}/revert/stage`,
      {
        method: 'POST',
        body: JSON.stringify({ messageID, files: true }),
      },
    );
    return readRevert(body?.data) ?? { messageID };
  }

  /** Keeps the staged revert: the server drops the turn it goes back to. */
  async revertCommit(sessionID: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/revert/commit`, {
      method: 'POST',
    });
  }

  /** Drops the staged revert and restores the files it had changed. */
  async revertClear(sessionID: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/revert`, {
      method: 'DELETE',
    });
  }

  /** Pending permission requests of one session, in server order. */
  async listSessionPermissions(sessionID: string): Promise<PermissionRequest[]> {
    const body = await this.request<Envelope<unknown[]>>(
      `/api/session/${encodeURIComponent(sessionID)}/permission`,
    );
    const entries = Array.isArray(body?.data) ? body.data : [];
    const result: PermissionRequest[] = [];
    for (const entry of entries) {
      const request = readPermissionRequest(entry);
      if (request) {
        result.push(request);
      }
    }
    return result;
  }

  /**
   * Answers a pending request. `message` is the rejection reason and is only
   * sent when the caller has one.
   */
  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void> {
    const body: { decision: PermissionDecision; message?: string } = { decision };
    if (typeof message === 'string' && message.length > 0) {
      body.message = message;
    }
    await this.request(
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  /**
   * Saved rules of one project. The project is required: the endpoint without
   * `projectID` returns the rules of every project, which the panel must never
   * show or delete from.
   */
  async listSavedPermissions(projectID: string): Promise<SavedPermission[]> {
    const project = projectID.trim();
    if (project.length === 0) {
      throw new Error('A project id is required to list saved permissions');
    }
    const query = new URLSearchParams({ projectID: project });
    const body = await this.request<Envelope<unknown[]>>(
      `/api/permission/saved?${query.toString()}`,
    );
    const entries = Array.isArray(body?.data) ? body.data : [];
    const result: SavedPermission[] = [];
    for (const entry of entries) {
      const rule = readSavedPermission(entry);
      if (rule) {
        result.push(rule);
      }
    }
    return result;
  }

  async deleteSavedPermission(id: string): Promise<void> {
    await this.request(`/api/permission/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /**
   * Requests a context compaction. `id` is the durable id of the request and
   * must use the server message prefix.
   */
  async compact(sessionID: string, id: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/compact`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async listModels(directory: string): Promise<ModelEntry[]> {
    const body = await this.request<Envelope<RawModelInfo[]>>(`/api/model?${locationQuery(directory)}`);
    return body.data.map((model) => ({
      id: model.id,
      providerID: model.providerID,
      name: model.name,
      variants: Array.isArray(model.variants)
        ? model.variants.map((variant) => ({
            id: variant.id,
            effort:
              typeof variant.settings?.effort === 'string' ? variant.settings.effort : undefined,
          }))
        : [],
      contextLimit:
        typeof model.limit?.context === 'number' &&
        Number.isFinite(model.limit.context) &&
        model.limit.context > 0
          ? model.limit.context
          : undefined,
    }));
  }

  async getDefaultModel(directory: string): Promise<ModelSelection | undefined> {
    const body = await this.request<Envelope<RawModelInfo | null>>(
      `/api/model/default?${locationQuery(directory)}`,
    );
    if (!body.data) {
      return undefined;
    }
    return { id: body.data.id, providerID: body.data.providerID };
  }

  async listAgents(directory: string): Promise<AgentEntry[]> {
    const body = await this.request<Envelope<AgentEntry[]>>(`/api/agent?${locationQuery(directory)}`);
    return body.data.map((agent) => ({
      id: agent.id,
      name: agent.name,
      mode: typeof agent.mode === 'string' ? agent.mode : undefined,
      hidden: agent.hidden === true,
      description: typeof agent.description === 'string' ? agent.description : undefined,
      model:
        agent.model &&
        typeof agent.model.id === 'string' &&
        typeof agent.model.providerID === 'string'
          ? {
              id: agent.model.id,
              providerID: agent.model.providerID,
              variant:
                typeof agent.model.variant === 'string' ? agent.model.variant : undefined,
            }
          : undefined,
    }));
  }

  async listCommands(directory: string): Promise<CommandEntry[]> {
    const body = await this.request<Envelope<CommandEntry[]>>(
      `/api/command?${locationQuery(directory)}`,
    );
    return body.data.map((command) => ({
      name: command.name,
      description: typeof command.description === 'string' ? command.description : undefined,
    }));
  }

  async listSkills(directory: string): Promise<SkillEntry[]> {
    const body = await this.request<Envelope<SkillEntry[]>>(`/api/skill?${locationQuery(directory)}`);
    return body.data.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : undefined,
    }));
  }

  async findFiles(directory: string, query: string, limit = 30): Promise<FileEntry[]> {
    const params = new URLSearchParams();
    params.set('location[directory]', directory);
    params.set('query', query);
    params.set('type', 'file');
    params.set('limit', String(limit));
    const body = await this.request<Envelope<FileEntry[]>>(`/api/fs/find?${params.toString()}`);
    return body.data.map((entry) => ({
      path: entry.path,
      type: entry.type === 'directory' ? 'directory' : 'file',
    }));
  }

  async selectModel(sessionID: string, model: ModelSelection): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/model`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
  }

  async selectAgent(sessionID: string, agent: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/agent`, {
      method: 'POST',
      body: JSON.stringify({ agent }),
    });
  }

  subscribe(
    onEvent: (event: StreamEvent) => void,
    onReconnect?: () => void,
  ): () => void {
    const controller = new AbortController();
    void this.stream(onEvent, controller.signal, onReconnect);
    return () => controller.abort();
  }

  private async stream(
    onEvent: (event: StreamEvent) => void,
    signal: AbortSignal,
    onReconnect?: () => void,
  ): Promise<void> {
    let opened = false;
    while (!signal.aborted) {
      try {
        const response = await fetch(new URL('/api/event', this.endpoint.url), {
          headers: {
            authorization: `Basic ${this.endpoint.credential}`,
            accept: 'text/event-stream',
          },
          signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Event stream rejected with ${response.status}`);
        }
        if (opened) {
          onReconnect?.();
        }
        opened = true;
        await readEventStream(response.body, onEvent, signal);
      } catch {
        if (signal.aborted) {
          return;
        }
      }
      if (signal.aborted) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.endpoint.url), {
      ...init,
      headers: {
        authorization: `Basic ${this.endpoint.credential}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new OpenCodeHttpError(
        detail.length > 0 ? detail.slice(0, 400) : `Request failed with ${response.status}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }
}

function locationQuery(directory: string): string {
  const query = new URLSearchParams();
  query.set('location[directory]', directory);
  return query.toString();
}

function toSummary(info: RawSessionInfo): SessionSummary {
  const time = info.time ?? {};
  const busy = time.busy ?? 0;
  const idle = time.idle ?? 0;
  const model =
    info.model && typeof info.model.id === 'string' && typeof info.model.providerID === 'string'
      ? { id: info.model.id, providerID: info.model.providerID, variant: info.model.variant }
      : undefined;
  return {
    id: info.id,
    title: info.title && info.title.trim().length > 0 ? info.title : 'Untitled session',
    created: time.created ?? 0,
    updated: time.updated ?? time.created ?? 0,
    directory: info.location?.directory,
    projectID: typeof info.projectID === 'string' ? info.projectID : undefined,
    running: busy > idle,
    agent: info.agent,
    model,
    parentID: typeof info.parentID === 'string' ? info.parentID : undefined,
    archived: info.archived === true ? true : undefined,
    cost:
      typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost > 0
        ? info.cost
        : undefined,
    tokens: info.tokens ? readTokens(info.tokens) : undefined,
    revert: readRevert(info.revert),
  };
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const payload = chunk
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (payload.length > 0) {
          try {
            onEvent(JSON.parse(payload) as StreamEvent);
          } catch {
            // Ignore keep-alive frames and malformed payloads.
          }
        }
        split = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
