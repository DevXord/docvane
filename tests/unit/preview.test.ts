// preview: the text of a document, a presentation or a workbook, to check a result without an
// office application (the CLI command preview and, later, the MCP tool preview_text).
import { describe, expect, it } from 'vitest';
import { preview, render } from 'tplvane';
import { buildDocx, p, table } from '../helpers/docx';
import { ap, buildPptx, sp } from '../helpers/pptx';
import { buildXlsx } from '../helpers/xlsx';
import { png } from '../helpers/images';
import { expectDvError } from '../helpers/expect-error';

describe('preview', () => {
  it('gives the paragraphs of every part of a document, in reading order', () => {
    const bytes = buildDocx({ body: p('Dear Anna,') + table([[p('Desk'), p('1')]]) + p('Bye'), headers: [p('Header')], footnotes: [p('Note')] });
    const result = preview(bytes);
    expect(result.format).toBe('docx');
    expect(result.parts.map((part) => [part.name, part.lines])).toEqual([
      ['body', ['Dear Anna,', 'Desk', '1', 'Bye']],
      ['header /word/header1.xml', ['Header']],
      ['footnotes', ['Note']],
    ]);
    expect(result.text).toBe('== body\nDear Anna,\nDesk\n1\nBye\n== header /word/header1.xml\nHeader\n== footnotes\nNote\n');
  });

  it('shows pictures and other objects as [object]', () => {
    const bytes = render(buildDocx({ body: p('Logo: {%logo}') }), { logo: png(4, 4) });
    expect(preview(bytes).parts[0]?.lines).toEqual(['Logo: [object]']);
  });

  it('gives the slides of a presentation with their notes', () => {
    const bytes = buildPptx([{ shapes: sp('T', ap('Title') + ap('Second')), notes: sp('N', ap('Say hi')) }, { shapes: sp('A', ap('Two')) }]);
    expect(preview(bytes).parts.map((part) => [part.name, part.lines])).toEqual([
      ['slide 1', ['Title', 'Second']],
      ['slide 1 notes', ['Say hi']],
      ['slide 2', ['Two']],
    ]);
  });

  it('gives the rows of each sheet, cells separated by tabs, formulas without a result as =formula', () => {
    const bytes = buildXlsx({ Data: { A1: 'Name', B1: 'Price', A2: 'Desk', B2: 1200, C2: true, A4: { formula: 'SUM(B2:B3)' }, B4: new Date(Date.UTC(2026, 10, 6)) }, Empty: {} });
    expect(preview(bytes).parts.map((part) => [part.name, part.lines])).toEqual([
      ['sheet Data', ['Name\tPrice', 'Desk\t1200\tTRUE', '', '=SUM(B2:B3)\t2026-11-06']],
      ['sheet Empty', []],
    ]);
  });

  it('rejects input that is not a document', () => {
    expectDvError(() => preview('x' as never), 'TV_E_INVALID_INPUT');
    expectDvError(() => preview(new Uint8Array([1, 2])), 'TV_E_NOT_ZIP');
  });
});
