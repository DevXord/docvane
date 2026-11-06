// Phase 7 acceptance: --json follows docs/cli-json.md in the package. The output of every command,
// and of every kind of error, is one JSON document that fits the schema of its command.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPptx, ap, sp } from '../helpers/pptx';
import { buildXlsx } from '../helpers/xlsx';
import { buildDocx, p } from '../helpers/docx';
import { SchemaSet } from '../helpers/json-schema';
import { exampleFolder, runCli } from '../helpers/cli';

const schemas = new SchemaSet(fileURLToPath(new URL('../../packages/docvane/docs/cli-json', import.meta.url)));

const CASES: readonly (readonly [string, readonly string[], number])[] = [
  ['inspect', ['inspect', 'offer.docx', '--json'], 0],
  ['inspect', ['inspect', 'slides.pptx', '--json'], 0],
  ['inspect', ['inspect', 'sheet.xlsx', '--json'], 0],
  ['inspect', ['inspect', 'broken.docx', '--json'], 3],
  ['inspect', ['inspect', 'missing.docx', '--json'], 3],
  ['render', ['render', 'offer.docx', 'data.json', '--json'], 0],
  ['render', ['render', 'offer.docx', 'data.json', '--json'], 3],
  ['render', ['render', 'offer.docx', 'data.json', '--json', '--dry-run'], 0],
  ['render', ['render', 'offer.docx', 'bad.json', '--json', '-o', 'x.docx'], 3],
  ['render', ['render', 'offer.docx', '--json'], 2],
  ['validate', ['validate', 'offer.docx', 'data.json', '--json'], 0],
  ['validate', ['validate', 'offer.docx', 'bad.json', '--json'], 1],
  ['preview', ['preview', 'offer.docx', '--json'], 0],
  ['preview', ['preview', 'sheet.xlsx', '--json'], 0],
  ['preview', ['preview', 'data.json', '--json'], 3],
  ['common', ['rendr', '--json'], 2],
];

describe('CLI --json', () => {
  it.each(CASES)('%s: docvane %s', async (schema, argv, code) => {
    const dir = exampleFolder();
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ customer: {}, items: [{}] }));
    writeFileSync(join(dir, 'broken.docx'), buildDocx({ body: p('{a') }));
    writeFileSync(join(dir, 'slides.pptx'), buildPptx([{ shapes: sp('T', ap('{title}')) }]));
    writeFileSync(join(dir, 'sheet.xlsx'), buildXlsx({ Data: { A1: '{#items}{name}', B1: '{/items}' } }));
    if (code === 3 && argv[0] === 'render' && argv.includes('data.json')) await runCli(dir, ['render', 'offer.docx', 'data.json']);
    const run = await runCli(dir, argv);
    expect(run.code, run.stdout).toBe(code);
    expect(run.stderr).toBe('');
    expect(run.stdout.endsWith('\n')).toBe(true);
    expect(run.stdout.trim().split('\n')).toHaveLength(1);
    const doc = JSON.parse(run.stdout) as { ok: boolean; command: string | null; try: unknown };
    const file = schema === 'common' ? null : `${schema}.schema.json`;
    if (file === null) {
      expect(schemas.checkRef('common.schema.json#/$defs/errorEnvelope', doc)).toEqual([]);
      expect(doc.command).toBeNull();
    } else {
      expect(schemas.check(file, doc)).toEqual([]);
    }
    expect(doc.ok).toBe(code === 0 || code === 1);
  });

  it('indents on a terminal and prints the same data', async () => {
    const dir = exampleFolder();
    const tty = await runCli(dir, ['preview', 'offer.docx', '--json'], { tty: true });
    const pipe = await runCli(dir, ['preview', 'offer.docx', '--json']);
    expect(tty.stdout).toContain('\n  "docvane": 1');
    expect(JSON.parse(tty.stdout)).toEqual(JSON.parse(pipe.stdout));
  });

  it('colours text only on a terminal without NO_COLOR', async () => {
    const dir = exampleFolder();
    expect((await runCli(dir, ['inspect', 'none.docx'], { tty: true })).stderr).toContain('\u001b[');
    expect((await runCli(dir, ['inspect', 'none.docx'], { tty: true, env: { NO_COLOR: '1' } })).stderr).not.toContain('\u001b[');
    expect((await runCli(dir, ['inspect', 'none.docx'])).stderr).not.toContain('\u001b[');
  });

  it('writes control characters of files and arguments visibly in text, and unchanged in JSON', async () => {
    const dir = exampleFolder();
    const name = 'a\u001b[31mred.docx';
    const text = await runCli(dir, ['inspect', name]);
    expect(text.stderr).toContain('a\\x1b[31mred.docx');
    expect(text.stderr).not.toContain('\u001b');
    const json = await runCli(dir, ['inspect', name, '--json']);
    expect(JSON.parse(json.stdout).error.details.path).toBe(name);
  });
});
