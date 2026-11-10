import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { mapMessages, UiMessage } from './message-map';
import {
  AgentAttachment,
  AgentEntry,
  CommandEntry,
  FileAttachment,
  ModelEntry,
  ModelSelection,
  OpenCodeClient,
  PromptAttachments,
  SessionSummary,
  SkillAttachment,
  SkillEntry,
  StreamEvent,
} from './opencode-client';
import { connect, OpenCodeEndpoint } from './opencode-endpoint';
import {
  isSettingKey,
  readSettings,
  resetUiSettings,
  SidekickSettings,
  writeSetting,
} from './settings';

export const VIEW_ID = 'opencode.sidekick';

const SESSION_KEY = 'opencode.sidekick.session';
const REFRESH_DEBOUNCE_MS = 320;

interface StoredSelection {
  readonly directory: string;
  readonly sessionID: string;
}

interface DefaultSelection {
  readonly model?: ModelSelection;
  readonly effort?: string;
  readonly mode?: string;
}

export class SidekickViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private client: OpenCodeClient | undefined;
  private endpoint: OpenCodeEndpoint | undefined;
  private stopStream: (() => void) | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private sessionRefreshTimer: NodeJS.Timeout | undefined;
  private session: SessionSummary | undefined;
  private sessions: SessionSummary[] = [];
  private messages: UiMessage[] = [];
  private models: ModelEntry[] = [];
  private agents: AgentEntry[] = [];
  private commands: CommandEntry[] = [];
  private skills: SkillEntry[] = [];
  private defaultModel: ModelSelection | undefined;
  private settings: SidekickSettings = readSettings();
  private configSubscription: vscode.Disposable | undefined;
  private pendingSettings = false;
  private webviewReady = false;
  private busy = false;
  private lastError: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('opencodeSidekick')) {
        return;
      }
      this.settings = readSettings();
      this.post({ type: 'state', state: this.snapshot() });
    });
  }

  get directory(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
    };
    try {
      view.webview.html = await this.html();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      view.webview.html = `<html><body><pre>OpenCode Sidekick failed to load: ${message.replace(/</g, '&lt;')}</pre></body></html>`;
    }
    view.onDidDispose(() => {
      this.view = undefined;
      this.webviewReady = false;
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
      await this.applyNewSessionDefaults(session);
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

  openSettings(): void {
    if (!this.view || !this.webviewReady) {
      this.pendingSettings = true;
      return;
    }
    this.post({ type: 'openSettings' });
  }

  async reload(): Promise<void> {
    await this.connectAndLoad();
  }

  dispose(): void {
    this.stopStream?.();
    this.stopStream = undefined;
    this.configSubscription?.dispose();
    this.configSubscription = undefined;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.sessionRefreshTimer) {
      clearTimeout(this.sessionRefreshTimer);
      this.sessionRefreshTimer = undefined;
    }
    this.client = undefined;
    this.endpoint = undefined;
    this.webviewReady = false;
  }

  private async connectAndLoad(): Promise<void> {
    try {
      this.endpoint = await connect();
      this.client = new OpenCodeClient(this.endpoint);
      this.lastError = undefined;
      this.stopStream?.();
      this.stopStream = this.client.subscribe((event) => this.onEvent(event));

      await Promise.all([
        this.loadModels(),
        this.loadAgents(),
        this.loadCommands(),
        this.loadSkills(),
        this.loadDefaultModel(),
      ]);
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

  private async loadCommands(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.commands = await this.client.listCommands(this.directory);
    } catch {
      this.commands = [];
    }
  }

  private async loadSkills(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.skills = await this.client.listSkills(this.directory);
    } catch {
      this.skills = [];
    }
  }

  private async loadDefaultModel(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.defaultModel = await this.client.getDefaultModel(this.directory);
    } catch {
      this.defaultModel = undefined;
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

  private async refreshSession(): Promise<void> {
    if (!this.client || !this.session) {
      return;
    }
    try {
      this.session = await this.client.getSession(this.session.id);
    } catch {
      // The next event or manual reload will reconcile the session.
    }
  }

  private scheduleSessionRefresh(delay = 350): void {
    if (this.sessionRefreshTimer) {
      clearTimeout(this.sessionRefreshTimer);
    }
    this.sessionRefreshTimer = setTimeout(() => {
      this.sessionRefreshTimer = undefined;
      void this.refreshSession().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
    }, delay);
  }

  private async ensureSession(): Promise<SessionSummary | undefined> {
    if (this.session) {
      return this.session;
    }
    await this.newSession();
    return this.session;
  }

  private computeDefaults(): DefaultSelection {
    const configured = parseModelSetting(this.settings.defaultModel);
    const configuredEntry = configured
      ? this.models.find(
          (entry) => entry.id === configured.id && entry.providerID === configured.providerID,
        )
      : undefined;
    const model = configuredEntry ? configured : this.defaultModel;
    const primary = this.agents.filter((agent) => !agent.hidden && agent.mode === 'primary');
    const mode =
      this.settings.defaultMode ||
      primary.find((agent) => agent.id === 'build')?.id ||
      primary[0]?.id;
    let effort = this.settings.defaultEffort || undefined;
    if (!effort && model && mode) {
      const agent = this.agents.find((entry) => entry.id === mode);
      if (
        agent?.model &&
        agent.model.id === model.id &&
        agent.model.providerID === model.providerID
      ) {
        effort = agent.model.variant;
      }
    }
    return { model, mode, effort };
  }

  private async applyNewSessionDefaults(session: SessionSummary): Promise<void> {
    if (!this.client) {
      return;
    }
    const explicitModel = this.settings.defaultModel.trim().length > 0;
    const explicitEffort = this.settings.defaultEffort.trim().length > 0;
    const explicitMode = this.settings.defaultMode.trim().length > 0;
    if (!explicitModel && !explicitEffort && !explicitMode) {
      return;
    }
    const defaults = this.computeDefaults();
    try {
      let next = session;
      if ((explicitModel || explicitEffort) && defaults.model) {
        const model = {
          id: defaults.model.id,
          providerID: defaults.model.providerID,
          variant: explicitEffort ? this.settings.defaultEffort : undefined,
        };
        await this.client.selectModel(session.id, model);
        next = { ...next, model };
      }
      if (explicitMode && defaults.mode) {
        await this.client.selectAgent(session.id, defaults.mode);
        next = { ...next, agent: defaults.mode };
      }
      if (this.session?.id === session.id) {
        this.session = next;
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private async applySetting(key: string, value: unknown): Promise<void> {
    if (!isSettingKey(key)) {
      return;
    }
    try {
      await writeSetting(key, value);
      this.settings = readSettings();
      this.post({ type: 'state', state: this.snapshot() });
    } catch (error) {
      this.fail(error);
    }
  }

  private async applyModel(selection: ModelSelection): Promise<void> {
    if (!this.client) {
      return;
    }
    const session = await this.ensureSession();
    if (!session) {
      return;
    }
    try {
      await this.client.selectModel(session.id, selection);
      if (this.session?.id === session.id) {
        this.session = { ...this.session, model: selection };
      }
      this.post({ type: 'state', state: this.snapshot() });
      this.scheduleSessionRefresh();
    } catch (error) {
      this.fail(error);
    }
  }

  private async applyAgent(agent: string): Promise<void> {
    if (!this.client || agent.length === 0) {
      return;
    }
    const session = await this.ensureSession();
    if (!session) {
      return;
    }
    try {
      await this.client.selectAgent(session.id, agent);
      if (this.session?.id === session.id) {
        this.session = { ...this.session, agent };
      }
      this.post({ type: 'state', state: this.snapshot() });
      this.scheduleSessionRefresh();
    } catch (error) {
      this.fail(error);
    }
  }

  private matchCommand(text: string): { name: string; args: string } | undefined {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) {
      return undefined;
    }
    const name = match[1];
    if (!this.commands.some((command) => command.name === name)) {
      return undefined;
    }
    return { name, args: match[2] ?? '' };
  }

  private async parseAttachments(text: string): Promise<PromptAttachments> {
    const skills: SkillAttachment[] = [];
    const agents: AgentAttachment[] = [];
    const files: FileAttachment[] = [];
    const seenSkills = new Set<string>();
    const seenAgents = new Set<string>();
    const seenFiles = new Set<string>();
    const pattern = /(^|[\s(])@([A-Za-z0-9_.:/-]+)/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const token = match[2];
      const start = match.index + match[1].length;
      const end = start + token.length + 1;
      const mention = { start, end, text: text.slice(start, end) };

      const skill = this.skills.find((entry) => entry.id === token || entry.name === token);
      if (skill) {
        if (!seenSkills.has(skill.id)) {
          seenSkills.add(skill.id);
          skills.push({ id: skill.id, mention });
        }
        continue;
      }

      const agent = this.agents.find((entry) => entry.id === token || entry.name === token);
      if (agent && !agent.hidden) {
        if (!seenAgents.has(agent.id)) {
          seenAgents.add(agent.id);
          agents.push({ name: agent.id, mention });
        }
        continue;
      }

      const file = await this.resolveFile(token);
      if (file && !seenFiles.has(file.uri)) {
        seenFiles.add(file.uri);
        files.push({ ...file, mention });
      }
    }

    return { skills, agents, files };
  }

  private async resolveFile(token: string): Promise<{ uri: string; name: string } | undefined> {
    const relative = token.replace(/^\.\//, '');
    if (relative.length === 0) {
      return undefined;
    }
    const root = path.resolve(this.directory);
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      return undefined;
    }
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { uri: vscode.Uri.file(absolute).toString(), name: relative };
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

    if (event.type === 'session.model.selected' || event.type === 'session.agent.selected') {
      void this.refreshSession().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
      return;
    }

    if (event.type === 'command.updated') {
      void this.loadCommands().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
      return;
    }

    if (event.type === 'skill.updated') {
      void this.loadSkills().then(() => {
        this.post({ type: 'state', state: this.snapshot() });
      });
      return;
    }

    if (event.type.startsWith('session.tool.') || event.type.startsWith('session.step.') || event.type === 'session.text.started' || event.type === 'session.text.ended' || event.type === 'session.reasoning.started' || event.type === 'session.reasoning.ended' || event.type === 'session.inbox.delivered' || event.type === 'session.skill.activated') {
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
        this.webviewReady = true;
        await this.connectAndLoad();
        if (this.pendingSettings) {
          this.pendingSettings = false;
          this.post({ type: 'openSettings' });
        }
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
          const command = this.matchCommand(text);
          if (command) {
            const attachments = await this.parseAttachments(command.args);
            await this.client.command(this.session.id, command.name, command.args, attachments);
          } else {
            const attachments = await this.parseAttachments(text);
            await this.client.prompt(this.session.id, text, attachments);
          }
          await this.refreshSession();
          await this.loadMessages();
          this.post({ type: 'state', state: this.snapshot() });
          this.post({ type: 'messages', messages: this.messages });
          this.scheduleRefresh();
        } catch (error) {
          this.busy = false;
          this.post({ type: 'busy', busy: false });
          this.fail(error);
        }
        return;
      }
      case 'findFiles': {
        const query = typeof message.query === 'string' ? message.query : '';
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        if (!this.client) {
          this.post({ type: 'files', requestId, query, items: [] });
          return;
        }
        try {
          const items = await this.client.findFiles(this.directory, query);
          this.post({ type: 'files', requestId, query, items });
        } catch {
          this.post({ type: 'files', requestId, query, items: [] });
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
        const selection = message.selection as ModelSelection | undefined;
        if (!selection) {
          return;
        }
        await this.applyModel(selection);
        return;
      }
      case 'selectAgent': {
        const agent = typeof message.agent === 'string' ? message.agent : '';
        await this.applyAgent(agent);
        return;
      }
      case 'updateSetting': {
        const key = typeof message.key === 'string' ? message.key : '';
        await this.applySetting(key, message.value);
        return;
      }
      case 'resetSettings': {
        try {
          await resetUiSettings();
          this.settings = readSettings();
          this.post({ type: 'state', state: this.snapshot() });
        } catch (error) {
          this.fail(error);
        }
        return;
      }
      case 'openVscodeSettings': {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:kkrenev.opencode-sidekick',
        );
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
      commands: this.commands,
      skills: this.skills,
      defaultModel: this.defaultModel,
      defaults: this.computeDefaults(),
      settings: this.settings,
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

  private async html(): Promise<string> {
    const nonce = randomNonce();
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const [style, script] = await Promise.all([
      fs.readFile(path.join(media.fsPath, 'main.css'), 'utf8'),
      fs.readFile(path.join(media.fsPath, 'main.js'), 'utf8'),
    ]);
    const policy = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      "font-src data:",
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode</title>
    <style>${style}</style>
  </head>
  <body>
    <div id="root"><div class="boot">Starting OpenCode&hellip;</div></div>
    <script nonce="${nonce}">${script}</script>
  </body>
</html>`;
  }
}

function parseModelSetting(value: string): ModelSelection | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return undefined;
  }
  return {
    providerID: trimmed.slice(0, slash),
    id: trimmed.slice(slash + 1),
  };
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
