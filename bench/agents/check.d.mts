// Types of check.mjs, for the test that checks the benchmark (tests/bench/tasks.test.ts).
export interface Check {
  readonly file: string;
  readonly kind: 'document' | 'text' | 'json';
  readonly contains?: readonly string[];
  readonly notContains?: readonly string[];
  readonly parts?: { readonly prefix: string; readonly notes: boolean; readonly count: number };
}

export function checkTask(task: { readonly checks: readonly Check[] }, dir: string, preview: (bytes: Uint8Array) => { readonly text: string }): string[];
