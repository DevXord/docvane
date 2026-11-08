// CLAUDE.md and phase 6: every public symbol has TSDoc with a working example, and the examples
// compile. The examples (```ts blocks in TSDoc comments that import from the packages) are written
// out as modules and type-checked with tsc against the sources, with the strict settings of the
// project; and every name that a package exports has an @example at its declaration.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGES = { tplvane: join(ROOT, 'packages', 'tplvane', 'src'), '@tplvane/mcp': join(ROOT, 'packages', 'mcp', 'src') } as const;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith('.ts') ? [path] : [];
  });
}

interface Example {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

/** The ```ts blocks of the TSDoc comments of a file. */
function examplesOf(file: string): Example[] {
  const text = readFileSync(file, 'utf8');
  const out: Example[] = [];
  for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const lines = comment[0].split('\n').map((l) => l.replace(/^\s*\* ?/, ''));
    let block: string[] | null = null;
    let start = 0;
    lines.forEach((l, i) => {
      if (block === null && l.trim() === '```ts') {
        block = [];
        start = i;
      } else if (block !== null && l.trim() === '```') {
        out.push({ file, line: text.slice(0, comment.index).split('\n').length + start + 1, code: block.join('\n') });
        block = null;
      } else if (block !== null) block.push(l);
    });
  }
  return out;
}

const publicExample = (e: Example): boolean => /from '(tplvane|@tplvane\/mcp)'/.test(e.code);

describe('TSDoc examples', () => {
  it('every exported name has an @example at its declaration', () => {
    const missing: string[] = [];
    for (const dir of Object.values(PACKAGES)) {
      const index = readFileSync(join(dir, 'index.ts'), 'utf8');
      const names = new Set<string>();
      for (const m of index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) for (const part of (m[1] as string).split(',')) names.add(part.replace(/\btype\b/, '').trim().split(/\s+as\s+/).pop() ?? '');
      for (const m of index.matchAll(/export\s+(?:const|function|class|interface|type)\s+(\w+)/g)) names.add(m[1] as string);
      names.delete('');
      const texts = sources(dir).map((f) => readFileSync(f, 'utf8'));
      for (const name of names) {
        const declaration = new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|function|class|interface|type)\\s+${name}\\b`);
        const text = texts.find((t) => declaration.test(t));
        if (text === undefined) {
          missing.push(`${name}: declaration not found`);
          continue;
        }
        const at = text.search(declaration);
        const comment = text.slice(text.lastIndexOf('/**', at), at);
        if (!comment.includes('@example') || comment.includes('*/\n\n')) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every example compiles against the sources', { timeout: 300_000 }, () => {
    const examples = Object.values(PACKAGES).flatMap((dir) => sources(dir).flatMap(examplesOf)).filter(publicExample);
    expect(examples.length).toBeGreaterThan(30);
    const dir = join(ROOT, 'node_modules', '.cache', 'tplvane-examples');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const where = new Map<string, string>();
    examples.forEach((e, i) => {
      const name = `example${String(i)}.ts`;
      where.set(name, `${e.file.slice(ROOT.length)}:${String(e.line)}`);
      writeFileSync(join(dir, name), `${e.code}\nexport {};\n`);
    });
    const config = {
      extends: '../../../tsconfig.base.json',
      compilerOptions: {
        allowImportingTsExtensions: true,
        paths: { tplvane: ['../../../packages/tplvane/src/index.ts'], '@tplvane/mcp': ['../../../packages/mcp/src/index.ts'] },
      },
      include: ['*.ts', '../../../types'],
    };
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config, null, 2));
    const result = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(dir, 'tsconfig.json')], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
    // Name the TSDoc comment of each failing example.
    const report = `${result.stdout}${result.stderr}`.replace(/(?:node_modules\/\.cache\/tplvane-examples\/)?(example\d+\.ts)/g, (_, name: string) => `${name} (${where.get(name) ?? '?'})`);
    expect(report).toBe('');
    expect(result.status).toBe(0);
  });
});
