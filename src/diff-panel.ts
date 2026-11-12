import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FileDiffInfo, TurnDiffInit } from './shared/turn-diff';

/** Host-side fetch of one turn; the panel never sends a `to` bound. */
export interface TurnDiffFetchRequest {
  readonly requestId: string;
  readonly from: string;
}

/** Patches of one turn, already capped by the host. */
export interface TurnDiffPayload {
  readonly files: readonly FileDiffInfo[];
  readonly truncated: boolean;
  readonly tooLarge: boolean;
}

export interface TurnDiffPanelOptions {
  readonly extensionUri: vscode.Uri;
  readonly fetchDiff: (
    sessionID: string,
    request: TurnDiffFetchRequest,
  ) => Promise<TurnDiffPayload>;
  /** Opens a changed file at a 1-based line of the workspace directory. */
  readonly openFile: (file: string, line: number) => void | Promise<void>;
  readonly copy: (text: string) => Promise<boolean>;
}

/**
 * Singleton panel that shows the patches of one turn. The chat only carries
 * totals; this panel asks for the patches itself, so a big diff never reaches
 * the sidebar snapshot.
 */
export class TurnDiffPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private pending: TurnDiffInit | undefined;
  private target: { readonly sessionID: string } | undefined;

  constructor(private readonly options: TurnDiffPanelOptions) {}

  async show(init: TurnDiffInit): Promise<void> {
    this.target = { sessionID: init.sessionID };
    if (this.panel) {
      this.panel.title = init.title;
      this.panel.reveal();
      if (this.ready) {
        void this.panel.webview.postMessage({ type: 'init', init });
      } else {
        this.pending = init;
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'opencode.sidekick.diff',
      init.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.options.extensionUri],
      },
    );
    this.panel = panel;
    this.ready = false;
    this.pending = init;
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
      this.pending = undefined;
      this.target = undefined;
    });
    panel.webview.onDidReceiveMessage((message: { [key: string]: unknown }) => {
      void this.onMessage(message);
    });
    try {
      panel.webview.html = await this.html();
    } catch (error) {
      panel.dispose();
      throw error;
    }
    panel.reveal();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.ready = false;
    this.pending = undefined;
    this.target = undefined;
  }

  private async onMessage(message: { [key: string]: unknown }): Promise<void> {
    const type = typeof message.type === 'string' ? message.type : '';
    const target = this.target;
    if (!target) {
      return;
    }
    switch (type) {
      case 'ready': {
        this.ready = true;
        const pending = this.pending;
        this.pending = undefined;
        if (pending) {
          void this.panel?.webview.postMessage({ type: 'init', init: pending });
        }
        return;
      }
      case 'diff': {
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        const from = typeof message.from === 'string' ? message.from : '';
        if (requestId.length === 0 || from.length === 0) {
          return;
        }
        try {
          const payload = await this.options.fetchDiff(target.sessionID, { requestId, from });
          void this.panel?.webview.postMessage({
            type: 'diffResult',
            requestId,
            sessionID: target.sessionID,
            from,
            files: payload.files,
            truncated: payload.truncated,
            tooLarge: payload.tooLarge,
          });
        } catch (error) {
          void this.panel?.webview.postMessage({
            type: 'diffError',
            requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'copy': {
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        const text = typeof message.text === 'string' ? message.text : '';
        if (text.length === 0) {
          return;
        }
        const ok = await this.options.copy(text);
        if (requestId.length > 0) {
          void this.panel?.webview.postMessage({ type: 'copied', requestId, ok });
        }
        return;
      }
      case 'openFile': {
        const file = typeof message.file === 'string' ? message.file : '';
        const line = typeof message.line === 'number' && Number.isFinite(message.line)
          ? message.line
          : 1;
        if (file.length === 0) {
          return;
        }
        await this.options.openFile(file, line);
        return;
      }
      default:
        return;
    }
  }

  private async html(): Promise<string> {
    const nonce = randomNonce();
    const media = vscode.Uri.joinPath(this.options.extensionUri, 'media');
    const [style, script] = await Promise.all([
      fs.readFile(path.join(media.fsPath, 'diff.css'), 'utf8'),
      fs.readFile(path.join(media.fsPath, 'diff.js'), 'utf8'),
    ]);
    const policy = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "font-src data:",
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Changes</title>
    <style>${style}</style>
  </head>
  <body>
    <div id="root"><div class="boot">Loading changes&hellip;</div></div>
    <script nonce="${nonce}">${script}</script>
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
