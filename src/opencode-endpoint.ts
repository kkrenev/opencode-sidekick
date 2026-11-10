import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

const HEALTH_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 250;

export interface OpenCodeEndpoint {
  readonly url: string;
  readonly credential: string;
}

interface ServiceFile {
  readonly url?: string;
  readonly password?: string;
}

function stateDirectory(): string {
  const configured = process.env.XDG_STATE_HOME;
  return configured && configured.length > 0 ? configured : path.join(os.homedir(), '.local', 'state');
}

function serviceFilePath(): string {
  return path.join(stateDirectory(), 'opencode', 'service.json');
}

function cliCandidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin', 'opencode'),
    path.join(home, '.opencode', 'bin', 'opencode'),
    path.join(home, '.bun', 'bin', 'opencode'),
    path.join(home, '.local', 'share', 'opencode', 'bin', 'opencode'),
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
  ];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readEndpoint(): Promise<OpenCodeEndpoint | undefined> {
  try {
    const raw = await fs.readFile(serviceFilePath(), 'utf8');
    const file = JSON.parse(raw) as ServiceFile;
    if (!file.url || !file.password) {
      return undefined;
    }
    return {
      url: file.url,
      credential: Buffer.from(`opencode:${file.password}`).toString('base64'),
    };
  } catch {
    return undefined;
  }
}

async function isReachable(endpoint: OpenCodeEndpoint): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(new URL('/api/info', endpoint.url), {
      headers: { authorization: `Basic ${endpoint.credential}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveCli(): Promise<string | undefined> {
  const configured = vscode.workspace
    .getConfiguration('opencodeSidekick')
    .get<string>('cliPath', '')
    .trim();
  if (configured.length > 0) {
    return configured;
  }

  try {
    const { stdout } = await execFileAsync('which', ['opencode']);
    const found = stdout.trim().split('\n')[0];
    if (found.length > 0) {
      return found;
    }
  } catch {
    // Fall through to the well-known install locations.
  }

  for (const candidate of cliCandidates()) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next location.
    }
  }

  return undefined;
}

async function startServer(cli: string): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  await execFileAsync(cli, ['service', 'start'], { cwd: workspaceRoot, timeout: START_TIMEOUT_MS });
}

async function waitForEndpoint(): Promise<OpenCodeEndpoint | undefined> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const endpoint = await readEndpoint();
    if (endpoint && (await isReachable(endpoint))) {
      return endpoint;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}

export async function connect(): Promise<OpenCodeEndpoint> {
  const existing = await readEndpoint();
  if (existing && (await isReachable(existing))) {
    return existing;
  }

  const autoStart = vscode.workspace
    .getConfiguration('opencodeSidekick')
    .get<boolean>('autoStartServer', true);
  const cli = autoStart ? await resolveCli() : undefined;

  if (cli) {
    try {
      await startServer(cli);
    } catch {
      // The poll below reports the real outcome.
    }
    const started = await waitForEndpoint();
    if (started) {
      return started;
    }
    throw new Error(
      `OpenCode server did not become reachable. "${cli} service start" was run, but no healthy server answered on the configured port.`,
    );
  }

  throw new Error(
    'OpenCode server is not running and the opencode CLI was not found. Install OpenCode from https://opencode.ai, or set "opencodeSidekick.cliPath" to the executable.',
  );
}
