// Property tests of the template parser and inspect. The main property (phase 1 acceptance): a
// template gives the same tags, sections, schema and problems however its text is split into
// runs and whatever non-text markup sits between them.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TvError, inspect, isTvError } from 'tplvane';
import { lexText } from '../../packages/tplvane/src/template/lexer';
import { parseTag } from '../../packages/tplvane/src/template/tag';
import { buildDocx, p, run, table } from '../helpers/docx';
import { NUM_RUNS } from './runs';

/** What inspect says about a template, as plain data: the result, or the codes and places of its problems. */
function outcome(bytes: Uint8Array): unknown {
  try {
    const result = inspect(bytes);
    return { tags: result.tags, sections: result.sections, schema: result.schema, warnings: result.warnings };
  } catch (error) {
    if (!isTvError(error)) throw error;
    return { code: error.code, errors: error.errors.map((e) => [e.code, e.location, e.details]) };
  }
}

const name = fc.constantFrom('a', 'b', 'items', 'name', 'customer.name', 'x.y.z', 'imię', 'tags');
const valueTag = fc.oneof(
  name.map((n) => `{${n}}`),
  fc.constant('{.}'),
  name.map((n) => `{ ${n} | currency("PLN") }`),
  name.map((n) => `{%${n}}`),
  name.map((n) => `{~${n}}`),
);
const word = fc.constantFrom('Dear ', 'total: ', ' ', 'and', '.', 'zażółć ', '&<>', '"quoted"');

/** Text with balanced sections, so that most generated templates are valid. */
const balanced: fc.Arbitrary<string> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    word,
    valueTag,
    fc.tuple(fc.constantFrom('#', '^'), name, tie('seq')).map(([sigil, n, inner]) => `{${sigil}${n}}${String(inner)}{/${n}}`),
  ),
  seq: fc.array(tie('node'), { maxLength: 5 }).map((parts) => parts.join('')),
})).seq as fc.Arbitrary<string>;

/** Text that may break the rules: stray braces and broken tags. */
const anyText = fc.oneof(balanced, fc.array(fc.oneof(word, valueTag, fc.constantFrom('{', '}', '{#a}', '{/a}', '{a b}', '{__proto__}')), { maxLength: 8 }).map((a) => a.join('')));

const NOISE = [
  '<w:proofErr w:type="spellStart"/>',
  '<w:proofErr w:type="spellEnd"/>',
  '<w:bookmarkStart w:id="1" w:name="b"/>',
  '<w:bookmarkEnd w:id="1"/>',
  '<w:commentRangeStart w:id="2"/>',
  '<w:commentRangeEnd w:id="2"/>',
  '<w:r><w:rPr><w:i/></w:rPr></w:r>',
  '<w:r><w:lastRenderedPageBreak/></w:r>',
  '<w:del w:id="3" w:author="a"><w:r><w:delText>{deleted}</w:delText></w:r></w:del>',
];
const RPR = ['', '<w:b/>', '<w:i/>', '<w:rFonts w:ascii="Arial"/>', '<w:lang w:val="pl-PL"/>'];
const WRAP: readonly ((xml: string) => string)[] = [
  (x) => x,
  (x) => `<w:hyperlink r:id="rId1">${x}</w:hyperlink>`,
  (x) => `<w:smartTag w:uri="u" w:element="e">${x}</w:smartTag>`,
  (x) => `<w:ins w:id="4" w:author="a">${x}</w:ins>`,
  (x) => `<w:sdt><w:sdtContent>${x}</w:sdtContent></w:sdt>`,
];

/** The same text as runs cut at the given points, with noise and wrappers chosen by `choices`. */
function splitParagraph(text: string, cuts: readonly number[], choices: readonly number[]): string {
  const points = [...new Set(cuts.map((c) => c % (text.length + 1)))].sort((x, y) => x - y);
  const pieces: string[] = [];
  let from = 0;
  for (const point of [...points, text.length]) {
    if (point > from || point === text.length) pieces.push(text.slice(from, point));
    from = point;
  }
  let i = 0;
  const pick = (): number => choices[i++ % Math.max(1, choices.length)] ?? 0;
  return `<w:p>${pieces
    .map((piece) => {
      const noise = pick() % 3 === 0 ? (NOISE[pick() % NOISE.length] as string) : '';
      const r = piece === '' ? '' : run(piece, RPR[pick() % RPR.length] as string);
      return noise + (WRAP[pick() % WRAP.length] as (x: string) => string)(r);
    })
    .join('')}</w:p>`;
}

describe('template parser properties', () => {
  it('lexText and parseTag never throw and stay within the text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), fc.integer({ min: 2, max: 300 }), (text, max) => {
        const { tags, problems } = lexText(text, max);
        for (const tag of tags) {
          expect(text.slice(tag.start, tag.end)).toBe(tag.raw);
          expect(tag.raw.length).toBeLessThanOrEqual(max);
          const parsed = parseTag(tag.inner);
          if ('code' in parsed) expect(parsed.position).toBeLessThanOrEqual(tag.inner.length);
        }
        for (const problem of problems) expect(problem.start).toBeLessThan(text.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('parseTag never throws on any inside of a tag', () => {
    const tagChars = fc.constantFrom('a', 'ż', '.', ' ', '|', '(', ')', ',', '"', '„', '”', "'", '\\', '#', '^', '/', '%', '~', '-', '1', 'e', '>', '!', '_');
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 40 }), fc.array(tagChars, { maxLength: 30 }).map((a) => a.join(''))), (inner) => {
        const parsed = parseTag(inner);
        // Only {/} has an empty path: it closes the innermost section.
        if (!('code' in parsed) && !(parsed.kind === 'close' && inner.trim() === '/')) expect(parsed.path.length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('inspect finds the same tags, sections, schema and problems however the text is split into runs', () => {
    fc.assert(
      fc.property(
        fc.array(anyText, { minLength: 1, maxLength: 4 }),
        fc.array(fc.array(fc.nat(), { maxLength: 12 }), { minLength: 4, maxLength: 4 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
        fc.boolean(),
        (texts, cuts, choices, inTable) => {
          const plain = texts.map((t) => p(run(t))).join('');
          const split = texts.map((t, i) => splitParagraph(t, cuts[i % cuts.length] ?? [], choices)).join('');
          const wrap = (body: string): string => (inTable ? table([[body]]) : body);
          expect(outcome(buildDocx({ body: wrap(split), headers: [split] }))).toEqual(outcome(buildDocx({ body: wrap(plain), headers: [plain] })));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('inspect accepts every balanced template', () => {
    fc.assert(
      fc.property(balanced, (text) => {
        const result = outcome(buildDocx({ body: p(run(`{#root}${text}{/root}`)) }));
        expect(result).not.toHaveProperty('code');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('inspect on hostile input', () => {
  const valid = buildDocx({ body: p('{#items}{name}{/items}') + table([[p('{a}')]]), headers: [p('{h}')], footnotes: [p('{f}')] });

  it('throws only TvError for random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), (bytes) => {
        try {
          inspect(bytes);
        } catch (error) {
          expect(error).toBeInstanceOf(TvError);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws only TvError for a valid template with bytes changed', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 8 }), (changes) => {
        const bytes = valid.slice();
        for (const [at, value] of changes) bytes[at % bytes.length] = value;
        try {
          inspect(bytes);
        } catch (error) {
          expect(error).toBeInstanceOf(TvError);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws only TvError for random WordprocessingML bodies', () => {
    const open = fc.constantFrom('<w:p>', '<w:r>', '<w:t>', '<w:tbl>', '<w:tr>', '<w:tc>', '<w:txbxContent>', '<mc:AlternateContent>', '<mc:Choice>', '<mc:Fallback>', '<w:del>', '<w:hyperlink>');
    const piece = fc.oneof(open, open.map((o) => o.replace('<', '</')), fc.constantFrom('{a}', '{#a}', '{/a}', 'x', '<w:tab/>', '<w:br/>', '<w:footnote w:type="separator">'));
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), (pieces) => {
        try {
          inspect(buildDocx({ body: pieces.join('') }));
        } catch (error) {
          expect(error).toBeInstanceOf(TvError);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('delimiters', () => {
  it('finds the same tags with other delimiters as with { and }', () => {
    const piece = fc.constantFrom('{', '}', 'a', ' ', '#', '/', '.', 'x', '|', '"');
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 40 }), fc.constantFrom(['[[', ']]'], ['{{', '}}'], ['<%', '%>'], ['$', '€']), (pieces, [start, end]) => {
        const text = pieces.join('');
        const other = pieces.map((c) => (c === '{' ? start : c === '}' ? end : c)).join('');
        const a = lexText(text, 1024);
        const b = lexText(other, 1024, Number.POSITIVE_INFINITY, { start: start as string, end: end as string });
        expect(b.tags.map((t) => t.inner)).toEqual(a.tags.map((t) => t.inner));
        expect(b.problems.map((p) => p.code)).toEqual(a.problems.map((p) => p.code));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
