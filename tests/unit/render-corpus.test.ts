// render on templates saved by LibreOffice, Word, PowerPoint and Excel 2007 and Google (tests/corpus): each <file>.docx, .pptx or .xlsx with <file>.data.json
// next to it is rendered, and the text of the result is compared with <file>.render.txt.
// After a deliberate change, update with `npx vitest run tests/unit/render-corpus.test.ts -u`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspect, render, validate } from 'tplvane';
import { expectDvError } from '../helpers/expect-error';
import { storyTexts } from '../helpers/read-docx';
import { slideTexts } from '../helpers/read-pptx';
import { readXlsx } from '../helpers/xlsx';

const CORPUS = fileURLToPath(new URL('../corpus', import.meta.url));
const FOLDERS = ['libreoffice', 'office2007', 'google'];

describe.each(FOLDERS)('render corpus %s', (folder) => {
  const dir = join(CORPUS, folder);
  const files = readdirSync(dir).filter((f) => /\.(docx|pptx|xlsx)$/.test(f) && readdirSync(dir).includes(f.replace(/\.(docx|pptx|xlsx)$/, '.data.json')));

  it('has templates with data', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', async (file) => {
    const data = JSON.parse(readFileSync(join(dir, file.replace(/\.(docx|pptx|xlsx)$/, '.data.json')), 'utf8')) as unknown;
    const result = render(readFileSync(join(dir, file)), data, { locale: 'en-US' });
    // The result has no tags left and can be read again.
    expect(inspect(result).tags).toEqual([]);
    const text = file.endsWith('.xlsx')
      ? Object.entries(readXlsx(result))
          .map(([sheet, cells]) => `== ${sheet}\n${Object.entries(cells).map(([ref, v]) => `${ref}: ${JSON.stringify(v)}`).join('\n')}`)
          .join('\n')
      : file.endsWith('.pptx')
      ? slideTexts(result)
          .map((s, i) => `== slide ${String(i + 1)}\n${s.slide.join('\n')}${s.notes.length > 0 ? `\n-- notes\n${s.notes.join('\n')}` : ''}`)
          .join('\n')
      : Object.entries(storyTexts(result))
          .map(([part, paragraphs]) => `== ${part}\n${paragraphs.join('\n')}`)
          .join('\n');
    await expect(`${text}\n`).toMatchFileSnapshot(join(dir, `${file}.render.txt`));
  });
});

describe('files saved by Office 2007 and Google', () => {
  const read = (path: string): Uint8Array => readFileSync(join(CORPUS, path));

  it('a chart that a loop repeats is filled for one item and refused for two (D-078)', () => {
    const template = read('office2007/word-loop-chart.docx');
    const two = { items: [{ name: 'A' }, { name: 'B' }] };
    expect(inspect(render(template, { items: [{ name: 'A' }] })).tags).toEqual([]);
    expectDvError(() => render(template, two), 'TV_E_NOT_SUPPORTED');
    expect(validate(template, two).errors.map((e) => e.code)).toEqual(['TV_E_NOT_SUPPORTED']);
  });

  it('Google Sheets saves SUM(D4:D4) as SUM(D4), which is reported; the Excel 2007 workbook is not (D-080)', () => {
    const google = inspect(read('google/google-report.xlsx')).warnings;
    expect(google.map((w) => [w.code, w.location.sheet, w.location.cell, w.details?.['formula']])).toEqual([['TV_W_FORMULA_NOT_EXTENDED', 'Raport', 'D6', 'SUM(D4)']]);
    expect(inspect(read('office2007/excel-report.xlsx')).warnings).toEqual([]);
  });
});
