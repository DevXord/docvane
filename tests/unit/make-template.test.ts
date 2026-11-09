// makeTemplate (D-079): sample text of a finished document becomes tags, with its formatting kept.
// Matches are found in one paragraph or cell, across runs, before anything is replaced; text that
// is not found, overlaps and a result that is not a valid template are errors.
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, inspect, makeTemplate, render, TvError } from 'tplvane';
import { buildDocx, p, run, table, textBox } from '../helpers/docx';
import { bodyText, partXml, storyTexts } from '../helpers/read-docx';
import { ap, ar, buildPptx, sp } from '../helpers/pptx';
import { slideTexts } from '../helpers/read-pptx';
import { buildXlsx, readXlsx } from '../helpers/xlsx';
import { expectDvError } from '../helpers/expect-error';
import { readWorkbook } from 'xlvane';

const offer = (): Uint8Array =>
  buildDocx({
    body: p('Offer for ', run('Jan', '<w:b/>'), run(' Kow', '<w:b/>'), run('alski', '<w:i/>'), ', ACME') + table([[p('Laptop'), p('4 500,00 zł')]]) + p('Prepared by Anna. Anna will call.'),
    headers: [p('ACME offer')],
    footers: [p('ACME')],
  });

describe('makeTemplate: documents', () => {
  it('turns text split over runs into one tag that keeps the formatting of its first run', () => {
    const result = makeTemplate(offer(), [{ find: 'Jan Kowalski', tag: 'customer.name' }]);
    expect(bodyText(result.document)[0]).toBe('Offer for {customer.name}, ACME');
    const xml = partXml(result.document);
    expect(xml).toMatch(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>\{customer\.name\}<\/w:t><\/w:r>/);
    expect(xml).not.toContain('alski');
    expect(result.replacements).toEqual([{ find: 'Jan Kowalski', count: 1, locations: [expect.objectContaining({ story: 'body', paragraph: 1, character: 11 })] }]);
    expect(Object.keys(result.schema.properties ?? {})).toEqual(['customer']);
  });

  it('replaces every occurrence in the body, tables, headers and footers by default', () => {
    const result = makeTemplate(offer(), [{ find: 'ACME', tag: 'company' }]);
    const texts = storyTexts(result.document);
    expect(texts['/word/document.xml']?.[0]).toBe('Offer for Jan Kowalski, {company}');
    expect(texts['/word/header1.xml']).toEqual(['{company} offer']);
    expect(texts['/word/footer1.xml']).toEqual(['{company}']);
    expect(result.replacements[0]?.count).toBe(3);
  });

  it('limits an entry to parts with `where` and to one match with `occurrence`', () => {
    const footer = makeTemplate(offer(), [{ find: 'ACME', tag: 'company', where: 'footer' }]);
    expect(storyTexts(footer.document)['/word/header1.xml']).toEqual(['ACME offer']);
    expect(storyTexts(footer.document)['/word/footer1.xml']).toEqual(['{company}']);
    const second = makeTemplate(offer(), [{ find: 'Anna', tag: 'caller', occurrence: 2 }]);
    expect(bodyText(second.document).at(-1)).toBe('Prepared by Anna. {caller} will call.');
  });

  it('writes raw template text with `with`, such as the tags of a loop over a table row', () => {
    const result = makeTemplate(offer(), [
      { find: 'Laptop', with: '{#items}{name}' },
      { find: '4 500,00 zł', with: '{price | currency("PLN")}{/items}' },
    ]);
    const out = render(result.document, { items: [{ name: 'Desk', price: 10 }, { name: 'Chair', price: 5 }] }, { locale: 'pl-PL' });
    // pl-PL writes a no-break space before the currency.
    expect(bodyText(out).slice(1, 5).map((t) => t.replace(/\u00a0/g, ' '))).toEqual(['Desk', '10,00 zł', 'Chair', '5,00 zł']);
    expect(result.schema.properties?.['items']).toMatchObject({ type: 'array' });
  });

  it('finds every match on the original, so the order of entries does not matter', () => {
    const a = makeTemplate(offer(), [{ find: 'Anna', tag: 'author' }, { find: 'Prepared by', tag: 'label' }]);
    const b = makeTemplate(offer(), [{ find: 'Prepared by', tag: 'label' }, { find: 'Anna', tag: 'author' }]);
    expect(bodyText(a.document)).toEqual(bodyText(b.document));
    // The text a replacement writes is not searched again.
    const c = makeTemplate(offer(), [{ find: 'ACME', tag: 'ACME' }]);
    expect(c.replacements[0]?.count).toBe(3);
  });

  it('keeps spaces at the edges and escapes what it writes', () => {
    const result = makeTemplate(buildDocx({ body: p('a  & b') }), [{ find: '  & ', with: ' {x} & ' }]);
    expect(bodyText(result.document)).toEqual(['a {x} & b']);
    expect(partXml(result.document)).toContain('xml:space="preserve"> {x} &amp; </w:t>');
  });

  it('replaces text in a text box and drops the other form of the box, as render does', () => {
    const result = makeTemplate(buildDocx({ body: p(textBox(p('By Anna'))) }), [{ find: 'Anna', tag: 'author' }]);
    expect(inspect(result.document).tags.map((t) => t.raw)).toEqual(['{author}']);
    expect(partXml(result.document)).not.toContain('By Anna');
  });

  it('a filled result reads as the sample again (round trip)', () => {
    const template = makeTemplate(offer(), [
      { find: 'Jan Kowalski', tag: 'customer.name' },
      { find: 'ACME', tag: 'company' },
    ]).document;
    const out = render(template, { customer: { name: 'Jan Kowalski' }, company: 'ACME' });
    expect(storyTexts(out)).toEqual(storyTexts(offer()));
  });
});

describe('makeTemplate: presentations and workbooks', () => {
  it('replaces text in shapes and notes of slides', () => {
    const deck = buildPptx([{ shapes: sp('Title', ap('Offer for ', ar('Jan', 'b="1"'), ar(' Kowalski', 'b="1"'))), notes: sp('Notes', ap('Call Jan Kowalski')) }]);
    const result = makeTemplate(deck, [{ find: 'Jan Kowalski', tag: 'name' }]);
    expect(slideTexts(result.document)).toEqual([{ slide: ['Offer for {name}'], notes: ['Call {name}'] }]);
    const notes = makeTemplate(deck, [{ find: 'Jan Kowalski', tag: 'name', where: 'slide 1 notes' }]);
    expect(slideTexts(notes.document)).toEqual([{ slide: ['Offer for Jan Kowalski'], notes: ['Call {name}'] }]);
  });

  it('keeps the runs of rich text in a cell; the tag takes the font of the run where its match starts', () => {
    const book = buildXlsx({ S: { A1: 'x' } }, (wb) => wb.getSheet('S').set('A1', { richText: [{ text: 'Dear ' }, { text: 'Jan', font: { bold: true } }, { text: ' Kowalski!', font: { italic: true } }] }));
    const result = makeTemplate(book, [{ find: 'Jan Kowalski', tag: 'name' }]);
    const cell = readWorkbook(result.document).sheets[0]?.cell('A1');
    expect(cell?.richText).toEqual([{ text: 'Dear ' }, { text: '{name}', font: expect.objectContaining({ bold: true }) }, { text: '!', font: expect.objectContaining({ italic: true }) }]);
  });

  it('replaces text in text cells of workbooks, and leaves numbers and formulas alone', () => {
    const book = buildXlsx({ Report: { A1: 'Report for May 2026', B2: 12, C2: { formula: 'B2*2' }, D2: 'May 2026' } });
    const result = makeTemplate(book, [{ find: 'May 2026', tag: 'month' }]);
    expect(readXlsx(result.document)['Report']).toEqual({ A1: 'Report for {month}', B2: 12, C2: { formula: 'B2*2' }, D2: '{month}' });
    expect(result.replacements[0]?.locations.map((l: { cell?: string }) => l.cell)).toEqual(['A1', 'D2']);
    expectDvError(() => makeTemplate(book, [{ find: '12', tag: 'qty' }]), 'TV_E_TEXT_NOT_FOUND');
  });
});

describe('makeTemplate: problems', () => {
  it('reports every entry that is not found in one error, with a hint, and writes nothing', () => {
    const error = expectDvError(() => makeTemplate(offer(), [{ find: 'Ewa', tag: 'a' }, { find: 'ACME', tag: 'b' }, { find: 'Anna', tag: 'c', occurrence: 3 }]), 'TV_E_TEXT_NOT_FOUND');
    expect(error.errors.map((e) => [e.code, e.details['find']])).toEqual([
      ['TV_E_TEXT_NOT_FOUND', 'Ewa'],
      ['TV_E_TEXT_NOT_FOUND', 'Anna'],
    ]);
    expect(error.hint).toMatch(/preview/);
    expect(ERROR_CODES).toContain('TV_E_TEXT_NOT_FOUND');
  });

  it('says when the text is there with no-break spaces, which preview shows as spaces', () => {
    const error = expectDvError(() => makeTemplate(buildDocx({ body: p('Price: PLN\u00a0349.99') }), [{ find: 'PLN 349.99', tag: 'price' }]), 'TV_E_TEXT_NOT_FOUND');
    expect(error.errors[0]?.hint).toMatch(/no-break space/);
    expect(error.errors[0]?.details['nearly']).toBe(true);
    expect(makeTemplate(buildDocx({ body: p('Price: PLN\u00a0349.99') }), [{ find: 'PLN\u00a0349.99', tag: 'price' }]).replacements[0]?.count).toBe(1);
  });

  it('does not match across paragraphs', () => {
    expectDvError(() => makeTemplate(buildDocx({ body: p('Jan') + p('Kowalski') }), [{ find: 'Jan Kowalski', tag: 'x' }]), 'TV_E_TEXT_NOT_FOUND');
  });

  it('refuses matches that overlap each other or a tag already in the document', () => {
    expectDvError(() => makeTemplate(offer(), [{ find: 'Jan Kowalski', tag: 'a' }, { find: 'Kowalski, ACME', tag: 'b' }]), 'TV_E_REPLACEMENT_OVERLAP');
    expectDvError(() => makeTemplate(buildDocx({ body: p('Dear {name}, welcome') }), [{ find: 'name}, wel', tag: 'x' }]), 'TV_E_REPLACEMENT_OVERLAP');
    expect(ERROR_CODES).toContain('TV_E_REPLACEMENT_OVERLAP');
  });

  it('checks the entries: one of tag and with, valid tags, a non-empty find', () => {
    const doc = offer();
    for (const entry of [{ find: 'ACME' }, { find: 'ACME', tag: 'a', with: '{a}' }, { find: '', tag: 'a' }, { find: 'ACME', tag: 'a', occurrence: 0 }, { find: 'ACME', tag: 'a', where: 3 }]) {
      expectDvError(() => makeTemplate(doc, [entry] as never), 'TV_E_INVALID_OPTION');
    }
    expectDvError(() => makeTemplate(doc, 'ACME' as never), 'TV_E_INVALID_OPTION');
    expectDvError(() => makeTemplate(doc, [{ find: 'ACME', tag: 'a +' }]), 'TV_E_TAG_SYNTAX');
    expectDvError(() => makeTemplate(doc, [{ find: 'ACME', tag: 'constructor' }]), 'TV_E_TAG_FORBIDDEN_NAME');
    expectDvError(() => makeTemplate(doc, [{ find: 'ACME', with: '{a' }]), 'TV_E_TAG_UNCLOSED');
  });

  it('refuses a result that is not a valid template, with the problems of inspect', () => {
    const error = expectDvError(() => makeTemplate(offer(), [{ find: 'Laptop', with: '{#items}{name}' }]), 'TV_E_TEMPLATE_INVALID');
    expect(error.errors.map((e) => e.code)).toContain('TV_E_SECTION_UNCLOSED');
  });

  it('follows other delimiters', () => {
    const result = makeTemplate(offer(), [{ find: 'ACME', tag: 'company' }], { delimiters: { start: '[[', end: ']]' } });
    expect(bodyText(result.document)[0]).toBe('Offer for Jan Kowalski, [[company]]');
    expect(inspect(result.document, { delimiters: { start: '[[', end: ']]' } }).tags.map((t) => t.raw)).toContain('[[company]]');
  });

  it('enforces limits: the number of tags it writes', () => {
    const many = buildDocx({ body: p('x '.repeat(50)) });
    expectDvError(() => makeTemplate(many, [{ find: 'x', tag: 'a' }], { limits: { maxTags: 10 } }), 'TV_E_LIMIT_EXCEEDED');
  });

  it('rejects input that is not bytes, and unknown options', () => {
    expectDvError(() => makeTemplate('offer.docx' as never, []), 'TV_E_INVALID_INPUT');
    expectDvError(() => makeTemplate(offer(), [], { colour: 1 } as never), 'TV_E_INVALID_OPTION');
    expect(() => makeTemplate(new Uint8Array([1, 2, 3]), [])).toThrow(TvError);
  });
});
