import { OpenCodeEndpoint } from './opencode-endpoint';

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly created: number;
  readonly updated: number;
  readonly directory?: string;
  readonly running: boolean;
  readonly agent?: string;
  readonly model?: ModelSelection;
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
}

export interface RawSessionInfo {
  readonly id: string;
  readonly title?: string;
  readonly agent?: string;
  readonly model?: { readonly id?: string; readonly providerID?: string; readonly variant?: string };
  readonly time?: { readonly created?: number; readonly updated?: number; readonly busy?: number; readonly idle?: number };
  readonly location?: { readonly directory?: string };
}

interface RawModelInfo {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly variants?: readonly {
    readonly id: string;
    readonly settings?: Record<string, unknown>;
  }[];
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

  async listMessages(sessionID: string): Promise<RawMessage[]> {
    const query = new URLSearchParams({ limit: '200', order: 'asc' });
    const body = await this.request<Envelope<RawMessage[]>>(
      `/api/session/${encodeURIComponent(sessionID)}/message?${query.toString()}`,
    );
    return body.data;
  }

  async getSession(sessionID: string): Promise<SessionSummary> {
    const body = await this.request<Envelope<RawSessionInfo>>(
      `/api/session/${encodeURIComponent(sessionID)}`,
    );
    return toSummary(body.data);
  }

  async prompt(sessionID: string, text: string, attachments?: PromptAttachments): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text, ...attachments }),
    });
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

  subscribe(onEvent: (event: StreamEvent) => void): () => void {
    const controller = new AbortController();
    void this.stream(onEvent, controller.signal);
    return () => controller.abort();
  }

  private async stream(onEvent: (event: StreamEvent) => void, signal: AbortSignal): Promise<void> {
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
      throw new Error(detail.length > 0 ? detail.slice(0, 400) : `Request failed with ${response.status}`);
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
    running: busy > idle,
    agent: info.agent,
    model,
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
