import * as vscode from 'vscode';
import { resolveCli } from './opencode-endpoint';
import { SidekickViewProvider, VIEW_ID } from './sidekick-view';

const CONTAINER_ID = 'opencodeSidekickContainer';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidekickViewProvider();

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('opencode.sidekick.focus', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
    }),
    vscode.commands.registerCommand('opencode.sidekick.reload', async () => {
      await provider.refresh();
    }),
    vscode.commands.registerCommand('opencode.sidekick.openInBrowser', async () => {
      const url = provider.browserUrl();
      if (!url) {
        void vscode.window.showWarningMessage('OpenCode Sidekick is not connected yet.');
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('opencode.sidekick.openTerminal', async () => {
      const cli = await resolveCli();
      const terminal = vscode.window.createTerminal({
        name: 'opencode',
        location: vscode.TerminalLocation.Panel,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      });
      terminal.show();
      terminal.sendText(cli ? quoteForShell(cli) : 'opencode');
    }),
  );
}

export function deactivate(): void {}

function quoteForShell(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
