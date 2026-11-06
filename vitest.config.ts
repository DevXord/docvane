import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `npm test`: unit and policy tests. Property tests in tests/fuzz run here too, with a small
// number of runs; `npm run fuzz` runs them with many more.
export default defineConfig({
  resolve: {
    // In-process tests load the packages from their sources, not from dist, so they never depend
    // on a stale build. xlvane is not aliased: it is the published package, as for consumers.
    alias: [
      { find: /^docvane$/, replacement: fileURLToPath(new URL('packages/docvane/src/index.ts', import.meta.url)) },
      { find: /^@docvane\/mcp$/, replacement: fileURLToPath(new URL('packages/mcp/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      DV_FUZZ_RUNS: process.env['DV_FUZZ_RUNS'] ?? '100',
    },
  },
});
