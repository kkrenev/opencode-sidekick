import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Downloads a stable VS Code, loads the extension from this checkout and runs
 * the smoke suite inside the extension host. The suite throws on the first
 * failed assertion, which turns into a non-zero exit code of `npm run test:smoke`.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const launchArgs = [
    '--disable-extensions',
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
  ];
  // The CI container runs as root, where Chromium refuses to start without it.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    launchArgs.push('--no-sandbox');
  }

  await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs });
}

main().catch((error: unknown) => {
  console.error('Smoke run failed:', error);
  process.exit(1);
});
