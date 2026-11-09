// TV_W_FORMULA_NOT_EXTENDED: a formula outside repeated rows that refers to a single cell of them
// does not grow with the copies (only areas do, D-041). Google Sheets writes `SUM(D4:D4)` as
// `SUM(D4)`, so a total below a loop would add up the first item only (D-080).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WARNING_CODES, inspect, render, validate, type TvWarning } from 'tplvane';
import { singleCellRefs } from '../../packages/tplvane/src/xlsx/ranges';
import { buildXlsx } from '../helpers/xlsx';

const runs = Number(process.env['TV_FUZZ_RUNS'] ?? '100');
const rows = { sheet: 'Data', formulaSheet: 'Data', first: 4, last: 4 };

describe('singleCellRefs', () => {
  it('finds single cells of the rows, with their text', () => {
    expect(singleCellRefs('SUM(D4)', rows)).toEqual(['D4']);
    expect(singleCellRefs('D4*2+$C$4', rows)).toEqual(['D4', '$C$4']);
    expect(singleCellRefs('sum(d4)', rows)).toEqual(['d4']);
  });

  it('leaves areas, other rows, functions, strings and other sheets alone', () => {
    for (const f of ['SUM(D4:D4)', 'SUM(D3:D4)', 'D3+D5', 'LOG10(2)', '"D4"', 'Other!D4', "'Other'!D4", 'SUM(4:4)', 'SUM(D:D)', 'Table1[D4]', '[1]Data!D4']) expect(singleCellRefs(f, rows), f).toEqual([]);
  });

  it('follows sheet prefixes', () => {
    const summary = { ...rows, formulaSheet: 'Summary' };
    expect(singleCellRefs('Data!D4', summary)).toEqual(['Data!D4']);
    expect(singleCellRefs("'data'!D4*2", summary)).toEqual(["'data'!D4"]);
    expect(singleCellRefs('D4', summary)).toEqual([]);
  });

  it('covers every row of a block of rows', () => {
    expect(singleCellRefs('A3+A4+A5+A6', { ...rows, first: 4, last: 5 })).toEqual(['A4', 'A5']);
  });

  it('runs in linear time and returns only pieces of the formula that name a row of the block (property)', () => {
    const long = 'D4+'.repeat(20000) + '1';
    const started = performance.now();
    expect(singleCellRefs(long, rows)).toHaveLength(20000);
    expect(singleCellRefs("'".repeat(50000), rows)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
    const piece = fc.oneof(fc.constantFrom('SUM(', ')', '+', ',', '"D4"', "'Data'!", 'Data!', 'Other!', '$', ':', 'D4', 'D3', 'AB4', '4', '[1]', 'Table1[x]', ' '), fc.string({ maxLength: 4 }));
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), (pieces) => {
        const formula = pieces.join('');
        for (const ref of singleCellRefs(formula, rows)) {
          expect(formula).toContain(ref);
          expect(ref).toMatch(/4$/);
        }
      }),
      { numRuns: runs },
    );
  });
});

const workbook = (cells: Record<string, unknown>, more: Record<string, Record<string, unknown>> = {}): Uint8Array =>
  buildXlsx({ Data: { A3: 'Name', D3: 'Value', A4: '{#rows}{name}', D4: '{value}{/rows}', A6: 'Total', ...cells }, ...more } as never);

const codes = (warnings: readonly TvWarning[]): string[] => warnings.map((w) => w.code);

describe('TV_W_FORMULA_NOT_EXTENDED', () => {
  it('is a warning code', () => {
    expect(WARNING_CODES).toContain('TV_W_FORMULA_NOT_EXTENDED');
  });

  it('inspect warns about a total that refers to one cell of the repeated row, with the place and a hint', () => {
    const { warnings } = inspect(workbook({ D6: { formula: 'SUM(D4)' } }));
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'TV_W_FORMULA_NOT_EXTENDED',
        location: expect.objectContaining({ sheet: 'Data', cell: 'D6' }),
        details: expect.objectContaining({ formula: 'SUM(D4)', reference: 'D4', section: '{#rows}' }),
      }),
    ]);
    expect(warnings[0]?.message).toMatch(/D4/);
    expect(warnings[0]?.hint).toMatch(/D4:D4/);
    expect(warnings[0]?.hint).toMatch(/D3:D4/);
  });

  it('warns about a formula on another sheet that names the sheet', () => {
    const { warnings } = inspect(workbook({}, { Summary: { B1: { formula: 'Data!D4' } } }));
    expect(warnings.map((w) => [w.code, w.location.sheet, w.location.cell])).toEqual([['TV_W_FORMULA_NOT_EXTENDED', 'Summary', 'B1']]);
  });

  it('does not warn about areas, formulas in the repeated rows or cells outside them', () => {
    const { warnings } = inspect(workbook({ B4: { formula: 'D4*2' }, D6: { formula: 'SUM(D4:D4)' }, D7: { formula: 'SUM(D3:D4)' }, D8: { formula: 'D6*2' }, D9: { formula: 'A3' } }));
    expect(codes(warnings)).toEqual([]);
  });

  it('does not warn when no rows repeat', () => {
    expect(codes(inspect(buildXlsx({ Data: { A1: '{#vip}VIP{/vip}', B1: 1, B2: { formula: 'B1*2' } } })).warnings)).toEqual([]);
  });

  it('validate and render report it too; the formula is kept as it is', () => {
    const bytes = workbook({ D6: { formula: 'SUM(D4)' } });
    const data = { rows: [{ name: 'a', value: 1 }, { name: 'b', value: 2 }] };
    expect(codes(validate(bytes, data).warnings)).toEqual(['TV_W_FORMULA_NOT_EXTENDED']);
    const seen: TvWarning[] = [];
    render(bytes, data, { onWarning: (w) => seen.push(w) });
    expect(codes(seen)).toEqual(['TV_W_FORMULA_NOT_EXTENDED']);
  });

  it('reports at most maxErrors warnings of this kind', () => {
    const cells: Record<string, unknown> = {};
    for (let i = 10; i < 20; i++) cells[`D${String(i)}`] = { formula: 'D4' };
    expect(inspect(workbook(cells), { limits: { maxErrors: 3 } }).warnings).toHaveLength(3);
  });
});
