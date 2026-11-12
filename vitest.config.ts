import { defineConfig } from 'vitest/config';

/**
 * Host-side unit tests. Everything here runs without a DOM: message mapping,
 * stream deltas, the composer palette and the pure formatters.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
});
