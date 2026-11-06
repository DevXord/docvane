// The public entry points exist, report the version of their manifest, and the one runtime
// dependency of docvane loads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from 'docvane';
import { VERSION as MCP_VERSION } from '@docvane/mcp';
import { DEFAULT_READ_LIMITS } from 'xlvane';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const versionOf = (folder: string): string => (JSON.parse(readFileSync(join(ROOT, 'packages', folder, 'package.json'), 'utf8')) as { version: string }).version;

describe('entry points', () => {
  it('docvane reports the version of its package.json', () => {
    expect(VERSION).toBe(versionOf('docvane'));
  });

  it('@docvane/mcp reports the version of its package.json', () => {
    expect(MCP_VERSION).toBe(versionOf('mcp'));
  });

  it('the xlvane dependency is installed and loads', () => {
    expect(DEFAULT_READ_LIMITS.maxEntries).toBeGreaterThan(0);
  });
});
