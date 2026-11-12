import { defineConfig } from 'vitest/config';

/**
 * Webview tests. They need a DOM and the `acquireVsCodeApi` host stub, so they
 * live in their own config and never load the node-only suite.
 */
export default defineConfig({
  // Vite 8 transforms with oxc; the automatic runtime matches the esbuild
  // bundle of `media/main.js`, so components render without a React import.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'jsdom',
    include: ['test/unit/**/*.test.tsx'],
    setupFiles: ['test/unit/webview/setup.ts'],
  },
});
