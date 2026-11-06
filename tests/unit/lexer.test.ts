// Splitting the text of a paragraph into tags (docs/syntax.md, "Tags in text").
import { describe, expect, it } from 'vitest';
import { lexText } from '../../packages/docvane/src/template/lexer';

describe('lexText', () => {
  it('finds tags with their offsets', () => {
    const { tags, problems } = lexText('Dear {customer.name}, total {total | currency("PLN")}.', 1024);
    expect(problems).toEqual([]);
    expect(tags).toEqual([
      { start: 5, end: 20, raw: '{customer.name}', inner: 'customer.name' },
      { start: 28, end: 53, raw: '{total | currency("PLN")}', inner: 'total | currency("PLN")' },
    ]);
  });

  it('returns nothing for text without braces', () => {
    expect(lexText('No tags here.', 1024)).toEqual({ tags: [], problems: [], delimiters: { start: '{', end: '}' } });
    expect(lexText('', 1024)).toEqual({ tags: [], problems: [], delimiters: { start: '{', end: '}' } });
  });

  it('reports a tag that is not closed before the end of the paragraph', () => {
    const { tags, problems } = lexText('Hello {name and more', 1024);
    expect(tags).toEqual([]);
    expect(problems).toEqual([{ code: 'DV_E_TAG_UNCLOSED', start: 6, raw: '{name and more' }]);
  });

  it('reports a tag that is not closed before the next one opens, and keeps reading', () => {
    const { tags, problems } = lexText('{a {b}', 1024);
    expect(problems).toEqual([{ code: 'DV_E_TAG_UNCLOSED', start: 0, raw: '{a ' }]);
    expect(tags).toEqual([{ start: 3, end: 6, raw: '{b}', inner: 'b' }]);
  });

  it('reports a closing brace without an opening one', () => {
    const { tags, problems } = lexText('a} {b} c}', 1024);
    expect(problems).toEqual([
      { code: 'DV_E_TAG_UNOPENED', start: 1, raw: '}' },
      { code: 'DV_E_TAG_UNOPENED', start: 8, raw: '}' },
    ]);
    expect(tags.map((t) => t.inner)).toEqual(['b']);
  });

  it('reports a tag longer than the limit as a limit problem', () => {
    const long = `{${'a'.repeat(30)}}`;
    expect(lexText(long, 32).problems).toEqual([]);
    expect(lexText(long, 31).problems).toEqual([{ code: 'DV_E_LIMIT_EXCEEDED', start: 0, raw: long }]);
    // An unclosed tag is reported as unclosed, whatever its length.
    expect(lexText(`{${'a'.repeat(50)}`, 10).problems[0]?.code).toBe('DV_E_TAG_UNCLOSED');
  });

  it('shortens the text of long problems', () => {
    const raw = lexText(`{${'x'.repeat(5000)}`, 1024).problems[0]?.raw ?? '';
    expect(raw.length).toBeLessThanOrEqual(201);
  });

  it('is linear: a paragraph of a million braces is handled quickly', () => {
    const started = Date.now();
    lexText('{'.repeat(1_000_000), 1024);
    lexText('}'.repeat(1_000_000), 1024);
    lexText('{a}'.repeat(300_000), 1024);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
