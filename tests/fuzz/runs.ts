// Copied from DevXord/xlvane tests/fuzz/runs.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes.
// Number of runs per property, from TV_FUZZ_RUNS (100 for `npm test`, 10000 for `npm run fuzz`).

const DEFAULT_RUNS = 100;

function readRuns(): number {
  const raw = process.env['TV_FUZZ_RUNS'];
  if (raw === undefined || raw === '') return DEFAULT_RUNS;
  const runs = Number(raw);
  if (!Number.isSafeInteger(runs) || runs < 1) {
    throw new Error(`TV_FUZZ_RUNS must be a positive whole number, got "${raw}".`);
  }
  return runs;
}

/** Runs per property; pass as `{ numRuns: NUM_RUNS }` to `fc.assert`. */
export const NUM_RUNS: number = readRuns();
