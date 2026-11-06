// inspect on Excel workbooks: tags in cells, sections over rows and within a cell, places and the schema.
import { describe, expect, it } from 'vitest';
import { DvError, inspect } from 'docvane';
import { buildXlsx } from '../helpers/xlsx';
import { expectDvError } from '../helpers/expect-error';

const invalid = (bytes: Uint8Array): DvError => expectDvError(() => inspect(bytes), 'DV_E_TEMPLATE_INVALID');

describe('inspect: Excel workbooks', () => {
  it('finds tags in the text cells of every sheet, row by row, with the sheet and the cell', () => {
    const bytes = buildXlsx({
      Offer: { B2: 'Offer for {customer.name}', A1: '{title}', C3: 12, D3: { formula: 'C3*2' }, A4: '{total | currency("PLN")}' },
      Notes: { A1: 'Prepared by {author}' },
    });
    const result = inspect(bytes);
    expect(result.format).toBe('xlsx');
    expect(result.tags.map((t) => [t.raw, t.location.description])).toEqual([
      ['{title}', 'sheet Offer, cell A1'],
      ['{customer.name}', 'sheet Offer, cell B2'],
      ['{total | currency("PLN")}', 'sheet Offer, cell A4'],
      ['{author}', 'sheet Notes, cell A1'],
    ]);
    expect(result.tags[1]?.location).toMatchObject({ part: '/xl/worksheets/sheet1.xml', story: 'sheet', sheet: 'Offer', cell: 'B2', character: 11 });
    expect(Object.keys(result.schema.properties ?? {})).toEqual(['title', 'customer', 'total', 'author']);
  });

  it('ignores braces in formulas, which are array constants', () => {
    const result = inspect(buildXlsx({ Data: { A1: { formula: 'SUM({1,2,3})' }, A2: '{a}' } }));
    expect(result.tags.map((t) => t.raw)).toEqual(['{a}']);
  });

  it('reads sections over rows and within one cell', () => {
    const bytes = buildXlsx({
      Data: {
        A1: 'Items',
        A2: '{#items}{name}',
        B2: '{#tags}{.} {/tags}',
        C2: '{price}{/items}',
        A4: '{#vip}VIP customer{/vip}',
      },
    });
    const { sections, schema } = inspect(bytes);
    expect(sections.map((s) => [s.kind, s.path, s.open.location.cell, s.close.location.cell])).toEqual([
      ['loop', 'items', 'A2', 'C2'],
      ['condition', 'vip', 'A4', 'A4'],
    ]);
    expect(sections[0]?.sections.map((s) => [s.kind, s.path])).toEqual([['loop', 'tags']]);
    expect(schema.properties?.['items']).toMatchObject({ type: 'array' });
  });

  it('accepts sections whose tags fill rows of their own', () => {
    const { sections } = inspect(buildXlsx({ Data: { A2: '{#items}', A3: '{name}', B3: '{price}', A4: '{/items}' } }));
    expect(sections.map((s) => [s.kind, s.path])).toEqual([['loop', 'items']]);
  });

  it('reports a row section inside another row section', () => {
    const error = invalid(buildXlsx({ Data: { A1: '{#groups}{name}', A2: '{#items}{label}', B2: '{/items}', B3: '{/groups}' } }));
    expect(error.errors.map((e) => [e.code, e.location.cell])).toEqual([['DV_E_SECTION_PLACEMENT', 'A2']]);
    expect(error.errors[0]?.hint).toMatch(/one level/);
  });

  it('reports a tag outside a row section in the rows it repeats, and sections that share a row', () => {
    const outside = invalid(buildXlsx({ Data: { A2: '{label}', B2: '{#items}{name}', C2: '{/items}' } }));
    expect(outside.errors.map((e) => [e.code, e.location.cell])).toEqual([['DV_E_SECTION_PLACEMENT', 'A2']]);
    const shared = invalid(buildXlsx({ Data: { A2: '{#a}{x}', B3: '{/a}', C3: '{#b}{y}', D4: '{/b}' } }));
    expect(shared.errors.map((e) => [e.code, e.location.cell])).toEqual([['DV_E_SECTION_PLACEMENT', 'C3']]);
  });

  it('does not let a section cross sheets', () => {
    const error = invalid(buildXlsx({ One: { A1: '{#items}' }, Two: { A1: '{/items}' } }));
    expect(error.errors.map((e) => [e.code, e.location.sheet])).toEqual([
      ['DV_E_SECTION_UNCLOSED', 'One'],
      ['DV_E_SECTION_UNOPENED', 'Two'],
    ]);
  });

  it('reports images, Markdown and links, which Excel templates do not support yet', () => {
    const error = invalid(buildXlsx({ Data: { A1: '{%logo}', A2: '{~notes}', A3: '{site | link}', A4: '{(site | link) || "-"}' } }));
    expect(error.errors.map((e) => [e.code, e.location.cell])).toEqual([
      ['DV_E_NOT_SUPPORTED', 'A1'],
      ['DV_E_NOT_SUPPORTED', 'A2'],
      ['DV_E_NOT_SUPPORTED', 'A3'],
      ['DV_E_NOT_SUPPORTED', 'A4'],
    ]);
  });

  it('reports the problems of tags in cells with their places', () => {
    const error = invalid(buildXlsx({ Data: { A1: '{name', B2: '{a | uper}' } }));
    expect(error.errors.map((e) => [e.code, e.location.description, e.location.character])).toEqual([
      ['DV_E_TAG_UNCLOSED', 'sheet Data, cell A1', 1],
      ['DV_E_FORMATTER_UNKNOWN', 'sheet Data, cell B2', 1],
    ]);
  });

  it('returns no tags for a workbook without tags', () => {
    expect(inspect(buildXlsx({ Data: { A1: 'Total', B1: 3 } }))).toMatchObject({ format: 'xlsx', tags: [], sections: [], warnings: [] });
  });
});
