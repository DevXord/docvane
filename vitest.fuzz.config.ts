import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

// `npm run fuzz`: only the property tests, with many more runs than in `npm test`. The first ones
// came with the template parser in phase 1; an empty run is still not a failure.
// A spread, not mergeConfig: mergeConfig concatenates `include`, which would run every test.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/fuzz/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 600_000,
    env: { TV_FUZZ_RUNS: process.env['TV_FUZZ_RUNS'] ?? '10000' },
  },
});
