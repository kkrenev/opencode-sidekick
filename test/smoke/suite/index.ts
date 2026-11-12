import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'kkrenev.opencode-sidekick';
const CONTAINER_ID = 'opencodeSidekickContainer';

interface Manifest {
  readonly contributes?: {
    readonly commands?: readonly { readonly command: string }[];
    readonly viewsContainers?: Record<string, readonly { readonly id: string }[] | undefined>;
    readonly views?: Record<
      string,
      readonly { readonly id: string; readonly type?: string }[] | undefined
    >;
  };
}

/**
 * Runs inside the extension host. Every check here answers a question the unit
 * tests cannot: the extension activates in a real VS Code, its manifest
 * commands are really registered, the view container resolves, and a command
 * that needs a session warns instead of throwing.
 */
export async function run(): Promise<void> {
  // The smoke window has no OpenCode CLI; starting a server would only add noise.
  await vscode.workspace
    .getConfiguration('opencodeSidekick')
    .update('autoStartServer', false, vscode.ConfigurationTarget.Global);

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} is installed`);
  await extension.activate();
  assert.equal(extension.isActive, true, 'extension is active after activate()');
  console.log(`smoke: ${EXTENSION_ID} activated`);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'),
  ) as Manifest;

  const declared = (manifest.contributes?.commands ?? []).map((entry) => entry.command);
  assert.ok(declared.length > 0, 'the manifest declares commands');
  const registered = new Set(await vscode.commands.getCommands(true));
  const missing = declared.filter((command) => !registered.has(command));
  assert.deepEqual(
    missing,
    [],
    `commands missing from the command registry: ${missing.join(', ')}`,
  );
  console.log(`smoke: ${declared.length} manifest commands are registered`);

  const containers = manifest.contributes?.viewsContainers?.secondarySidebar ?? [];
  assert.ok(
    containers.some((container) => container.id === CONTAINER_ID),
    `view container ${CONTAINER_ID} is declared in the manifest`,
  );
  // A container without the webview view renders an empty sidebar, so the
  // contribution itself is part of what the build must ship.
  const views = manifest.contributes?.views?.[CONTAINER_ID] ?? [];
  assert.ok(
    views.some((view) => view.id === 'opencode.sidekick' && view.type === 'webview'),
    `view opencode.sidekick is contributed to ${CONTAINER_ID} as a webview`,
  );
  console.log(`smoke: ${CONTAINER_ID} contributes the opencode.sidekick webview`);
  // Revealing the container resolves the contributed view; an unregistered
  // contribution fails here instead of leaving an empty sidebar in the build.
  await vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`);
  console.log(`smoke: view container ${CONTAINER_ID} resolved`);

  // The smoke window has no session: the command must warn, never throw.
  await vscode.commands.executeCommand('opencode.sidekick.openChatInEditor');
  console.log('smoke: openChatInEditor without a session did not throw');
}
