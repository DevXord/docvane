// Phase 10: GitHub Actions are pinned to the full commit of a release, with the tag in a comment,
// and workflows get only read access unless a job says otherwise.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../.github/workflows', import.meta.url));
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')) : [];

describe('GitHub workflows', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s pins every action to a commit and reads only by default', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8');
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, action, rest] of uses) {
      expect(action, file).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/);
      expect(rest, `${action} needs the tag in a comment`).toMatch(/#\s*v\d/);
    }
    // Read only, or nothing at all (the release workflow gives each job its own permissions).
    expect(text).toMatch(/^permissions:\s*(\{\}\s*$|\n\s+contents:\s*read)/m);
    expect(text).not.toMatch(/secrets\./);
  });
});
