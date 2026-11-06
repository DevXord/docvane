// The plan, the decision log, the development changelog and the fact files are internal notes
// kept only on the maintainer's machine (CLAUDE.md, "Internal documents"). They are not tracked by
// Git, .gitignore keeps them out, and no tracked text that readers or the npm tarball see names
// them as files to open.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INTERNAL = ['docs/PLAN.md', 'docs/decisions.md', 'docs/CHANGELOG-dev.md', 'docs/facts/'];
/** A path of an internal document, as a Markdown link target or as plain text. */
const MENTION = /\bdocs\/(?:PLAN\.md|decisions\.md|CHANGELOG-dev\.md|facts\/)|\]\((?:\.\.?\/)*(?:PLAN|decisions|CHANGELOG-dev)\.md|\]\((?:\.\.?\/)*facts\//;

const tracked = (): string[] => spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

describe('internal documents', () => {
  it('are not tracked by Git', () => {
    const files = tracked();
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => INTERNAL.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)))).toEqual([]);
  });

  it('are listed in .gitignore', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    for (const p of INTERNAL) expect(ignore, p).toContain(p);
  });

  it('are not named in the Markdown that readers and the npm tarball see', () => {
    const files = tracked().filter((f) => f.endsWith('.md') && f !== 'CLAUDE.md' && !f.startsWith('tests/'));
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((f) =>
      readFileSync(join(ROOT, f), 'utf8')
        .split('\n')
        .flatMap((line, i) => (MENTION.test(line) ? [`${f}:${String(i + 1)}: ${line.trim().slice(0, 100)}`] : [])),
    );
    expect(found).toEqual([]);
  });

  it('the pattern finds links and plain paths', () => {
    for (const s of ['see [plan](docs/PLAN.md)', 'docs/decisions.md D-001', '[log](../CHANGELOG-dev.md)', 'docs/facts/opc.md', '[f](facts/opc.md)']) expect(MENTION.test(s), s).toBe(true);
    for (const s of ['CHANGELOG.md', 'docs/errors.md', 'decision D-001']) expect(MENTION.test(s), s).toBe(false);
  });
});
