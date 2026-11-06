// Node.js globals used by tests and scripts only. Not visible to package sources, so core code
// cannot accidentally depend on `process` (same rule as in xlvane: no @types/node).

declare const process: {
  readonly env: Record<string, string | undefined>;
};
