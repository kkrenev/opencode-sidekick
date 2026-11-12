import type * as vscode from 'vscode';

/** View type of the singleton chat panel; its serializer is registered for it. */
export const CHAT_PANEL_VIEW_TYPE = 'opencode.sidekick.chat';

/** State the tab icon shows. */
export type ChatPanelStatus = 'running' | 'attention' | 'idle';

export interface ChatPanelChrome {
  readonly title: string;
  readonly status: ChatPanelStatus;
  /** Icon per status, resolved by the provider from the extension resources. */
  readonly icons: Readonly<Record<ChatPanelStatus, vscode.Uri>>;
}

export interface ChatPanelTarget {
  readonly sessionID: string;
  readonly title: string;
  readonly column: vscode.ViewColumn;
}

export interface ChatPanelOptions {
  readonly extensionUri: vscode.Uri;
  readonly globalStorageUri: vscode.Uri;
  /** The document the sidebar boots, with resource roots of its own webview. */
  readonly html: (webview: vscode.Webview) => Promise<string>;
  readonly createPanel: (
    viewType: string,
    title: string,
    column: vscode.ViewColumn,
    options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
  ) => vscode.WebviewPanel;
  /** A frame from the panel webview; the provider routes it like the sidebar. */
  readonly onMessage: (message: { type: string; [key: string]: unknown }) => void;
  /** The webview finished booting, so its surface can take broadcasts. */
  readonly onReady: () => void;
  /** The user closed the tab: the chat stays, the stored target goes. */
  readonly onDispose: () => void;
}

/**
 * Singleton editor tab that renders the same chat as the sidebar. It knows
 * nothing about sessions: closing it never stops a turn and never deletes
 * anything, and `show()` reveals the existing tab instead of opening a second
 * one.
 */
export class ChatEditorPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  /** Newest shared state that arrived before the webview said `ready`. */
  private pending: Record<string, unknown> | undefined;
  private chrome: ChatPanelChrome | undefined;
  private target: string | undefined;

  constructor(private readonly options: ChatPanelOptions) {}

  get webview(): vscode.Webview | undefined {
    return this.panel?.webview;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get visible(): boolean {
    return this.panel !== undefined;
  }

  /** Session the tab follows; `undefined` before the first `show`/`restore`. */
  get sessionID(): string | undefined {
    return this.target;
  }

  async show(request: ChatPanelTarget): Promise<void> {
    this.target = request.sessionID;
    const existing = this.panel;
    if (existing) {
      // The provider syncs the chrome right after `show`, so the title here is
      // only what the reveal shows for a moment.
      existing.title = request.title;
      existing.reveal();
      return;
    }
    const panel = this.options.createPanel(CHAT_PANEL_VIEW_TYPE, request.title, request.column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.options.extensionUri, this.options.globalStorageUri],
    });
    await this.boot(panel);
    panel.reveal();
  }

  /** Takes a panel the serializer restored; nothing is created or revealed. */
  async restore(panel: vscode.WebviewPanel, sessionID: string | undefined): Promise<void> {
    this.target = sessionID;
    await this.boot(panel);
  }

  /**
   * Holds the newest shared state while the webview boots and drops every
   * other frame: a request-scoped reply needs a live webview to arrive in.
   */
  post(message: Record<string, unknown>): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    if (!this.ready) {
      if (message.type === 'state') {
        this.pending = message;
      }
      return;
    }
    void panel.webview.postMessage(message);
  }

  syncChrome(chrome: ChatPanelChrome): void {
    this.chrome = chrome;
    this.applyChrome();
  }

  /** Extension shutdown: the panel dies with the window, the target is kept. */
  dispose(): void {
    const panel = this.panel;
    this.reset();
    panel?.dispose();
  }

  private async boot(panel: vscode.WebviewPanel): Promise<void> {
    this.panel = panel;
    this.ready = false;
    this.pending = undefined;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.options.extensionUri, this.options.globalStorageUri],
    };
    panel.onDidDispose(() => {
      if (this.panel !== panel) {
        // `dispose()` already reset the panel and keeps the stored target.
        return;
      }
      this.reset();
      this.options.onDispose();
    });
    panel.webview.onDidReceiveMessage((message: { [key: string]: unknown }) => {
      const type = typeof message.type === 'string' ? message.type : '';
      if (type === 'ready') {
        this.markReady();
      }
      this.options.onMessage(message as { type: string; [key: string]: unknown });
    });
    this.applyChrome();
    try {
      panel.webview.html = await this.options.html(panel.webview);
    } catch (error) {
      panel.dispose();
      throw error;
    }
  }

  private markReady(): void {
    this.ready = true;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      void this.panel?.webview.postMessage(pending);
    }
    this.options.onReady();
  }

  private applyChrome(): void {
    const panel = this.panel;
    const chrome = this.chrome;
    if (!panel || !chrome) {
      return;
    }
    panel.title = chrome.title;
    panel.iconPath = chrome.icons[chrome.status];
  }

  private reset(): void {
    this.panel = undefined;
    this.ready = false;
    this.pending = undefined;
    this.target = undefined;
  }
}
