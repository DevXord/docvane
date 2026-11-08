// workbookPr/@dateCompatibility in workbooks saved by LibreOffice (D-075): the attribute is in no
// schema of ECMA-376 (neither Part 1 Strict nor Part 4 Transitional, 5th editions), and Excel 2007
// refuses a file that has it ("content that cannot be read"). The rendered workbook leaves it out
// and keeps everything else of workbookPr, so the date system (date1904) stays as it was.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'tplvane';
import { buildXlsx, readXlsx } from '../helpers/xlsx';
import { openZip } from '../../packages/tplvane/src/zip/reader';
import { writeZip } from '../../packages/tplvane/src/zip/writer';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';

const zipText = (bytes: Uint8Array, name: string): string => new TextDecoder().decode(openZip(bytes, DEFAULT_LIMITS).read(name));
const workbookPr = (bytes: Uint8Array): string => /<workbookPr\b[^>]*>/.exec(zipText(bytes, 'xl/workbook.xml'))?.[0] ?? '';

/** A copy of a package with one part's text changed. */
function edit(bytes: Uint8Array, name: string, change: (text: string) => string): Uint8Array {
  const zip = openZip(bytes, DEFAULT_LIMITS);
  return writeZip(zip.entries.map((e) => ({ name: e.name, data: e.name === name ? new TextEncoder().encode(change(new TextDecoder().decode(zip.read(e)))) : zip.read(e) })));
}

describe('workbookPr/@dateCompatibility', () => {
  it('is left out of a workbook saved by LibreOffice, and the rest of workbookPr is kept', () => {
    const template = readFileSync('tests/corpus/libreoffice/xlsx-basics.xlsx');
    expect(workbookPr(template)).toContain('dateCompatibility="false"');
    const data: unknown = JSON.parse(readFileSync('tests/corpus/libreoffice/xlsx-basics.data.json', 'utf8'));
    const out = render(template, data);
    expect(workbookPr(out)).toBe('<workbookPr backupFile="false" showObjects="all"/>');
  });

  it('is left out in either quotes, with date1904 kept', () => {
    const plain = buildXlsx({ S: { A1: '{name}' } });
    const template = edit(plain, 'xl/workbook.xml', (xml) => xml.replace('<bookViews>', `<workbookPr date1904="1" dateCompatibility='true'/><bookViews>`));
    expect(workbookPr(template)).toContain(`dateCompatibility='true'`);
    const out = render(template, { name: 'Anna' });
    expect(workbookPr(out)).not.toContain('dateCompatibility');
    expect(workbookPr(out)).toContain('date1904="1"');
    expect(readXlsx(out)['S']?.['A1']).toBe('Anna');
  });

  it('leaves a workbook without it as it is', () => {
    const template = buildXlsx({ S: { A1: '{name}' } });
    const before = workbookPr(template);
    expect(before).not.toContain('dateCompatibility');
    expect(workbookPr(render(template, { name: 'Anna' }))).toBe(before);
  });
});
