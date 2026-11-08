// Property tests of Markdown: the parser never throws and keeps the text; rendering random
// Markdown gives a TvError or a document that reads back.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTvError, render } from 'tplvane';
import { parseMarkdown } from '../../packages/tplvane/src/markdown/parse';
import { buildDocx, p } from '../helpers/docx';
import { bodyText } from '../helpers/read-docx';
import { NUM_RUNS } from './runs';

const piece = fc.oneof(fc.constantFrom('a', 'ż', ' ', '  ', '\n', '\n\n', '*', '**', '_', '`', '[', ']', '(', ')', '\\', '#', '# ', '- ', '  - ', '1. ', 'https://x.org', 'javascript:x', '<b>', '&'), fc.string({ maxLength: 3 }));
const markdown = fc.array(piece, { maxLength: 40 }).map((xs) => xs.join(''));

describe('Markdown properties', () => {
  it('the parser never throws and keeps every letter', () => {
    fc.assert(
      fc.property(markdown, (text) => {
        const out = parseMarkdown(text).flatMap((b) => b.content.map((i) => i.text + (i.link ?? ''))).join('');
        for (const letter of text.match(/[aż]/g) ?? []) expect(out).toContain(letter);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('render gives a TvError or a document that reads back, alone in a paragraph or inline', () => {
    fc.assert(
      fc.property(markdown, fc.boolean(), (text, inline) => {
        try {
          const lines = bodyText(render(buildDocx({ body: p(inline ? 'Note: {~m}.' : '{~m}') }), { m: text }));
          expect(Array.isArray(lines)).toBe(true);
        } catch (error) {
          if (!isTvError(error)) throw error;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
