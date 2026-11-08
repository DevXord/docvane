// Phase 10: GitHub Actions are pinned to the full commit of a release, with the tag in a comment,
// and workflows get only read access unless a job says otherwise.
import { createHash } from 'node:crypto';
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

// Phase 12 (D-076): agentcurfew locks what steers coding agents in this repository, and CI checks it.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
describe('agentcurfew', () => {
  const ci = readFileSync(join(DIR, 'ci.yml'), 'utf8');

  it('runs in CI with a pinned version: verify against the lock, and scan against the policy', () => {
    expect(ci).toMatch(/npx --yes agentcurfew@\d+\.\d+\.\d+ verify/);
    expect(ci).toMatch(/npx --yes agentcurfew@\d+\.\d+\.\d+ scan/);
  });

  it('has a policy and a lock, and the lock matches the files it names', () => {
    const policy = JSON.parse(readFileSync(join(ROOT, 'agentcurfew.policy.json'), 'utf8')) as { version: number; failOn: string };
    expect(policy.version).toBe(1);
    const lock = JSON.parse(readFileSync(join(ROOT, 'agentcurfew.lock'), 'utf8')) as { algorithm: string; components: { file: string; hash: string }[] };
    expect(lock.algorithm).toBe('sha256');
    expect(lock.components.map((c) => c.file)).toContain('CLAUDE.md');
    for (const c of lock.components) {
      const hash = createHash('sha256').update(readFileSync(join(ROOT, c.file))).digest('hex');
      expect(hash, `${c.file} changed: run "npx agentcurfew lock" and commit agentcurfew.lock`).toBe(c.hash);
    }
  });
});


// Phase 12 (D-076, from D-072): a release waits for green CI on the tagged commit, and the job
// that may ask for an OIDC token installs npm only from a file whose sha512 the workflow names.
describe('release workflow', () => {
  const release = readFileSync(join(DIR, 'release.yml'), 'utf8');
  const job = (name: string): string => {
    const start = release.indexOf(`\n  ${name}:\n`);
    expect(start, `job ${name}`).toBeGreaterThan(-1);
    const next = release.slice(start + 1).search(/\n {2}[\w-]+:\n/);
    return next === -1 ? release.slice(start) : release.slice(start, start + 1 + next);
  };

  it('build checks that CI passed on the tagged commit, reading the runs with actions: read only', () => {
    const build = job('build');
    expect(build).toMatch(/permissions:\n\s+contents: read\n(\s+#.*\n)*\s+actions: read\n/);
    expect(build).not.toMatch(/:\s*write/);
    expect(build).toMatch(/actions\/workflows\/ci\.yml\/runs\?head_sha=/);
    expect(build).toMatch(/conclusion/);
  });

  it('stage installs npm only from a tarball checked against a pinned sha512', () => {
    const stage = job('stage');
    expect(stage).not.toMatch(/npm install -g npm@/);
    expect(stage).toMatch(/NPM_INTEGRITY: sha512-[A-Za-z0-9+/]+=*/);
    expect(stage).toMatch(/npm install -g "\$RUNNER_TEMP\/npm\.tgz"/);
    // The pinned version is the one of packageManager.
    const pinned = /npm-(\d+\.\d+\.\d+)\.tgz/.exec(stage)?.[1];
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { packageManager: string };
    expect(root.packageManager).toBe(`npm@${String(pinned)}`);
  });
});
