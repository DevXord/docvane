// render on Excel workbooks: typed values, text, repeated rows with their formulas and formats,
// the docvane rule for areas below the copies (D-041), and errors.
import { describe, expect, it } from 'vitest';
import { render, renderAsync } from 'docvane';
import { expectDvError } from '../helpers/expect-error';
import { buildXlsx, readXlsx, workbookOf } from '../helpers/xlsx';

const items = [
  { name: 'Desk', price: 1200 },
  { name: 'Chair', price: 350.5 },
  { name: 'Lamp', price: 99 },
];

describe('render on XLSX: values', () => {
  it('writes a cell that holds only a value tag with the type of the value', () => {
    const bytes = buildXlsx({ Data: { A1: '{n}', A2: '{d}', A3: '{b}', A4: '{s}', A5: '{z}', A6: '{big}', A7: ' {n} ' } });
    const out = readXlsx(render(bytes, { n: 12.5, d: new Date(Date.UTC(2024, 0, 31)), b: true, s: 'Anna', z: null, big: 12345678901234567890n }));
    expect(out['Data']).toEqual({ A1: 12.5, A2: '2024-01-31T00:00:00.000Z', A3: true, A4: 'Anna', A6: '12345678901234567890', A7: 12.5 });
  });

  it('writes text for cells with more than one tag, other text or formatters', () => {
    const bytes = buildXlsx({ Data: { A1: 'Total: {n}', A2: '{s | upper}', A3: '{n | number(2)}', A4: '{first} {last}', A5: '{#tags}{.}, {/tags}' } });
    const out = readXlsx(render(bytes, { n: 1234.5, s: 'anna', first: 'Anna', last: 'Nowak', tags: ['a', 'b'] }));
    expect(out['Data']).toEqual({ A1: 'Total: 1234.5', A2: 'ANNA', A3: '1,234.50', A4: 'Anna Nowak', A5: 'a, b, ' });
  });

  it('keeps the format of the cell, and gives a date a date format when the cell has none', () => {
    const bytes = buildXlsx({ Data: { A1: { value: '{n}', style: { numFmt: '0.00', font: { bold: true } } }, A2: '{d}', A3: { value: '{d}', style: { numFmt: 'dd.mm.yyyy' } } } });
    const sheet = workbookOf(render(bytes, { n: 2, d: new Date(Date.UTC(2024, 0, 31)) })).getSheet('Data');
    expect(sheet.cell('A1')?.style).toMatchObject({ numFmt: '0.00', font: { bold: true } });
    expect(sheet.cell('A2')?.numFmt).toMatch(/y/);
    expect(sheet.cell('A3')?.numFmt).toBe('dd.mm.yyyy');
  });

  it('writes text that looks like a formula as text', () => {
    const out = readXlsx(render(buildXlsx({ Data: { A1: '{s}' } }), { s: '=HYPERLINK("https://example.com","x")' }));
    expect(out['Data']).toEqual({ A1: '=HYPERLINK("https://example.com","x")' });
  });

  it('leaves cells without tags, numbers and formulas as they are', () => {
    const bytes = buildXlsx({ Data: { A1: 'Title', B1: 3, C1: { formula: 'B1*2' }, D1: '{x}' } });
    expect(readXlsx(render(bytes, { x: 'y' }))['Data']).toEqual({ A1: 'Title', B1: 3, C1: { formula: 'B1*2' }, D1: 'y' });
  });
});

describe('render on XLSX: repeated rows', () => {
  const template = (): Uint8Array =>
    buildXlsx({
      Data: {
        A1: 'Name',
        B1: 'Price',
        C1: 'Double',
        A2: { value: '{#items}{name}', style: { font: { bold: true } } },
        B2: { value: '{price}{/items}', style: { numFmt: '0.00' } },
        C2: { formula: 'B2*2' },
        D2: { value: null, style: { fill: { color: 'FFFF00' } } },
        A3: 'Total',
        B3: { formula: 'SUM(B2:B2)' },
        C3: { formula: 'SUM($C$1:C2)' },
      },
      Summary: { A1: { formula: 'Data!B3' }, A2: { formula: 'SUM(Data!B2:B2)' }, A3: { formula: 'Data!B2' } },
    });

  it('repeats a row for each item, moves its formulas and extends the areas that end on it', () => {
    const out = readXlsx(render(template(), { items }));
    expect(out['Data']).toEqual({
      A1: 'Name',
      B1: 'Price',
      C1: 'Double',
      A2: 'Desk',
      B2: 1200,
      C2: { formula: 'B2*2' },
      A3: 'Chair',
      B3: 350.5,
      C3: { formula: 'B3*2' },
      A4: 'Lamp',
      B4: 99,
      C4: { formula: 'B4*2' },
      A5: 'Total',
      B5: { formula: 'SUM(B2:B4)' },
      C5: { formula: 'SUM($C$1:C4)' },
    });
    expect(out['Summary']).toEqual({ A1: { formula: 'Data!B5' }, A2: { formula: 'SUM(Data!B2:B4)' }, A3: { formula: 'Data!B2' } });
  });

  it('copies the format of the row to the new rows', () => {
    const sheet = workbookOf(render(template(), { items })).getSheet('Data');
    for (const row of [3, 4]) {
      expect(sheet.cell(`A${String(row)}`)?.style.font?.bold, `A${String(row)}`).toBe(true);
      expect(sheet.cell(`B${String(row)}`)?.numFmt).toBe('0.00');
      expect([...sheet.styledCells()].find((c) => c.ref === `D${String(row)}`)?.style.fill).toMatchObject({ fgColor: 'FFFFFF00' });
    }
  });

  it('keeps the row for one item', () => {
    const out = readXlsx(render(template(), { items: items.slice(0, 1) }));
    expect(out['Data']?.['B3']).toEqual({ formula: 'SUM(B2:B2)' });
    expect(out['Data']?.['A2']).toBe('Desk');
  });

  it('deletes the rows for an empty list; an area that starts at the header row stays valid', () => {
    const bytes = buildXlsx({ Data: { A1: 'Price', A2: '{#items}{price}', B2: '{/items}', A3: { formula: 'SUM(A1:A2)' }, B3: { formula: 'SUM(A2:A2)' } } });
    const out = readXlsx(render(bytes, { items: [] }))['Data'];
    expect(out?.['A1']).toBe('Price');
    expect(out?.['A2']).toEqual({ formula: 'SUM(A1:A1)' });
    expect(out?.['B2']).toEqual({ formula: 'SUM(#REF!)' });
  });

  it('repeats a block of several rows, copying the formats of cells with values', () => {
    const bytes = buildXlsx({
      Data: {
        A2: { value: '{#items}{name}', style: { font: { italic: true } } },
        A3: 'Price',
        B3: { value: '{price}{/items}', style: { numFmt: '0.00' } },
        B4: { formula: 'SUM(B3:B3)' },
      },
    });
    const result = render(bytes, { items: items.slice(0, 2) });
    expect(readXlsx(result)['Data']).toEqual({ A2: 'Desk', A3: 'Price', B3: 1200, A4: 'Chair', A5: 'Price', B5: 350.5, B6: { formula: 'SUM(B3:B5)' } });
    const sheet = workbookOf(result).getSheet('Data');
    expect(sheet.cell('A4')?.style.font?.italic).toBe(true);
    expect(sheet.cell('B5')?.numFmt).toBe('0.00');
  });

  it('drops rows that hold only the tags of the section', () => {
    const bytes = buildXlsx({ Data: { A1: 'Name', A2: '{#items}', A3: '{name}', B3: '{price}', C3: { formula: 'B3*2' }, A4: '{/items}', B5: { formula: 'SUM(B3:B3)' } } });
    expect(readXlsx(render(bytes, { items: items.slice(0, 2) }))['Data']).toEqual({
      A1: 'Name',
      A2: 'Desk',
      B2: 1200,
      C2: { formula: 'B2*2' },
      A3: 'Chair',
      B3: 350.5,
      C3: { formula: 'B3*2' },
      B4: { formula: 'SUM(B2:B3)' },
    });
    expect(readXlsx(render(bytes, { items: [] }))['Data']).toEqual({ A1: 'Name', B2: { formula: 'SUM(#REF!)' } });
  });

  it('shows or deletes rows by a condition, and fills sections within a cell of a repeated row', () => {
    const bytes = buildXlsx({ Data: { A1: '{#vip}VIP', B2: 'since {year}{/vip}', A3: '{#items}{name}', B3: '{#tags}{.} {/tags}{/items}', A4: 'end' } });
    const data = { vip: true, year: 2020, items: [{ name: 'A', tags: ['x', 'y'] }, { name: 'B', tags: [] }] };
    expect(readXlsx(render(bytes, data))['Data']).toEqual({ A1: 'VIP', B2: 'since 2020', A3: 'A', B3: 'x y ', A4: 'B', A5: 'end' });
    expect(readXlsx(render(bytes, { ...data, vip: false }))['Data']).toEqual({ A1: 'A', B1: 'x y ', A2: 'B', A3: 'end' });
  });

  it('renders several sections on one sheet and on other sheets, each with its totals', () => {
    const bytes = buildXlsx({
      One: { A1: '{#a}{.}', B1: '{/a}', A2: { formula: 'SUM(A1:A1)' }, A3: '{#b}{.}', B3: '{/b}', A4: { formula: 'SUM(A3:A3)' }, A5: { formula: 'Two!A2' } },
      Two: { A1: '{#c}{.}', B1: '{/c}', A2: { formula: 'SUM(A1:A1)+SUM(One!A3:A3)' } },
    });
    const out = readXlsx(render(bytes, { a: [1, 2], b: [3, 4, 5], c: [6, 7] }));
    expect(out['One']).toEqual({ A1: 1, A2: 2, A3: { formula: 'SUM(A1:A2)' }, A4: 3, A5: 4, A6: 5, A7: { formula: 'SUM(A4:A6)' }, A8: { formula: 'Two!A3' } });
    expect(out['Two']).toEqual({ A1: 6, A2: 7, A3: { formula: 'SUM(A1:A2)+SUM(One!A4:A6)' } });
  });

  it('drops the cached results of formulas, so that applications compute them on open (D-044)', () => {
    const bytes = buildXlsx({ Data: { A1: '{n}', B1: { formula: 'A1*2', result: 0 }, C1: { formula: 'B1+1', result: 1 } } });
    const sheet = workbookOf(render(bytes, { n: 5 })).getSheet('Data');
    expect([sheet.cell('B1')?.type, sheet.cell('C1')?.type]).toEqual(['empty', 'empty']);
    expect(sheet.cell('B1')?.formula?.text).toBe('A1*2');
  });

  it('copies shared formulas, which Excel writes when a formula is filled across cells, and extends those below', () => {
    const bytes = buildXlsx({
      Data: { A2: '{#items}{a}', B2: '{b}', C2: { formula: 'A2+B2', shared: 'C2:D2' }, D2: { sharedFormula: 'C2' }, E2: '{/items}', A3: { formula: 'SUM(A2:A2)', shared: 'A3:B3' }, B3: { sharedFormula: 'A3' } },
    });
    const out = readXlsx(render(bytes, { items: [{ a: 1, b: 2 }, { a: 3, b: 4 }] }))['Data'];
    expect(out).toMatchObject({ C3: { formula: 'A3+B3' }, D3: { formula: 'B3+C3' }, A4: { formula: 'SUM(A2:A3)' }, B4: { formula: 'SUM(B2:B3)' } });
  });

  it('moves merged cells below the copies; merges inside the template rows are not copied (D-042)', () => {
    const bytes = buildXlsx({ Data: { A1: '{#items}{name}', B1: '{/items}', A3: 'merged' } }, (wb) => {
      const sheet = wb.sheets[0];
      sheet?.merge('A3:B3');
    });
    expect(workbookOf(render(bytes, { items })).getSheet('Data').merges).toEqual(['A5:B5']);
  });
});

describe('render on XLSX: errors and limits', () => {
  it('lists every missing field with its cell', () => {
    const error = expectDvError(() => render(buildXlsx({ Data: { A1: '{a}', A2: '{#items}{name}', B2: '{/items}' } }), { items: [{}, { name: 'x' }] }), 'DV_E_DATA_INVALID');
    expect(error.errors.map((e) => [e.code, e.location.cell])).toEqual([
      ['DV_E_MISSING_FIELD', 'A1'],
      ['DV_E_MISSING_FIELD', 'A2'],
    ]);
  });

  it('leaves cells empty for missing values with missing: "empty"', () => {
    expect(readXlsx(render(buildXlsx({ Data: { A1: '{a}', A2: 'x{b}y' } }), {}, { missing: 'empty' }))['Data']).toEqual({ A2: 'xy' });
  });

  it('rejects values that a cell cannot hold', () => {
    const error = expectDvError(() => render(buildXlsx({ Data: { A1: '{long}', A2: '{list}', A3: '{bad}', A4: '{inf}' } }), { long: 'x'.repeat(40000), list: [1], bad: 'a\u0001', inf: Infinity }), 'DV_E_DATA_INVALID');
    expect(error.errors.map((e) => [e.code, e.location.cell])).toEqual([
      ['DV_E_INVALID_VALUE', 'A1'],
      ['DV_E_INVALID_VALUE', 'A2'],
      ['DV_E_INVALID_VALUE', 'A3'],
      ['DV_E_INVALID_VALUE', 'A4'],
    ]);
    expect(error.errors[0]?.hint).toMatch(/32767/);
  });

  it('refuses an array formula in a repeated row', () => {
    const bytes = buildXlsx({ Data: { A1: '{#items}{price}', B1: { formula: 'SUM(A1:A1*2)', array: 'B1' }, C1: '{/items}' } });
    const error = expectDvError(() => render(bytes, { items }), 'DV_E_NOT_SUPPORTED');
    expect(error.location).toMatchObject({ sheet: 'Data', cell: 'B1' });
  });

  it('passes on what xlvane refuses, such as inserting rows into a sheet with a chart, as a DvError with the cause', () => {
    const bytes = buildXlsx({ Data: { A1: '{#items}{price}', B1: '{/items}' } }, (wb) => {
      wb.sheets[0]?.addChart({ type: 'bar', anchor: 'D2:H10', series: [{ values: 'Data!$A$1:$A$1' }] });
    });
    const error = expectDvError(() => render(bytes, { items }), 'DV_E_NOT_SUPPORTED');
    expect(error.message).toMatch(/^Inserting the rows of \{#items\} failed: /);
    expect(error.details).toMatchObject({ xlvaneCode: 'XLV_E_NOT_SUPPORTED' });
    expect((error.cause as { code?: string }).code).toBe('XLV_E_NOT_SUPPORTED');
  });

  it('counts copies against maxIterations', () => {
    expectDvError(() => render(buildXlsx({ Data: { A1: '{#items}{name}', B1: '{/items}' } }), { items }, { limits: { maxIterations: 2 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxIterations' });
  });

  it('works with renderAsync', async () => {
    const out = readXlsx(await renderAsync(buildXlsx({ Data: { A1: '{a}' } }), { a: 1 }, { fetchImage: () => Promise.reject(new Error('no')) }));
    expect(out['Data']).toEqual({ A1: 1 });
  });
});
