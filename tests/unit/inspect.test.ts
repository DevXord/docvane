// inspect: tags in every story of a DOCX, sections, errors and the data schema.
import { describe, expect, it } from 'vitest';
import { TvError, inspect, type InspectResult } from 'tplvane';
import { buildDocx, p, run, table, textBox } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';

const docx = (body: string, extra: Parameters<typeof buildDocx>[0] extends infer S ? Partial<S> : never = {}): Uint8Array => buildDocx({ body, ...extra });
const raws = (r: InspectResult): string[] => r.tags.map((t) => t.raw);
const invalid = (bytes: Uint8Array): TvError => expectDvError(() => inspect(bytes), 'TV_E_TEMPLATE_INVALID');

describe('inspect: finding tags', () => {
  it('finds tags split over runs, bookmarks and spelling marks', () => {
    const body = p('Dear {cust', run('omer.na', '<w:b/>'), '<w:proofErr w:type="spellStart"/>', 'me}, total {total | ', '<w:bookmarkStart w:id="0" w:name="x"/>', 'currency("PLN")}.', '<w:bookmarkEnd w:id="0"/>');
    const result = inspect(docx(body));
    expect(raws(result)).toEqual(['{customer.name}', '{total | currency("PLN")}']);
    expect(result.tags[1]).toMatchObject({ kind: 'value', path: 'total', formatters: [{ name: 'currency', args: ['PLN'] }] });
    expect(result.tags[0]?.location).toMatchObject({ part: '/word/document.xml', story: 'body', paragraph: 1, character: 6, description: 'body, paragraph 1' });
  });

  it('finds tags in tables, text boxes, headers, footers, footnotes and endnotes, in that order', () => {
    const bytes = docx(p('{a}') + table([[p('{b}')]]) + p(textBox(p('{c}'))), {
      headers: [p('{h}')],
      footers: [p('{f}')],
      footnotes: [p('{fn}')],
      endnotes: [p('{en}')],
    });
    const result = inspect(bytes);
    expect(result.tags.map((t) => [t.raw, t.location.description])).toEqual([
      ['{a}', 'body, paragraph 1'],
      ['{b}', 'body, table 1 row 1 cell 1, paragraph 1'],
      ['{c}', 'body, text box 1, paragraph 1'],
      ['{h}', 'header /word/header1.xml, paragraph 1'],
      ['{f}', 'footer /word/footer1.xml, paragraph 1'],
      ['{fn}', 'footnote 1, paragraph 1'],
      ['{en}', 'endnote 1, paragraph 1'],
    ]);
    expect(Object.keys(result.schema.properties ?? {})).toEqual(['a', 'b', 'c', 'h', 'f', 'fn', 'en']);
  });

  it('returns no tags and an empty schema for a document without tags', () => {
    const result = inspect(docx(p('Just text.')));
    expect(result).toMatchObject({ format: 'docx', tags: [], sections: [], warnings: [] });
    expect(result.schema).toEqual({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {} });
  });

  it('warns about a header part that the document refers to but that does not exist', () => {
    const bytes = docx(p('{a}'), { documentRels: ['<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="missing.xml"/>'] });
    const result = inspect(bytes);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'TV_W_PART_MISSING', location: { part: '/word/missing.xml' } })]);
    expect(raws(result)).toEqual(['{a}']);
  });
});

describe('inspect: sections', () => {
  it('builds the section tree with loops, conditions and inverted sections', () => {
    const body = p('{#items}') + table([[p('{name}'), p('{#tags}{.}{/tags}')]]) + p('{/items}') + p('{#isVip}VIP{/isVip}{^items}No items{/items}');
    const { sections } = inspect(docx(body));
    expect(sections.map((s) => [s.kind, s.path])).toEqual([
      ['loop', 'items'],
      ['condition', 'isVip'],
      ['inverted', 'items'],
    ]);
    const items = sections[0];
    expect(items?.tags.map((t) => t.raw)).toEqual(['{name}']);
    expect(items?.sections.map((s) => [s.kind, s.path, s.tags.map((t) => t.raw)])).toEqual([['loop', 'tags', ['{.}']]]);
    expect(items?.open.location.description).toBe('body, paragraph 1');
    expect(items?.close.location.description).toBe('body, paragraph 2');
  });

  it('reports every problem at once, each with its place, code and hint', () => {
    const body = p('{.}') + p('{#a}{b') + p('{/c}') + p('x}') + p('{}') + p('{a + 1}') + p('{__proto__}');
    const error = invalid(docx(body));
    expect(error.errors.map((e) => [e.code, e.location.description])).toEqual([
      ['TV_E_TAG_UNCLOSED', 'body, paragraph 2'],
      ['TV_E_TAG_UNOPENED', 'body, paragraph 4'],
      ['TV_E_TAG_EMPTY', 'body, paragraph 5'],
      ['TV_E_TAG_SYNTAX', 'body, paragraph 6'],
      ['TV_E_TAG_FORBIDDEN_NAME', 'body, paragraph 7'],
      ['TV_E_TAG_SYNTAX', 'body, paragraph 1'],
      ['TV_E_SECTION_UNOPENED', 'body, paragraph 3'],
      ['TV_E_SECTION_UNCLOSED', 'body, paragraph 2'],
    ]);
    for (const e of error.errors) expect(e.hint.length, e.code).toBeGreaterThan(0);
    expect(error.message).toMatch(/^The template has 8 problems\. The first: The tag "\{b" is not closed\./);
    expect(error.toJSON().errors).toHaveLength(8);
    expect(JSON.parse(JSON.stringify(error)).errors[0].code).toBe('TV_E_TAG_UNCLOSED');
  });

  it('checks formatters when it reads the template', () => {
    const error = invalid(docx(p('{a | uper}') + p('{b | currency}') + p('{c | number("2")}') + p('{d | date("yyyy-QQ")}') + p('{e | toString}')));
    expect(error.errors.map((e) => [e.code, e.location.paragraph])).toEqual([
      ['TV_E_FORMATTER_UNKNOWN', 1],
      ['TV_E_FORMATTER_ARGS', 2],
      ['TV_E_FORMATTER_ARGS', 3],
      ['TV_E_FORMATTER_ARGS', 4],
      ['TV_E_FORMATTER_UNKNOWN', 5],
    ]);
    expect(error.errors[0]?.hint).toMatch(/Did you mean "upper"\?/);
  });

  it('matches a closing tag to its section by the canonical expression', () => {
    const { sections } = inspect(docx(p('{#total>100}big{/ total > 100 }')));
    expect(sections.map((s) => [s.kind, s.path])).toEqual([['condition', 'total > 100']]);
  });

  it('reports crossed sections', () => {
    const error = invalid(docx(p('{#a}{#b}{/a}{/b}')));
    expect(error.errors.map((e) => e.code)).toEqual(['TV_E_SECTION_MISMATCH', 'TV_E_SECTION_UNOPENED']);
    expect(error.errors[0]?.message).toContain('{#b}');
  });

  it('does not let a section cross from the body into a header', () => {
    const error = invalid(docx(p('{#a}'), { headers: [p('{/a}')] }));
    expect(error.errors.map((e) => [e.code, e.location.story])).toEqual([
      ['TV_E_SECTION_UNCLOSED', 'body'],
      ['TV_E_SECTION_UNOPENED', 'header'],
    ]);
  });

  it('does not let a tag cross paragraphs', () => {
    const error = invalid(docx(p('{customer.') + p('name}')));
    expect(error.errors.map((e) => e.code)).toEqual(['TV_E_TAG_UNCLOSED', 'TV_E_TAG_UNOPENED']);
  });

  it('does not let a tab, a break or an inline object split a tag', () => {
    for (const inline of ['<w:r><w:tab/></w:r>', '<w:r><w:br/></w:r>', '<w:r><w:drawing/></w:r>']) {
      const error = invalid(docx(p('{na', inline, 'me}')));
      expect(error.errors.map((e) => e.code), inline).toEqual(['TV_E_TAG_SYNTAX']);
    }
  });

  it('gives the character position of the problem inside the tag', () => {
    const error = invalid(docx(p('Hello {name | f(x)}')));
    expect(error.errors[0]?.location.character).toBe(7);
    expect(error.errors[0]?.details).toMatchObject({ tag: '{name | f(x)}', position: 11 });
  });
});

describe('inspect: limits and input', () => {
  it('stops collecting problems at maxErrors', () => {
    const error = expectDvError(() => inspect(docx(p('}'.repeat(50))), { limits: { maxErrors: 5 } }), 'TV_E_TEMPLATE_INVALID');
    expect(error.errors).toHaveLength(5);
    expect(error.details).toMatchObject({ count: 5, truncated: true });
  });

  it('enforces maxTags, maxSectionDepth and maxTagLength', () => {
    expectDvError(() => inspect(docx(p('{a}'.repeat(11))), { limits: { maxTags: 10 } }), 'TV_E_LIMIT_EXCEEDED', { limit: 'maxTags' });
    expectDvError(() => inspect(docx(p('{#a}'.repeat(4) + '{/a}'.repeat(4))), { limits: { maxSectionDepth: 3 } }), 'TV_E_LIMIT_EXCEEDED', { limit: 'maxSectionDepth' });
    const error = expectDvError(() => inspect(docx(p(`{${'a'.repeat(20)}}`)), { limits: { maxTagLength: 10 } }), 'TV_E_TEMPLATE_INVALID');
    expect(error.errors[0]).toMatchObject({ code: 'TV_E_LIMIT_EXCEEDED', details: { limit: 'maxTagLength' } });
    expect(inspect(docx(p('{#a}'.repeat(3) + '{/a}'.repeat(3))), { limits: { maxSectionDepth: 3 } }).sections).toHaveLength(1);
  });

  it('rejects input that is not bytes and unknown options', () => {
    expectDvError(() => inspect('offer.docx' as unknown as Uint8Array), 'TV_E_INVALID_INPUT');
    expectDvError(() => inspect(docx(p('x')), { limit: {} } as never), 'TV_E_INVALID_OPTION');
    expectDvError(() => inspect(docx(p('x')), { limits: { maxTag: 1 } } as never), 'TV_E_INVALID_OPTION');
    expectDvError(() => inspect(docx(p('x')), null as never), 'TV_E_INVALID_OPTION');
  });

  it('rejects files that are not templates', () => {
    expectDvError(() => inspect(new Uint8Array([1, 2, 3])), 'TV_E_NOT_ZIP');
    const packageRels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
    expectDvError(() => inspect(buildDocx({ body: '', packageRels })), 'TV_E_PART_MISSING');
    const other = buildDocx({ body: '', root: 'x:thing xmlns:x="urn:example"' });
    expect(expectDvError(() => inspect(other), 'TV_E_NOT_SUPPORTED').message).toMatch(/not a Word document, a PowerPoint presentation or an Excel workbook/);
  });

  it('accepts a Node.js Buffer, which is a Uint8Array', () => {
    const bytes = docx(p('{a}'));
    const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(raws(inspect(view))).toEqual(['{a}']);
  });
});
