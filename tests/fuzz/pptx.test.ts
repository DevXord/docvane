// Property tests on presentations: tags are found however the text of a shape is split into runs,
// and random templates with random data give a DvError or a presentation that reads back.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inspect, isDvError, render } from 'docvane';
import { ap, ar, buildPptx, sp } from '../helpers/pptx';
import { slideTexts } from '../helpers/read-pptx';
import { NUM_RUNS } from './runs';

const piece = fc.constantFrom('{a}', '{#items}', '{/items}', '{.}', '{ b | upper }', 'text ', '{', '}', '{c.d}', ' ');
const text = fc.array(piece, { maxLength: 8 }).map((xs) => xs.join(''));

function outcome(bytes: Uint8Array): unknown {
  try {
    const r = inspect(bytes);
    return { tags: r.tags, schema: r.schema };
  } catch (error) {
    if (!isDvError(error)) throw error;
    return error.errors.map((e) => [e.code, e.location]);
  }
}

describe('presentation properties', () => {
  it('finds the same tags however the text of a shape is split into runs', () => {
    fc.assert(
      fc.property(text, fc.array(fc.nat(), { maxLength: 10 }), fc.array(fc.constantFrom('', 'b="1"', 'i="1"', 'u="sng"'), { minLength: 1, maxLength: 5 }), (t, cuts, attrs) => {
        const points = [...new Set(cuts.map((c) => c % (t.length + 1)))].sort((x, y) => x - y);
        const pieces: string[] = [];
        let from = 0;
        for (const p of [...points, t.length]) {
          if (p > from) pieces.push(t.slice(from, p));
          from = p;
        }
        const split = pieces.map((x, i) => ar(x, attrs[i % attrs.length] ?? '')).join('');
        const plain = t === '' ? '' : ar(t);
        expect(outcome(buildPptx([{ shapes: sp('S', `<a:p>${split}</a:p>`), notes: sp('N', ap('n')) }]))).toEqual(outcome(buildPptx([{ shapes: sp('S', `<a:p>${plain}</a:p>`), notes: sp('N', ap('n')) }])));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('render gives a DvError or a presentation that reads back', () => {
    const value = fc.oneof(fc.string({ maxLength: 5 }).filter((s) => !/[{}]/.test(s)), fc.integer(), fc.constant(null), fc.array(fc.dictionary(fc.constantFrom('a', 'b'), fc.string({ maxLength: 3 }).filter((s) => !/[{}]/.test(s)), { maxKeys: 2 }), { maxLength: 3 }));
    fc.assert(
      fc.property(fc.array(text, { minLength: 1, maxLength: 4 }), fc.dictionary(fc.constantFrom('a', 'b', 'c', 'items'), value, { maxKeys: 4 }), (slides, data) => {
        try {
          const bytes = render(buildPptx(slides.map((t) => ({ shapes: sp('S', ap(t)) }))), data, { limits: { maxIterations: 1000 } });
          expect(slideTexts(bytes).length).toBeGreaterThanOrEqual(0);
        } catch (error) {
          if (!isDvError(error)) throw error;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
