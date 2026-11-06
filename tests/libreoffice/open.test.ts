// Phase 2 acceptance: LibreOffice opens every rendered document. Needs LibreOffice, so it runs
// only with `npm run test:libreoffice` (DV_LIBREOFFICE=1, and DV_SOFFICE for the path of soffice
// if it is not on the PATH). Each result is converted to text by LibreOffice in headless mode; the
// conversion must succeed, the text must hold the rendered values, and no tag may be left.
// With DV_LIBREOFFICE_OUT=<folder> the rendered files are also kept there, for checking in Word.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { render } from 'docvane';
import { buildDocx, p, run, style, table, textBox } from '../helpers/docx';
import { png } from '../helpers/images';

const ENABLED = process.env['DV_LIBREOFFICE'] === '1';
const SOFFICE = process.env['DV_SOFFICE'] ?? 'soffice';
const KEEP = process.env['DV_LIBREOFFICE_OUT'];
const CORPUS = fileURLToPath(new URL('../corpus/libreoffice', import.meta.url));

interface Case {
  readonly name: string;
  readonly result: () => Uint8Array;
  /** Texts the converted document must contain. */
  readonly expect: readonly string[];
  /** The least number of images the PDF made by LibreOffice must hold. */
  readonly pdfImages?: number;
}

const items = [
  { name: 'Desk', price: 1200, qty: 1, tags: ['oak', 'large'] },
  { name: 'Chair', price: 349.99, qty: 4, tags: ['black'] },
];

const CASES: Case[] = [
  {
    name: 'values-and-formatting',
    result: () => render(buildDocx({ body: p(run('Dear ', '<w:i/>'), run('{cust', '<w:b/>'), 'omer.name},') + p('Lines:\t{multi}') + p('{total | currency("PLN")} due {due | date("long")}') }), { customer: { name: 'Anna & <Co>' }, multi: 'one\ntwo\tthree', total: 99.5, due: '2026-11-30' }, { locale: 'pl-PL' }),
    expect: ['Dear Anna & <Co>,', 'one', 'two'],
  },
  {
    name: 'paragraph-and-inline-loops',
    result: () => render(buildDocx({ body: p('{#items}') + p('<w:bookmarkStart w:id="7" w:name="item"/>', '{name}: {#tags}{.} {/tags}', '<w:bookmarkEnd w:id="7"/>') + p('{/items}') }), { items }),
    expect: ['Desk: oak large', 'Chair: black'],
  },
  {
    name: 'table-rows',
    result: () => render(buildDocx({ body: table([[p('Name'), p('Qty')], [p('{#items}{name}'), p('{qty}{/items}')], [p('{#items}{name} tags:')], [p('{#tags}{.}{/tags}{/items}')]]) }), { items }),
    expect: ['Desk', 'Chair', 'Desk tags:', 'oaklarge'],
  },
  {
    name: 'nested-loops-and-conditions',
    result: () =>
      render(
        buildDocx({ body: p('{#orders}') + p('Order {number}{#paid} (paid){/paid}{^paid} (open){/paid}') + table([[p('{#lines}{product}'), p('{qty}{/lines}')]]) + p('{/orders}') + p('{#orders.length > 1}Several orders.{/orders.length > 1}') }),
        { orders: [{ number: 1, paid: true, lines: [{ product: 'X', qty: 2 }] }, { number: 2, paid: false, lines: [{ product: 'Y', qty: 1 }, { product: 'Z', qty: 3 }] }] },
      ),
    expect: ['Order 1 (paid)', 'Order 2 (open)', 'Several orders.'],
  },
  {
    name: 'stories',
    result: () => render(buildDocx({ body: p('Body {a}') + p(textBox(p('Box {b}'))), headers: [p('Header {h}')], footers: [p('Footer {f}')], footnotes: [p('Note {n}')] }), { a: 'A1', b: 'B1', h: 'H1', f: 'F1', n: 'N1' }),
    expect: ['Body A1'],
  },
  {
    name: 'images-links-markdown',
    result: () =>
      render(
        buildDocx({
          body: p('Logo: {%logo} and {site | link("our site")}.') + p('{~summary}') + table([[p('{%wide}')]]),
          headers: [p('{%logo}')],
          styles: [style('paragraph', 'Heading1', 'Heading 1'), style('paragraph', 'ListBullet', 'List Bullet'), style('paragraph', 'ListNumber', 'List Number'), style('character', 'Hyperlink', 'Hyperlink')].join(''),
        }),
        { logo: png(40, 20), wide: { data: png(400, 50), alt: 'A wide picture' }, site: 'https://example.com', summary: '# Summary\n\nWe offer **free** delivery, see [the terms](https://example.com/terms).\n\n- Desk\n- Chair\n\n1. Order\n2. Pay' },
      ),
    expect: ['Logo:', 'our site', 'Summary', 'free', 'Desk', 'Pay'],
    pdfImages: 2,
  },
  ...readdirSync(CORPUS)
    .filter((f) => f.endsWith('.data.json'))
    .map((f) => {
      const name = f.replace(/\.data\.json$/, '');
      return { name: `corpus-${name}`, result: () => render(readFileSync(join(CORPUS, `${name}.docx`)), JSON.parse(readFileSync(join(CORPUS, f), 'utf8')) as unknown), expect: [] };
    }),
];

describe.skipIf(!ENABLED)('LibreOffice opens rendered documents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docvane-lo-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(CASES)('$name', ({ name, result, expect: texts, pdfImages }) => {
    const bytes = result();
    const file = join(dir, `${name}.docx`);
    writeFileSync(file, bytes);
    if (KEEP !== undefined) {
      mkdirSync(KEEP, { recursive: true });
      writeFileSync(join(KEEP, `${name}.docx`), bytes);
    }
    const out = spawnSync(SOFFICE, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', dir, file], { encoding: 'utf8', timeout: 120_000 });
    expect(out.status, out.stderr).toBe(0);
    const txt = join(dir, `${name}.txt`);
    expect(existsSync(txt), `LibreOffice wrote no text for ${name}`).toBe(true);
    const text = readFileSync(txt, 'utf8');
    for (const t of texts) expect(text, name).toContain(t);
    expect(text, `${name} still has a tag`).not.toMatch(/\{[#^/%~]?[\p{L}_.]/u);
    // A PDF shows that LibreOffice also lays the document out, pictures included.
    const pdf = spawnSync(SOFFICE, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, file], { encoding: 'utf8', timeout: 120_000 });
    expect(pdf.status, pdf.stderr).toBe(0);
    expect(existsSync(join(dir, `${name}.pdf`)), `LibreOffice wrote no PDF for ${name}`).toBe(true);
    if (pdfImages !== undefined) {
      const pdf = new TextDecoder('latin1').decode(readFileSync(join(dir, `${name}.pdf`)));
      expect(pdf.match(/\/Subtype\s*\/Image/g)?.length ?? 0, `${name}: images in the PDF`).toBeGreaterThanOrEqual(pdfImages);
    }
  });
});
