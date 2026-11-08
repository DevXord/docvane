// CLAUDE.md: every error has a TV_E_* code and an entry in docs/errors.md. This test keeps the
// code list, the catalogue and the sources in step.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, WARNING_CODES } from 'tplvane';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const catalogue = readFileSync(join(ROOT, 'docs', 'errors.md'), 'utf8');
const headings = [...catalogue.matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
const CODES: readonly string[] = [...ERROR_CODES, ...WARNING_CODES];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith('.ts') ? [path] : [];
  });
}

describe('docs/errors.md', () => {
  it('has a section and an index row for every code, and no others', () => {
    expect([...headings].sort()).toEqual([...CODES].sort());
    for (const code of CODES) expect(catalogue, code).toContain(`[\`${code}\`](#${code.toLowerCase()})`);
  });

  it('gives a fix for every error and warning', () => {
    for (const section of catalogue.split(/^### /m).slice(1)) expect(section, section.slice(0, 40)).toMatch(/\*\*Fix:\*\*/);
  });

  it('lists every code the sources use', () => {
    const used = new Set(sources(join(ROOT, 'packages', 'tplvane', 'src')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/\bDV_[EW]_[A-Z_]+\b/g)].map((m) => m[0])));
    expect([...used].filter((code) => !CODES.includes(code))).toEqual([]);
  });
});
