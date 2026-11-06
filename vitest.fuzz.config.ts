import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// `npm run fuzz`: only the property tests, with many more runs than in `npm test`. The first ones
// come with the template parser in phase 1; until then an empty run is not a failure.
// A spread, not mergeConfig: mergeConfig concatenates `include`, which would run every test.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/fuzz/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 600_000,
    env: { DV_FUZZ_RUNS: process.env['DV_FUZZ_RUNS'] ?? '10000' },
  },
});
