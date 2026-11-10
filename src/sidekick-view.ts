import * as vscode from 'vscode';
import { LocalProxy, startLocalProxy } from './local-proxy';
import { connect, OpenCodeEndpoint } from './opencode-endpoint';

export const VIEW_ID = 'opencode.sidekick';

export class SidekickViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private proxy: LocalProxy | undefined;
  private proxyTarget: string | undefined;
  private proxyCredential: string | undefined;
  private endpoint: OpenCodeEndpoint | undefined;

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      enableCommandUris: ['opencode.sidekick.reload'],
    };
    view.webview.html = this.noticeHtml('Connecting to the OpenCode server');
    view.onDidDispose(() => {
      this.view = undefined;
    });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }

    try {
      const endpoint = await connect();
      if (this.view !== view) {
        return;
      }
      this.endpoint = endpoint;
      let proxy = this.proxy;
      if (
        !proxy ||
        this.proxyTarget !== endpoint.url ||
        this.proxyCredential !== endpoint.credential
      ) {
        proxy?.dispose();
        proxy = await startLocalProxy(new URL(endpoint.url), endpoint.credential);
        this.proxy = proxy;
        this.proxyTarget = endpoint.url;
        this.proxyCredential = endpoint.credential;
      }
      if (this.view !== view) {
        return;
      }
      view.webview.html = this.appHtml(proxy.origin, endpoint.credential);
    } catch (error) {
      if (this.view !== view) {
        return;
      }
      this.endpoint = undefined;
      const message = error instanceof Error ? error.message : String(error);
      view.webview.html = this.failureHtml(message);
    }
  }

  browserUrl(): string | undefined {
    if (!this.proxy || !this.endpoint) {
      return undefined;
    }
    return `${this.proxy.origin}/?auth_token=${encodeURIComponent(this.endpoint.credential)}`;
  }

  dispose(): void {
    this.proxy?.dispose();
    this.proxy = undefined;
    this.proxyTarget = undefined;
    this.proxyCredential = undefined;
    this.endpoint = undefined;
  }

  private appHtml(origin: string, credential: string): string {
    const source = `${origin}/?auth_token=${encodeURIComponent(credential)}`;
    const policy = [
      "default-src 'none'",
      `frame-src ${origin}`,
      `child-src ${origin}`,
      "style-src 'unsafe-inline'",
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <title>OpenCode</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        height: 100%;
        overflow: hidden;
        background: var(--vscode-sideBar-background);
      }

      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe src="${source}" title="OpenCode" allow="clipboard-read; clipboard-write"></iframe>
  </body>
</html>`;
  }

  private noticeHtml(text: string): string {
    return this.staticHtml(`<p class="notice">${text}&hellip;</p>`);
  }

  private failureHtml(message: string): string {
    return this.staticHtml(`
      <p class="notice">OpenCode Sidekick could not start.</p>
      <p class="detail">${escapeHtml(message)}</p>
      <p><a href="command:opencode.sidekick.reload">Retry</a></p>
    `);
  }

  private staticHtml(body: string): string {
    const policy = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <title>OpenCode</title>
    <style>
      body {
        margin: 0;
        padding: 16px 14px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-sideBar-foreground);
        background: var(--vscode-sideBar-background);
      }

      .notice {
        margin: 0;
        opacity: 0.9;
      }

      .detail {
        margin: 10px 0 0;
        opacity: 0.7;
        line-height: 1.45;
      }

      a {
        display: inline-block;
        margin-top: 14px;
        padding: 4px 10px;
        border-radius: 3px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        text-decoration: none;
      }

      a:hover {
        background: var(--vscode-button-hoverBackground);
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
