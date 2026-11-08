// Property tests of validate (D-047): for random templates and data, validate is valid exactly
// when render does not throw TV_E_DATA_INVALID, its errors are those of render, and it never
// throws for the data.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTvError, render, validate } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { buildXlsx } from '../helpers/xlsx';
import { NUM_RUNS } from './runs';

const piece = fc.constantFrom('{a}', '{#items}', '{/items}', '{.}', '{ b | upper }', 'text ', '{c.d}', '{name}', '{#flag}', '{/flag}', '{^flag}', '{n | number}', '{a || b}', '{#n > 1}', '{/n > 1}');
const text = fc.array(piece, { minLength: 1, maxLength: 5 }).map((xs) => xs.join(''));
const leaf = fc.oneof(fc.string({ maxLength: 4 }).filter((s) => !/[\u0000-\u0008]/.test(s)), fc.integer(), fc.constant(null), fc.boolean(), fc.constant({}), fc.constant([]));
const value = fc.oneof(leaf, fc.array(fc.dictionary(fc.constantFrom('name', 'a', 'c'), leaf, { maxKeys: 3 }), { maxLength: 3 }), fc.dictionary(fc.constantFrom('d', 'name'), leaf, { maxKeys: 2 }));
const data = fc.dictionary(fc.constantFrom('a', 'b', 'c', 'items', 'flag', 'n', 'name'), value, { maxKeys: 6 });

function outcome(fn: () => unknown): { kind: 'ok' } | { kind: 'data'; errors: unknown[] } | { kind: 'other'; code: string } {
  try {
    fn();
    return { kind: 'ok' };
  } catch (error) {
    if (!isTvError(error)) throw error;
    if (error.code === 'TV_E_DATA_INVALID') return { kind: 'data', errors: error.errors.map((e) => [e.code, e.message, e.details]) };
    return { kind: 'other', code: error.code };
  }
}

describe('validate properties', () => {
  it('agrees with render on documents and workbooks', () => {
    fc.assert(
      fc.property(fc.array(text, { minLength: 1, maxLength: 3 }), data, fc.boolean(), (paragraphs, d, workbook) => {
        const template = workbook ? buildXlsx({ Data: Object.fromEntries(paragraphs.map((t, i) => [`A${String(i + 1)}`, t])) }) : buildDocx({ body: paragraphs.map((t) => p(t)).join('') });
        const rendered = outcome(() => render(template, d, { limits: { maxIterations: 1000 } }));
        let result: ReturnType<typeof validate> | undefined;
        const validated = outcome(() => (result = validate(template, d, { limits: { maxIterations: 1000 } })));
        if (rendered.kind === 'other') {
          // A problem of the template or a limit: validate throws the same, or (for what only writing finds) passes.
          if (validated.kind === 'other') expect(validated.code).toBe(rendered.code);
          return;
        }
        expect(validated.kind).toBe('ok');
        const r = result as ReturnType<typeof validate>;
        expect(r.valid).toBe(rendered.kind === 'ok');
        if (rendered.kind === 'data') expect(r.errors.map((e) => [e.code, e.message, e.details])).toEqual(rendered.errors);
      }),
      { numRuns: Math.min(NUM_RUNS, 2000) },
    );
  });
});
