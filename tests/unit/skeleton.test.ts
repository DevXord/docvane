// The public entry points exist, report the version of their manifest, and the one runtime
// dependency of tplvane loads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from 'tplvane';
import { VERSION as MCP_VERSION } from '@tplvane/mcp';
import { DEFAULT_READ_LIMITS } from 'xlvane';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const versionOf = (folder: string): string => (JSON.parse(readFileSync(join(ROOT, 'packages', folder, 'package.json'), 'utf8')) as { version: string }).version;

describe('entry points', () => {
  it('tplvane reports the version of its package.json', () => {
    expect(VERSION).toBe(versionOf('tplvane'));
  });

  it('@tplvane/mcp reports the version of its package.json', () => {
    expect(MCP_VERSION).toBe(versionOf('mcp'));
  });

  it('the xlvane dependency is installed and loads', () => {
    expect(DEFAULT_READ_LIMITS.maxEntries).toBeGreaterThan(0);
  });
});
