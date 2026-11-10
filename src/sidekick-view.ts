import * as os from 'node:os';
import * as vscode from 'vscode';
import { mapMessages, UiMessage } from './message-map';
import {
  AgentEntry,
  ModelEntry,
  OpenCodeClient,
  SessionSummary,
  StreamEvent,
} from './opencode-client';
import { connect, OpenCodeEndpoint } from './opencode-endpoint';

export const VIEW_ID = 'opencode.sidekick';

const SESSION_KEY = 'opencode.sidekick.session';
const REFRESH_DEBOUNCE_MS = 320;

interface StoredSelection {
  readonly directory: string;
  readonly sessionID: string;
}

interface Selection {
  readonly id: string;
  readonly providerID: string;
  readonly variant?: string;
}

export class SidekickViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private client: OpenCodeClient | undefined;
  private endpoint: OpenCodeEndpoint | undefined;
  private stopStream: (() => void) | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private session: SessionSummary | undefined;
  private sessions: SessionSummary[] = [];
  private messages: UiMessage[] = [];
  private models: ModelEntry[] = [];
  private agents: AgentEntry[] = [];
  private busy = false;
  private lastError: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get directory(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.onDidDispose(() => {
      this.view = undefined;
    });
    view.webview.onDidReceiveMessage((message) => {
      void this.handle(message as { type: string; [key: string]: unknown });
    });
  }

  browserUrl(): string | undefined {
    if (!this.endpoint) {
      return undefined;
    }
    return `${this.endpoint.url}/?auth_token=${encodeURIComponent(this.endpoint.credential)}`;
  }

  async newSession(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const session = await client.createSession(this.directory);
      this.session = session;
      this.messages = [];
      this.busy = false;
      await this.persistSession(session.id);
      await this.loadSessions();
      this.post({ type: 'state', state: this.snapshot() });
      this.post({ type: 'focus', target: 'composer' });
    } catch (error) {
      this.fail(error);
    }
  }

  async showHistory(): Promise<void> {
    await this.loadSessions();
    this.post({ type: 'state', state: this.snapshot() });
    this.post({ type: 'openHistory' });
  }

  async reload(): Promise<void> {
    await this.connectAndLoad();
  }

  dispose(): void {
    this.stopStream?.();
    this.stopStream = undefined;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.client = undefined;
    this.endpoint = undefined;
  }

  private async connectAndLoad(): Promise<void> {
    try {
      this.endpoint = await connect();
      this.client = new OpenCodeClient(this.endpoint);
      this.lastError = undefined;
      this.stopStream?.();
      this.stopStream = this.client.subscribe((event) => this.onEvent(event));

      await Promise.all([this.loadModels(), this.loadAgents()]);
      await this.loadSessions();

      const stored = this.context.workspaceState.get<StoredSelection>(SESSION_KEY);
      const preferred =
        stored && stored.directory === this.directory
          ? this.sessions.find((entry) => entry.id === stored.sessionID)
          : undefined;

      this.session = preferred ?? this.sessions[0];
      this.busy = this.session?.running ?? false;
      await this.loadMessages();
      this.post({ type: 'state', state: this.snapshot() });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.client = undefined;
      this.post({ type: 'state', state: this.snapshot() });
    }
  }

  private async loadModels(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.models = await this.client.listModels(this.directory);
    } catch {
      this.models = [];
    }
  }

  private async loadAgents(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.agents = await this.client.listAgents(this.directory);
    } catch {
      this.agents = [];
    }
  }

  private async loadSessions(search?: string): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.sessions = await this.client.listSessions(this.directory, search);
    } catch (error) {
      this.fail(error);
    }
  }

  private async loadMessages(): Promise<void> {
    if (!this.client || !this.session) {
      this.messages = [];
      return;
    }
    try {
      const raw = await this.client.listMessages(this.session.id);
      this.messages = mapMessages(raw);
    } catch (error) {
      this.fail(error);
    }
  }

  private onEvent(event: StreamEvent): void {
    const sessionID = typeof event.data?.sessionID === 'string' ? event.data.sessionID : undefined;
    if (this.session && sessionID && sessionID !== this.session.id) {
      return;
    }

    if (event.type === 'session.text.delta' || event.type === 'session.reasoning.delta') {
      const messageID = event.data?.assistantMessageID;
      const delta = event.data?.delta;
      if (typeof messageID === 'string' && typeof delta === 'string' && delta.length > 0) {
        this.post({
          type: 'delta',
          messageID,
          kind: event.type === 'session.text.delta' ? 'text' : 'reasoning',
          delta,
        });
      }
      return;
    }

    if (event.type === 'session.execution.started') {
      this.busy = true;
      this.post({ type: 'busy', busy: true });
      return;
    }

    if (
      event.type === 'session.execution.succeeded' ||
      event.type === 'session.execution.failed' ||
      event.type === 'session.execution.interrupted'
    ) {
      this.busy = false;
      this.post({ type: 'busy', busy: false });
      void (async () => {
        await this.loadMessages();
        await this.loadSessions();
        if (this.session) {
          const fresh = this.sessions.find((entry) => entry.id === this.session?.id);
          if (fresh) {
            this.session = fresh;
          }
        }
        this.post({ type: 'messages', messages: this.messages });
        this.post({ type: 'sessions', sessions: this.sessions, session: this.session });
      })();
      return;
    }

    if (
      event.type === 'session.created' ||
      event.type === 'session.renamed' ||
      event.type === 'session.deleted' ||
      event.type === 'session.archived'
    ) {
      void this.loadSessions().then(() => {
        if (this.session) {
          const fresh = this.sessions.find((entry) => entry.id === this.session?.id);
          if (fresh) {
            this.session = fresh;
          }
        }
        this.post({ type: 'sessions', sessions: this.sessions, session: this.session });
      });
      return;
    }

    if (event.type.startsWith('session.tool.') || event.type.startsWith('session.step.') || event.type === 'session.text.started' || event.type === 'session.text.ended' || event.type === 'session.reasoning.started' || event.type === 'session.reasoning.ended' || event.type === 'session.inbox.delivered') {
      this.scheduleRefresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void (async () => {
        await this.loadMessages();
        this.post({ type: 'messages', messages: this.messages });
      })();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async handle(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.connectAndLoad();
        return;
      case 'newSession':
        await this.newSession();
        return;
      case 'openSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        const session = this.sessions.find((entry) => entry.id === id);
        if (!session) {
          return;
        }
        this.session = session;
        this.busy = session.running;
        await this.persistSession(id);
        await this.loadMessages();
        this.post({ type: 'state', state: this.snapshot() });
        this.post({ type: 'closeHistory' });
        return;
      }
      case 'send': {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (text.length === 0 || !this.client) {
          return;
        }
        if (!this.session) {
          await this.newSession();
        }
        if (!this.session) {
          return;
        }
        this.busy = true;
        this.post({ type: 'busy', busy: true });
        try {
          await this.client.prompt(this.session.id, text);
          await this.loadMessages();
          this.post({ type: 'messages', messages: this.messages });
        } catch (error) {
          this.busy = false;
          this.post({ type: 'busy', busy: false });
          this.fail(error);
        }
        return;
      }
      case 'stop':
        if (this.client && this.session) {
          try {
            await this.client.interrupt(this.session.id);
          } catch (error) {
            this.fail(error);
          }
        }
        return;
      case 'deleteSession': {
        const id = typeof message.id === 'string' ? message.id : '';
        if (!this.client || id.length === 0) {
          return;
        }
        const target = this.sessions.find((entry) => entry.id === id);
        const choice = await vscode.window.showWarningMessage(
          `Delete "${target?.title ?? id}"? This also deletes its child sessions.`,
          { modal: true },
          'Delete',
        );
        if (choice !== 'Delete') {
          return;
        }
        try {
          await this.client.deleteSession(id);
          if (this.session?.id === id) {
            this.session = undefined;
            this.messages = [];
          }
          await this.loadSessions();
          this.post({ type: 'state', state: this.snapshot() });
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      case 'searchSessions': {
        const query = typeof message.query === 'string' ? message.query : '';
        await this.loadSessions(query);
        this.post({ type: 'sessions', sessions: this.sessions, session: this.session });
        return;
      }
      case 'selectModel': {
        if (!this.client || !this.session) {
          return;
        }
        const selection = message.selection as Selection | undefined;
        if (!selection) {
          return;
        }
        try {
          await this.client.selectModel(this.session.id, {
            id: selection.id,
            providerID: selection.providerID,
            variant: selection.variant,
          });
          await this.loadMessages();
          this.post({ type: 'state', state: this.snapshot() });
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      case 'selectAgent': {
        if (!this.client || !this.session) {
          return;
        }
        const agent = typeof message.agent === 'string' ? message.agent : '';
        if (agent.length === 0) {
          return;
        }
        try {
          await this.client.selectAgent(this.session.id, agent);
          await this.loadMessages();
          this.post({ type: 'state', state: this.snapshot() });
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      case 'copy': {
        const text = typeof message.text === 'string' ? message.text : '';
        await vscode.env.clipboard.writeText(text);
        return;
      }
      case 'openExternal': {
        const url = typeof message.url === 'string' ? message.url : '';
        if (/^https?:\/\//i.test(url)) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        return;
      }
      case 'openBrowser':
        await vscode.commands.executeCommand('opencode.sidekick.openInBrowser');
        return;
      case 'openTerminal':
        await vscode.commands.executeCommand('opencode.sidekick.openTerminal');
        return;
      case 'refresh':
        await this.reload();
        return;
      default:
        return;
    }
  }

  private async persistSession(sessionID: string): Promise<void> {
    await this.context.workspaceState.update(SESSION_KEY, {
      directory: this.directory,
      sessionID,
    } satisfies StoredSelection);
  }

  private snapshot(): Record<string, unknown> {
    return {
      connected: this.client !== undefined,
      error: this.lastError,
      directory: this.directory,
      workspace: vscode.workspace.workspaceFolders?.[0]?.name ?? this.directory,
      session: this.session ?? undefined,
      sessions: this.sessions,
      messages: this.messages,
      models: this.models,
      agents: this.agents,
      busy: this.busy,
      model: this.session?.model,
      agent: this.session?.agent,
    };
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.post({ type: 'error', message });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const policy = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode</title>
    <link rel="stylesheet" href="${style}" />
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
