// Snapshots of every help screen and of every kind of error of the CLI (tests/cli/snapshots).
// After a deliberate change, update them with `npx vitest run tests/cli/screens.test.ts -u`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { exampleFolder, runCli } from '../helpers/cli';

const SNAPSHOTS = fileURLToPath(new URL('snapshots', import.meta.url));

interface Screen {
  readonly name: string;
  readonly argv: readonly string[];
  readonly setup?: (dir: string) => void;
  readonly stdin?: string;
}

/** The offer filled with its data, as a finished document to make a template from. */
const filled = (dir: string): void => {
  writeFileSync(join(dir, 'offer-filled.docx'), render(readFileSync(join(dir, 'offer.docx')), { ...(JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as object), logo: readFileSync(join(dir, 'logo.png')) }));
};

const bad = (dir: string): void => {
  writeFileSync(join(dir, 'data-bad.json'), JSON.stringify({ number: 1, customer: { nme: 'Anna' }, items: [{ name: 'Desk', qty: 1 }], logo: 'logo.png' }));
};

const SCREENS: Screen[] = [
  { name: 'welcome', argv: [] },
  { name: 'version', argv: ['--version'] },
  { name: 'help-inspect', argv: ['help', 'inspect'] },
  { name: 'help-render', argv: ['render', '--help'] },
  { name: 'help-validate', argv: ['help', 'validate'] },
  { name: 'help-preview', argv: ['help', 'preview'] },
  { name: 'help-make-template', argv: ['help', 'make-template'] },
  { name: 'inspect', argv: ['inspect', 'offer.docx'] },
  { name: 'inspect-schema', argv: ['inspect', 'offer.docx', '--schema'] },
  { name: 'render', argv: ['render', 'offer.docx', 'data.json'] },
  { name: 'render-dry-run', argv: ['render', 'offer.docx', 'data.json', '--dry-run'] },
  { name: 'render-stdin', argv: ['render', 'offer.docx', '-', '-o', 'from-stdin.docx'], stdin: '{"number":1,"customer":{"name":"A","company":"B"},"date":"2026-11-06","items":[],"sum":0,"notes":"x","author":"C","logo":"logo.png"}' },
  { name: 'validate', argv: ['validate', 'offer.docx', 'data.json'] },
  { name: 'validate-problems', argv: ['validate', 'offer.docx', 'data-bad.json'], setup: bad },
  { name: 'preview', argv: ['preview', 'offer.docx'] },
  { name: 'make-template', argv: ['make-template', 'offer-filled.docx', 'map.json'], setup: filled },
  { name: 'make-template-dry-run', argv: ['make-template', 'offer-filled.docx', 'map.json', '--dry-run'], setup: filled },
  { name: 'error-make-template-not-found', argv: ['make-template', 'offer-filled.docx', 'map-bad.json'], setup: (dir) => { filled(dir); writeFileSync(join(dir, 'map-bad.json'), JSON.stringify([{ find: 'Ewa Zielińska', tag: 'customer.name' }, { find: 'Nowak Design', tag: 'customer.company' }])); } },
  { name: 'error-make-template-invalid', argv: ['make-template', 'offer-filled.docx', 'map-open.json'], setup: (dir) => { filled(dir); writeFileSync(join(dir, 'map-open.json'), JSON.stringify([{ find: 'Oak desk', with: '{#items}{name}' }])); } },
  { name: 'error-unknown-command', argv: ['rendr', 'offer.docx', 'data.json'] },
  { name: 'error-unknown-help', argv: ['help', 'inspekt'] },
  { name: 'error-unknown-option', argv: ['render', 'offer.docx', 'data.json', '--outptu', 'x.docx'] },
  { name: 'error-option-value', argv: ['render', 'offer.docx', 'data.json', '--output'] },
  { name: 'error-choice', argv: ['render', 'offer.docx', 'data.json', '--missing', 'skip'] },
  { name: 'error-missing-argument', argv: ['render', 'offer.docx'] },
  { name: 'error-extra-argument', argv: ['preview', 'a.docx', 'b.docx'] },
  { name: 'error-file-not-found', argv: ['inspect', 'ofer.docx'] },
  { name: 'error-not-a-document', argv: ['inspect', 'data.json'] },
  { name: 'error-template', argv: ['inspect', 'broken.docx'], setup: (dir) => writeFileSync(join(dir, 'broken.docx'), buildDocx({ body: p('Dear {customer.name') + p('{#items}') })) },
  { name: 'error-json', argv: ['render', 'offer.docx', 'broken.json'], setup: (dir) => writeFileSync(join(dir, 'broken.json'), '{"number": 1,}') },
  { name: 'error-exists', argv: ['render', 'offer.docx', 'data.json', '-o', 'offer.docx'] },
  { name: 'error-data', argv: ['render', 'offer.docx', 'data-bad.json'], setup: bad },
  { name: 'error-image-outside', argv: ['render', 'offer.docx', 'sub/data.json'], setup: (dir) => writeImageData(dir, '../logo.png') },
  { name: 'error-image-absolute', argv: ['render', 'offer.docx', 'sub/data.json'], setup: (dir) => writeImageData(dir, '/etc/hostname') },
  { name: 'error-image-address', argv: ['render', 'offer.docx', 'sub/data.json'], setup: (dir) => writeImageData(dir, 'https://example.com/logo.png') },
  { name: 'error-image-not-image', argv: ['render', 'offer.docx', 'sub/data.json'], setup: (dir) => writeImageData(dir, 'notes.txt') },
];

/** A data file in a subfolder, with `logo` as the image. */
function writeImageData(dir: string, logo: string): void {
  mkdirSync(join(dir, 'sub'), { recursive: true });
  const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, 'sub', 'data.json'), JSON.stringify({ ...data, logo }));
  writeFileSync(join(dir, 'sub', 'notes.txt'), 'not an image');
}

describe('CLI screens', () => {
  it.each(SCREENS)('$name', async ({ name, argv, setup, stdin }) => {
    const dir = exampleFolder();
    setup?.(dir);
    const run = await runCli(dir, argv, stdin === undefined ? {} : { stdin });
    const clean = (s: string): string => s.split(dir).join('<folder>');
    const text = `$ tplvane ${argv.join(' ')}\n--- exit ${String(run.code)}\n--- stdout\n${clean(run.stdout)}--- stderr\n${clean(run.stderr)}`;
    await expect(text).toMatchFileSnapshot(join(SNAPSHOTS, `${name}.txt`));
  });
});
