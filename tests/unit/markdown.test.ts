// {~text}: Markdown with the template's own heading, list and character styles.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { render, type DvWarning } from 'docvane';
import { parseInline, parseMarkdown } from '../../packages/docvane/src/markdown/parse';
import { NUM_RUNS } from '../fuzz/runs';
import { buildDocx, p, run, style } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { bodyText, partXml } from '../helpers/read-docx';

const STYLES = [
  style('paragraph', 'Heading1', 'Heading 1'),
  style('paragraph', 'Heading2', 'Heading 2'),
  style('paragraph', 'ListBullet', 'List Bullet'),
  style('paragraph', 'ListBullet2', 'List Bullet 2'),
  style('paragraph', 'ListNumber', 'List Number'),
  style('character', 'Hyperlink', 'Hyperlink'),
].join('');

describe('Markdown parser', () => {
  it('reads blocks', () => {
    expect(parseMarkdown('# Title\n\nFirst line\nsame paragraph\n\n- a\n  - b\n1. one\n2) two\n\n## Sub ##').map((b) => [b.kind, 'level' in b ? b.level : null, b.content.map((i) => i.text).join('')])).toEqual([
      ['heading', 1, 'Title'],
      ['paragraph', null, 'First line same paragraph'],
      ['item', 0, 'a'],
      ['item', 1, 'b'],
      ['item', 0, 'one'],
      ['item', 0, 'two'],
      ['heading', 2, 'Sub'],
    ]);
  });

  it('reads inline formatting, code, links, escapes and hard breaks', () => {
    const inline = parseInline('**bold** and *it* _too_ snake_case_name `co*de*` [site](https://x.org) \\*not\\* a**b');
    expect(inline.map((i) => [i.text, i.bold, i.italic, i.code, i.link ?? null])).toEqual([
      ['bold', true, false, false, null],
      [' and ', false, false, false, null],
      ['it', false, true, false, null],
      [' ', false, false, false, null],
      ['too', false, true, false, null],
      [' snake_case_name ', false, false, false, null],
      ['co*de*', false, false, true, null],
      [' ', false, false, false, null],
      ['site', false, false, false, 'https://x.org'],
      [' *not* a', false, false, false, null],
      ['**', false, false, false, null],
      ['b', false, false, false, null],
    ]);
    expect(parseMarkdown('a  \nb\\\nc')[0]?.content.map((i) => [i.text, i.breakBefore === true])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
    ]);
  });

  it('keeps raw HTML as text', () => {
    expect(parseInline('<script>alert(1)</script>').map((i) => i.text).join('')).toBe('<script>alert(1)</script>');
  });

  it('is linear on hostile input', () => {
    const started = Date.now();
    for (const s of ['*'.repeat(100_000), '_a'.repeat(50_000), '['.repeat(100_000), '[a]('.repeat(30_000), '`'.repeat(100_000), `${' '.repeat(100_000)}x`, '#'.repeat(100_000), `${'- '.repeat(1000)}x\n`.repeat(50)]) parseMarkdown(s);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('never throws, and gives back every letter of the input', () => {
    const chars = fc.constantFrom('a', ' ', '*', '_', '`', '[', ']', '(', ')', '\\', '#', '-', '1', '.', '\n', 'ż');
    fc.assert(
      fc.property(fc.array(chars, { maxLength: 60 }), (parts) => {
        const text = parts.join('');
        const out = parseMarkdown(text).flatMap((b) => b.content.map((i) => i.text + (i.link ?? ''))).join('');
        for (const letter of text.match(/[aż]/g) ?? []) expect(out).toContain(letter);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Markdown in documents', () => {
  const md = '# Offer\n\nWe offer **free** delivery and *fast* [support](https://example.com).\n\n- Desk\n  - oak\n- Chair\n\n1. Order\n2. Pay';

  it('replaces a paragraph that holds only the tag with paragraphs in the template’s styles', () => {
    const bytes = render(buildDocx({ body: p('Before') + `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('{~summary}')}</w:p>` + p('After'), styles: STYLES }), { summary: md });
    expect(bodyText(bytes)).toEqual(['Before', 'Offer', 'We offer free delivery and fast support.', 'Desk', 'oak', 'Chair', 'Order', 'Pay', 'After']);
    const xml = partXml(bytes);
    expect([...xml.matchAll(/<w:pStyle w:val="([^"]+)"\/>/g)].map((m) => m[1])).toEqual(['Heading1', 'ListBullet', 'ListBullet2', 'ListBullet', 'ListNumber', 'ListNumber']);
    expect(xml).toContain('<w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="both"/></w:pPr>');
    expect(xml).toContain('<w:rPr><w:b/><w:bCs/></w:rPr><w:t>free</w:t>');
    expect(xml).toContain('<w:rPr><w:i/><w:iCs/></w:rPr><w:t>fast</w:t>');
    expect(xml).toMatch(/<w:hyperlink [^>]*><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t>support<\/w:t><\/w:r><\/w:hyperlink>/);
    expect(xml).not.toContain('w:numPr');
  });

  it('keeps the tag paragraph’s style and writes list marks as text when the template has no such styles, with a warning', () => {
    const warnings: DvWarning[] = [];
    const bytes = render(buildDocx({ body: p('{~summary}') }), { summary: '# T\n\n- a\n- b\n\n1. x' }, { onWarning: (w) => warnings.push(w) });
    expect(bodyText(bytes)).toEqual(['T', '• a', '• b', '1. x']);
    expect(partXml(bytes)).not.toContain('w:pStyle');
    expect(warnings.map((w) => w.message)).toEqual([
      'The template has no paragraph style "heading 1", so these paragraphs keep the style of the tag’s paragraph.',
      'The template has no paragraph style "List Bullet", so these paragraphs keep the style of the tag’s paragraph.',
      'The template has no paragraph style "List Number", so these paragraphs keep the style of the tag’s paragraph.',
    ]);
  });

  it('writes inline Markdown in a paragraph with other text, and refuses blocks there', () => {
    expect(bodyText(render(buildDocx({ body: p('Note: {~n}!') }), { n: 'very **important**' }))).toEqual(['Note: very important!']);
    const error = expectDvError(() => render(buildDocx({ body: p('Note: {~n}') }), { n: '# Title\n\ntext' }), 'DV_E_DATA_INVALID');
    expect(error.errors[0]?.hint).toMatch(/alone in a paragraph/);
  });

  it('escapes everything and checks link addresses', () => {
    expect(bodyText(render(buildDocx({ body: p('{~n}') }), { n: '<w:p>&amp;</w:p> **<b>**' }))).toEqual(['<w:p>&amp;</w:p> <b>']);
    // A link whose address cannot be a link shows its text without one (review 3).
    const unsafe = render(buildDocx({ body: p('{~n}') }), { n: '[x](javascript:alert(1)) [docs](./docs)' });
    expect(bodyText(unsafe)).toEqual(['x docs']);
    expect(partXml(unsafe)).not.toContain('hyperlink');
  });

  it('limits the length of Markdown', () => {
    expectDvError(() => render(buildDocx({ body: p('{~n}') }), { n: 'x'.repeat(101) }, { limits: { maxMarkdownLength: 100 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxMarkdownLength' });
  });
});
