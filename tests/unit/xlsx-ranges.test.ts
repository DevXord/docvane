// The docvane rule for formulas below repeated rows (D-041): an A1 area that ends on the last row
// of the template grows to the last copy. The scanner is narrow on purpose: everything it does not
// recognise with certainty stays as it is.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extendAreas } from '../../packages/docvane/src/xlsx/ranges';

const runs = Number(process.env['DV_FUZZ_RUNS'] ?? '100');
const onData = { sheet: 'Data', formulaSheet: 'Data', row: 5, to: 9 };
const onSummary = { ...onData, formulaSheet: 'Summary' };

describe('extendAreas', () => {
  it('extends an area that ends on the row, keeping $ marks and case', () => {
    expect(extendAreas('SUM(C5:C5)', onData)).toBe('SUM(C5:C9)');
    expect(extendAreas('SUM($C$2:$C$5)*2', onData)).toBe('SUM($C$2:$C$9)*2');
    expect(extendAreas('sum(c3:d5)', onData)).toBe('sum(c3:d9)');
    expect(extendAreas('SUM(C5:C5)+AVERAGE(D5:D5)', onData)).toBe('SUM(C5:C9)+AVERAGE(D5:D9)');
  });

  it('extends the lower end of an area written upside down', () => {
    expect(extendAreas('SUM(C5:C2)', onData)).toBe('SUM(C9:C2)');
  });

  it('leaves single cells, areas that end elsewhere and whole rows or columns alone', () => {
    for (const f of ['C5*2', 'SUM(C4:C4)', 'SUM(C5:C6)', 'SUM(C6:C7)', 'SUM(5:5)', 'SUM(C:C)', 'LOG10(C5)', 'ATAN2(C5,C6)']) expect(extendAreas(f, onData), f).toBe(f);
  });

  it('follows sheet prefixes: plain, quoted with doubled apostrophes, and the formula sheet for none', () => {
    expect(extendAreas('SUM(Data!C5:C5)', onSummary)).toBe('SUM(Data!C5:C9)');
    expect(extendAreas("SUM('Data'!C5:C5)", onSummary)).toBe("SUM('Data'!C5:C9)");
    expect(extendAreas('SUM(data!C5:C5)', onSummary)).toBe('SUM(data!C5:C9)');
    expect(extendAreas('SUM(C5:C5)', onSummary)).toBe('SUM(C5:C5)');
    expect(extendAreas('SUM(Other!C5:C5)', onData)).toBe('SUM(Other!C5:C5)');
    const quoted = { ...onData, sheet: "Bob's data", formulaSheet: 'Summary' };
    expect(extendAreas("SUM('Bob''s data'!C5:C5)+SUM('Bob''s'!C5:C5)", quoted)).toBe("SUM('Bob''s data'!C5:C9)+SUM('Bob''s'!C5:C5)");
    const unicode = { ...onData, sheet: 'Dane', formulaSheet: 'Zestawienie' };
    expect(extendAreas('SUMA(Dane!B5:B5)', unicode)).toBe('SUMA(Dane!B5:B9)');
  });

  it('does not touch text in strings, names, structured, external or 3-D references', () => {
    for (const f of ['"C5:C5"&SUM(C4:C4)', 'CONCAT("a""C5:C5",1)', 'SUM(Table1[Price])', 'SUM([1]Data!C5:C5)', "SUM('[1]Data'!C5:C5)", 'SUM(Jan:Data!C5:C5)', "SUM('Jan:Data'!C5:C5)", 'SUM(Q1:Q4!C5:C5)', 'Prices5:C5']) {
      expect(extendAreas(f, onData), f).toBe(f);
    }
    expect(extendAreas('"x"&SUM(C5:C5)&"C5:C5"', onData)).toBe('"x"&SUM(C5:C9)&"C5:C5"');
  });

  it('runs in linear time on long formulas', () => {
    const long = 'SUM(C5:C5)+'.repeat(20000) + '1';
    const started = performance.now();
    expect(extendAreas(long, onData)).toBe('SUM(C5:C9)+'.repeat(20000) + '1');
    expect(extendAreas('"'.repeat(50000), onData)).toBe('"'.repeat(50000));
    expect(extendAreas("'".repeat(50000), onData)).toBe("'".repeat(50000));
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('changes nothing but the row numbers of areas that end on the row (property)', () => {
    const piece = fc.oneof(
      fc.constantFrom('SUM(', ')', '+', ',', '"C5:C5"', "'Data'!", 'Data!', 'Other!', '$', ':', 'C5', 'C4', 'AB5', '5', '[1]', 'Table1[x]', ' '),
      fc.string({ maxLength: 4 }),
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), (pieces) => {
        const formula = pieces.join('');
        const out = extendAreas(formula, onData);
        // Only digits 5 become 9: the length stays and every other character is kept.
        expect(out.length).toBe(formula.length);
        for (let i = 0; i < out.length; i++) if (out[i] !== formula[i]) expect([formula[i], out[i]]).toEqual(['5', '9']);
        expect(extendAreas(formula, { ...onData, to: 5 })).toBe(formula);
      }),
      { numRuns: runs },
    );
  });
});
