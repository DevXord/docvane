// Property tests on workbooks: random cells of tags, text, numbers and formulas with random data
// give a DvError or a workbook that xlvane reads back; formulas below a repeated row always cover
// every copy.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isDvError, render } from 'docvane';
import { readWorkbook } from 'xlvane';
import { buildXlsx, readXlsx, type SheetSpec } from '../helpers/xlsx';
import { NUM_RUNS } from './runs';

const piece = fc.constantFrom('{a}', '{#items}', '{/items}', '{.}', '{ b | upper }', 'text ', '{', '}', '{c.d}', ' ', '{name}', '{#flag}', '{/flag}');
const text = fc.array(piece, { minLength: 1, maxLength: 4 }).map((xs) => xs.join(''));
const cellValue = fc.oneof(text, text, fc.integer(), fc.constantFrom({ formula: 'A1+1' }, { formula: 'SUM(A1:A2)' }, { formula: 'SUM($B$1:B3)' }));
const ref = fc.tuple(fc.constantFrom('A', 'B', 'C'), fc.integer({ min: 1, max: 6 })).map(([c, r]) => `${c}${String(r)}`);
const safe = fc.string({ maxLength: 5 }).filter((s) => !/[{}\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/.test(s));
const value = fc.oneof(safe, fc.integer(), fc.constant(null), fc.boolean(), fc.array(fc.record({ name: fc.oneof(safe, fc.integer()), a: safe }), { maxLength: 4 }));

describe('workbook properties', () => {
  it('render gives a DvError or a workbook that reads back', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(ref, cellValue), { minLength: 1, maxLength: 8 }), fc.dictionary(fc.constantFrom('a', 'b', 'items', 'flag', 'c'), value, { maxKeys: 5 }), (cells, data) => {
        const sheet: Record<string, unknown> = {};
        for (const [r, v] of cells) sheet[r] = v;
        try {
          const bytes = render(buildXlsx({ Data: sheet as SheetSpec, Other: { A1: { formula: 'SUM(Data!A1:A3)' } } }), data, { limits: { maxIterations: 1000 } });
          expect(readWorkbook(bytes).sheets.length).toBe(2);
        } catch (error) {
          if (!isDvError(error)) throw error;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a total below a repeated row covers every copy', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 6 }), (above, prices) => {
        const row = above + 2;
        const sheet: Record<string, unknown> = { A1: 'Price' };
        for (let r = 2; r < row; r++) sheet[`A${String(r)}`] = r;
        sheet[`A${String(row)}`] = '{#items}{price}';
        sheet[`B${String(row)}`] = '{/items}';
        sheet[`A${String(row + 1)}`] = { formula: `SUM(A1:A${String(row)})` };
        const out = readXlsx(render(buildXlsx({ Data: sheet as SheetSpec }), { items: prices.map((price) => ({ price })) }))['Data'] ?? {};
        const last = row + Math.max(prices.length, 1) - 1;
        const totalRow = prices.length === 0 ? row : last + 1;
        expect(out[`A${String(totalRow)}`]).toEqual({ formula: `SUM(A1:A${String(prices.length === 0 ? row - 1 : last)})` });
        prices.forEach((p, i) => expect(out[`A${String(row + i)}`]).toBe(p));
      }),
      { numRuns: Math.min(NUM_RUNS, 200) },
    );
  });
});
