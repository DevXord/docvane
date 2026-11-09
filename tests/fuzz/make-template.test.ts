// Property tests of makeTemplate (D-079): random entries on a document whose text is split over
// runs give a TvError or a template whose filled result reads as the original.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTvError, makeTemplate, render } from 'tplvane';
import { buildDocx, p, run } from '../helpers/docx';
import { bodyText } from '../helpers/read-docx';
import { NUM_RUNS } from './runs';

const word = fc.constantFrom('Jan', 'Kowalski', 'ACME', ' ', ', ', 'a', 'ab', '{', '}', '&', '<', 'ż');
const runs = fc.array(word, { minLength: 1, maxLength: 8 });
const find = fc.oneof(fc.constantFrom('Jan', 'Kowalski', 'Jan Kowalski', 'ACME', 'a', 'ab', ', ', '{', 'x'), fc.string({ maxLength: 4 }));

describe('makeTemplate properties', () => {
  it('gives a TvError or a template that renders back to the original text', () => {
    fc.assert(
      fc.property(fc.array(runs, { minLength: 1, maxLength: 3 }), fc.array(find, { minLength: 1, maxLength: 3 }), (paragraphs, finds) => {
        const doc = buildDocx({ body: paragraphs.map((rs) => p(...rs.map((r, i) => run(r, i % 2 === 0 ? '<w:b/>' : '')))).join('') });
        const data: Record<string, string> = {};
        const entries = finds.map((f, i) => {
          data[`v${String(i)}`] = f;
          return { find: f, tag: `v${String(i)}` };
        });
        try {
          const result = makeTemplate(doc, entries);
          expect(bodyText(render(result.document, data))).toEqual(bodyText(doc));
        } catch (error) {
          if (!isTvError(error)) throw error;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
