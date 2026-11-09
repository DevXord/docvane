// Phase 2 acceptance: LibreOffice opens every rendered document. Phase 5 acceptance: in a rendered
// workbook, the formulas below repeated rows compute the right totals when LibreOffice opens it
// (each sheet is exported as CSV, which holds the computed values). Needs LibreOffice, so it runs
// only with `npm run test:libreoffice` (TV_LIBREOFFICE=1, and TV_SOFFICE for the path of soffice
// if it is not on the PATH). Each result is converted to text by LibreOffice in headless mode; the
// conversion must succeed, the text must hold the rendered values, and no tag may be left.
// With TV_LIBREOFFICE_OUT=<folder> the rendered files are also kept there, for checking in Word.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { render } from 'tplvane';
import { buildDocx, p, run, style, table, textBox } from '../helpers/docx';
import { png } from '../helpers/images';
import { buildXlsx } from '../helpers/xlsx';

const ENABLED = process.env['TV_LIBREOFFICE'] === '1';
const SOFFICE = process.env['TV_SOFFICE'] ?? 'soffice';
const KEEP = process.env['TV_LIBREOFFICE_OUT'];
const CORPUS = fileURLToPath(new URL('../corpus/libreoffice', import.meta.url));
const REAL = fileURLToPath(new URL('../corpus', import.meta.url));

interface Case {
  readonly name: string;
  readonly result: () => Uint8Array;
  /** Texts the converted document must contain. */
  readonly expect: readonly string[];
  /** The least number of images the PDF made by LibreOffice must hold. */
  readonly pdfImages?: number;
  /** For presentations: the extension, and the number of pages (slides) the PDF must have. */
  readonly extension?: 'docx' | 'pptx' | 'xlsx';
  /** For workbooks: lines that the CSV of each sheet must contain, by sheet name. */
  readonly csv?: Readonly<Record<string, readonly string[]>>;
  readonly pages?: number;
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
  {
    name: 'workbook-totals',
    extension: 'xlsx',
    result: () =>
      render(
        buildXlsx({
          Data: { A1: 'Item', B1: 'Price', A2: '{#items}{name}', B2: '{price}', C2: { formula: 'B2*2' }, D2: '{/items}', A3: 'Total', B3: { formula: 'SUM(B2:B2)' }, C3: { formula: 'SUM(C2:C2)' }, A5: '{#none}{name}', B5: '{/none}', A6: 'Empty', B6: { formula: 'SUM(B4:B5)' } },
          Report: { A1: { formula: 'Data!B3' }, A2: { formula: 'SUM(Data!B2:B2)' }, A3: { formula: 'COUNT(Data!B1:B2)' } },
        }),
        { items: [{ name: 'A', price: 10 }, { name: 'B', price: 20.5 }, { name: 'C', price: 30 }], none: [] },
      ),
    expect: [],
    csv: { Data: ['A,10,20', 'B,20.5,41', 'C,30,60', 'Total,60.5,121', 'Empty,0,'], Report: ['60.5', '60.5', '3'] },
  },
  ...readdirSync(CORPUS)
    .filter((f) => f.endsWith('.data.json'))
    .map((f): Case => {
      const name = f.replace(/\.data\.json$/, '');
      const extension = (['pptx', 'xlsx'] as const).find((e) => readdirSync(CORPUS).includes(`${name}.${e}`)) ?? 'docx';
      const data = JSON.parse(readFileSync(join(CORPUS, f), 'utf8')) as unknown;
      const extra: Partial<Case> =
        extension === 'pptx'
          ? { expect: ['Offer for Anna Nowak', 'Explain Chair.', 'Chair costs', 'Oak wood', 'our website'], pages: 6, pdfImages: 3 }
          : extension === 'xlsx'
            ? { csv: { Offer: ['Desk,1,"1,200.00","1,200.00",oak large ', 'Lamp,2,99.00,198.00,', 'Total,7,,"2,797.96",', 'Lines,3,,,'], Summary: ['Grand total,"2,797.96"', 'Sum of lines,2797.96', 'Prepared by,JAN KOWALSKI'] } }
            : {};
      return { name: `corpus-${name}`, extension, result: () => render(readFileSync(join(CORPUS, `${name}.${extension}`)), data), expect: [], ...extra };
    }),
  // Templates made in Office 2007 and Google (tests/corpus/office2007, google). The Google total is
  // SUM(D4), which does not grow (TV_W_FORMULA_NOT_EXTENDED), so it adds up the first item only.
  ...(
    [
      ['office2007/word-offer', 'docx', { expect: ['Oferta dla Anna Nowak', 'Krzesło', '349.99', 'Jako klient VIP masz darmową dostawę.'], pdfImages: 1 }],
      ['office2007/word-loop-chart', 'docx', { expect: ['Jedna pozycja'] }],
      ['office2007/ppt-products', 'pptx', { expect: ['Katalog', 'Dębowe', 'Obrotowe', 'Do omówienia: kolory', '30 dni'], pages: 4, pdfImages: 2 }],
      ['office2007/excel-report', 'xlsx', { csv: { Raport: ['Suma,,,3889.46'], Podsumowanie: [',3889.46'] } }],
      ['google/google-offer', 'docx', { expect: ['Oferta dla Anna Nowak', 'Krzesło', '349.99', 'Jako klient VIP masz darmową dostawę.'], pdfImages: 1 }],
      ['google/google-products', 'pptx', { expect: ['Katalog', 'Dębowe', 'Obrotowe', 'Do omówienia: kolory', '30 dni'], pages: 4, pdfImages: 2 }],
      ['google/google-report', 'xlsx', { csv: { Raport: ['Suma,,,2400'], Podsumowanie: [',2400'] } }],
    ] as const
  ).map(([path, extension, extra]): Case => {
    const data = JSON.parse(readFileSync(join(REAL, `${path}.data.json`), 'utf8')) as unknown;
    return { name: `real-${path.replace('/', '-')}`, extension, result: () => render(readFileSync(join(REAL, `${path}.${extension}`)), data), expect: [], ...extra };
  }),
];

describe.skipIf(!ENABLED)('LibreOffice opens rendered documents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tplvane-lo-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(CASES)('$name', ({ name, result, expect: texts, pdfImages, extension = 'docx', pages, csv }) => {
    const bytes = result();
    const file = join(dir, `${name}.${extension}`);
    writeFileSync(file, bytes);
    if (KEEP !== undefined) {
      mkdirSync(KEEP, { recursive: true });
      writeFileSync(join(KEEP, `${name}.${extension}`), bytes);
    }
    if (csv !== undefined) {
      // Every sheet as CSV with the values LibreOffice computed: comma, double quotes, UTF-8, formatted as shown, all sheets (-1).
      const out = spawnSync(SOFFICE, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1', '--outdir', dir, file], { encoding: 'utf8', timeout: 120_000 });
      expect(out.status, out.stderr).toBe(0);
      for (const [sheet, lines] of Object.entries(csv)) {
        const path = join(dir, `${name}-${sheet}.csv`);
        expect(existsSync(path), `LibreOffice wrote no CSV for ${name}, sheet ${sheet}`).toBe(true);
        const text = readFileSync(path, 'utf8').split(/\r?\n/);
        for (const line of lines) expect(text, `${name}, sheet ${sheet}: ${text.join(" | ")}`).toContain(line);
        expect(text.join('\n'), `${name} still has a tag`).not.toMatch(/\{[#^/%~]?[\p{L}_.]/u);
      }
      return;
    }
    // Text: a documents as plain text, a presentation as flat ODF (Impress has no text export).
    const textFormat = extension === 'pptx' ? 'fodp' : 'txt:Text (encoded):UTF8';
    const out = spawnSync(SOFFICE, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', textFormat, '--outdir', dir, file], { encoding: 'utf8', timeout: 120_000 });
    expect(out.status, out.stderr).toBe(0);
    const txt = join(dir, `${name}.${extension === 'pptx' ? 'fodp' : 'txt'}`);
    expect(existsSync(txt), `LibreOffice wrote no text for ${name}`).toBe(true);
    const raw = readFileSync(txt, 'utf8');
    // The document properties are left out: PowerPoint copies the title of the first slide into
    // them ("{title}"), and tplvane does not change them.
    const text = extension === 'pptx' ? raw.replace(/<office:meta>[\s\S]*?<\/office:meta>/, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : raw;
    for (const t of texts) expect(text, name).toContain(t);
    expect(text, `${name} still has a tag`).not.toMatch(/\{[#^/%~]?[\p{L}_.]/u);
    // A PDF shows that LibreOffice also lays the document out, pictures included.
    const pdf = spawnSync(SOFFICE, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, file], { encoding: 'utf8', timeout: 120_000 });
    expect(pdf.status, pdf.stderr).toBe(0);
    expect(existsSync(join(dir, `${name}.pdf`)), `LibreOffice wrote no PDF for ${name}`).toBe(true);
    const pdfText = new TextDecoder('latin1').decode(readFileSync(join(dir, `${name}.pdf`)));
    if (pages !== undefined) expect(pdfText.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0, `${name}: pages`).toBe(pages);
    if (pdfImages !== undefined) {
      const pdf = pdfText;
      expect(pdf.match(/\/Subtype\s*\/Image/g)?.length ?? 0, `${name}: images in the PDF`).toBeGreaterThanOrEqual(pdfImages);
    }
  });
});
