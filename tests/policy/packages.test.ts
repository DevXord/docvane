// CLAUDE.md, "Hard rules": what each package may depend on, ESM only, and no Pro code here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Folders under packages/ and the package each one holds. */
const PACKAGES = { docvane: 'docvane', mcp: '@docvane/mcp' } as const;
type Folder = keyof typeof PACKAGES;
const FOLDERS = Object.keys(PACKAGES) as Folder[];

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly type?: string;
  readonly license?: string;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, unknown>>;
}

const manifest = (folder: Folder): Manifest => JSON.parse(readFileSync(join(ROOT, 'packages', folder, 'package.json'), 'utf8')) as Manifest;

/** Everything a consumer's install would pull in, whatever the field. */
const runtimeDependencies = (m: Manifest): string[] => Object.keys({ ...m.dependencies, ...m.optionalDependencies, ...m.peerDependencies }).sort();

describe('packages', () => {
  it('are exactly the two public ones: Pro code does not live in this repository', () => {
    const folders = readdirSync(join(ROOT, 'packages')).filter((name) => statSync(join(ROOT, 'packages', name)).isDirectory());
    expect(folders.sort()).toEqual(FOLDERS);
    for (const folder of FOLDERS) expect(manifest(folder).name).toBe(PACKAGES[folder]);
  });

  it('share one version: package.json, VERSION in the sources, the changelog, and the dependency of @docvane/mcp', () => {
    const version = manifest('docvane').version;
    expect(manifest('mcp').version).toBe(version);
    expect(manifest('mcp').dependencies?.['docvane']).toBe(`^${version}`);
    for (const folder of FOLDERS) {
      const source = readFileSync(join(ROOT, 'packages', folder, 'src', 'version.ts'), 'utf8');
      expect(/VERSION: string = '([^']+)'/.exec(source)?.[1], `${folder}/src/version.ts`).toBe(version);
      // A released version has its own section in the changelog, above everything else.
      const changelog = readFileSync(join(ROOT, 'packages', folder, 'CHANGELOG.md'), 'utf8');
      expect(/^## (\S+)/m.exec(changelog)?.[1], `${folder}/CHANGELOG.md`).toBe(version === '0.0.0' ? 'Unreleased' : version);
    }
  });

  it('docvane depends at run time only on xlvane and fflate (the ZIP code copied from xlvane needs it)', () => {
    expect(runtimeDependencies(manifest('docvane'))).toEqual(['fflate', 'xlvane']);
  });

  it('@docvane/mcp depends at run time only on docvane and the official MCP SDK', () => {
    // The official SDK is the server package; any other @modelcontextprotocol package needs approval first.
    expect(runtimeDependencies(manifest('mcp'))).toEqual(['@modelcontextprotocol/server', 'docvane']);
  });

  it.each(FOLDERS)('%s is ESM only under the MIT license, with a license file', (folder) => {
    const m = manifest(folder);
    expect(m.type).toBe('module');
    expect(m.license).toBe('MIT');
    expect(JSON.stringify(m.exports)).not.toContain('require');
    expect(readFileSync(join(ROOT, 'packages', folder, 'LICENSE'), 'utf8')).toContain('MIT License');
  });
});
