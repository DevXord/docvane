// Property tests of the expression engine and render: random expressions never crash the parser;
// random templates with random data give either a DvError or a document that reads back.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isDvError, render } from 'docvane';
import { parseTag } from '../../packages/docvane/src/template/tag';
import { buildDocx, p, run, table } from '../helpers/docx';
import { storyTexts } from '../helpers/read-docx';
import { NUM_RUNS } from './runs';

const NAMES = ['a', 'b', 'items', 'name', 'x', 'flag'];
const name = fc.constantFrom(...NAMES);

describe('expression parser properties', () => {
  it('never throws on any expression-like text, and canonical text parses to itself', () => {
    const chars = fc.constantFrom('a', 'b', '.', ' ', '|', '(', ')', '!', '=', '<', '>', '&', '"', '1', '-', 'upper', 'default("x")', 'true', 'null', ',', '#', '/');
    fc.assert(
      fc.property(fc.array(chars, { maxLength: 30 }), (parts) => {
        const parsed = parseTag(parts.join(''));
        if ('code' in parsed || parsed.kind !== 'value') return;
        const again = parseTag(parsed.formatters.length === 0 ? parsed.path : `(${parsed.path})`);
        expect('code' in again ? again.code : again.path).toBe(parsed.path);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const operand = fc.oneof(name, fc.constantFrom('1', '"x"', 'true', 'null', '.'));
const expression = fc.oneof(
  name,
  fc.tuple(operand, fc.constantFrom('==', '!=', '<', '>='), operand).map(([l, op, r]) => `${l} ${op} ${r}`),
  fc.tuple(name, name).map(([l, r]) => `${l} && !${r}`),
  name.map((n) => `${n} | default("-")`),
  name.map((n) => `${n} | upper`),
);

/** Templates with balanced sections; some put sections around paragraphs or table rows. */
const template: fc.Arbitrary<string> = fc.letrec((tie) => ({
  inline: fc.oneof(
    { depthSize: 'small' },
    fc.constantFrom('text ', '; '),
    expression.map((e) => `{${e}}`),
    fc.tuple(fc.constantFrom('#', '^'), name, tie('inline')).map(([s, n, inner]) => `{${s}${n}}${String(inner)}{/${n}}`),
  ),
  line: fc.array(tie('inline'), { maxLength: 4 }).map((xs) => xs.join('')),
  block: fc.oneof(
    { depthSize: 'small' },
    tie('line').map((l) => p(run(String(l)))),
    fc.tuple(name, fc.array(tie('block'), { maxLength: 3 })).map(([n, inner]) => p(run(`{#${n}}`)) + inner.join('') + p(run(`{/${n}}`))),
    fc.tuple(name, tie('line'), tie('line')).map(([n, a, b]) => table([[p(run(`{#${n}}${String(a)}`)), p(run(`${String(b)}{/${n}}`))]])),
  ),
  body: fc.array(tie('block'), { minLength: 1, maxLength: 4 }).map((xs) => xs.join('')),
})).body as fc.Arbitrary<string>;

const data: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string({ maxLength: 8 }).filter((s) => !s.includes('{') && !s.includes('}')),
    fc.integer(),
    fc.double({ noNaN: false }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('object'), { maxLength: 3 }),
    fc.array(fc.string({ maxLength: 3 }), { maxLength: 3 }),
    tie('object'),
  ),
  object: fc.dictionary(name, tie('value'), { maxKeys: 4 }),
})).object;

describe('render properties', () => {
  it('gives a DvError or a document that reads back, for any template and data', () => {
    fc.assert(
      fc.property(template, data, fc.boolean(), (body, values, empty) => {
        let bytes: Uint8Array;
        try {
          bytes = render(buildDocx({ body, headers: [p(run('{a | default("-")}'))] }), values, { missing: empty ? 'empty' : 'error', limits: { maxIterations: 2000, maxOutputBytes: 2_000_000 } });
        } catch (error) {
          if (!isDvError(error)) throw error;
          expect(error.hint.length).toBeGreaterThan(0);
          return;
        }
        const texts = storyTexts(bytes);
        expect(Object.keys(texts)).toContain('/word/document.xml');
        for (const paragraphs of Object.values(texts)) for (const t of paragraphs) expect(t).not.toMatch(/\{[#^/]?[a-z.]/);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
