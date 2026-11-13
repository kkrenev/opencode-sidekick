import * as vscode from 'vscode';
import { CHAT_PANEL_VIEW_TYPE } from './chat-panel';
import { resolveCli } from './opencode-endpoint';
import { SidekickViewProvider, VIEW_ID } from './sidekick-view';

const CONTAINER_ID = 'opencodeSidekickContainer';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidekickViewProvider(context);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, {
      async deserializeWebviewPanel(panel, state) {
        await provider.restoreChatPanel(panel, state);
      },
    }),
    vscode.commands.registerCommand('opencode.sidekick.focus', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
    }),
    vscode.commands.registerCommand('opencode.sidekick.openChatInEditor', async () => {
      await provider.openChatInEditor();
    }),
    vscode.commands.registerCommand('opencode.sidekick.newSession', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.newSession();
    }),
    vscode.commands.registerCommand('opencode.sidekick.history', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.showHistory();
    }),
    vscode.commands.registerCommand('opencode.sidekick.searchSessions', async () => {
      // The picker opens in the editor area, but the session it picks lands in
      // the panel: a fresh window has to show that panel before the picker can
      // even talk to the server.
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.searchSessions();
    }),
    vscode.commands.registerCommand('opencode.sidekick.settings', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      provider.openSettings();
    }),
    vscode.commands.registerCommand('opencode.sidekick.reload', async () => {
      await provider.reload();
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
        cwd: provider.directory,
      });
      terminal.show();
      terminal.sendText(cli ? quoteForShell(cli) : 'opencode');
    }),
    vscode.commands.registerCommand('opencode.sidekick.attachScreenshot', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.attachScreenshot();
    }),
    vscode.commands.registerCommand('opencode.sidekick.attachSelection', async (uri?: vscode.Uri) => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.attachSelectionFromCommand(editorFor(uri), uri);
    }),
    vscode.commands.registerCommand('opencode.sidekick.addFileToChat', async (uri?: vscode.Uri) => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.addFileToChat(uri);
    }),
    vscode.commands.registerCommand(
      'opencode.sidekick.addProblemsToChat',
      async (uri?: vscode.Uri) => {
        await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
        await provider.addProblemsToChat(uri);
      },
    ),
    vscode.commands.registerCommand('opencode.sidekick.copyLastAnswer', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.copyLastAnswer();
    }),
    vscode.commands.registerCommand('opencode.sidekick.copyTranscript', async () => {
      await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
      await provider.copyTranscript();
    }),
    // Pure clipboard: works from any editor, so the panel stays closed.
    vscode.commands.registerCommand('opencode.sidekick.copySelection', async () => {
      await provider.copySelectionWithReference();
    }),
  );
}

export function deactivate(): void {}

/** The visible editor a context-menu command was invoked on, if it is still open. */
function editorFor(uri: vscode.Uri | undefined): vscode.TextEditor | undefined {
  if (!uri) {
    return vscode.window.activeTextEditor;
  }
  const target = uri.toString();
  return vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === target,
  );
}

function quoteForShell(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
