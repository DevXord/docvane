// render: values, sections, places of repetition, formatting, errors (docs/syntax.md, "Rendering").
import { describe, expect, it } from 'vitest';
import { render, type DvError } from 'docvane';
import { buildDocx, p, run, table, textBox } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { bodyText, partXml, storyTexts } from '../helpers/read-docx';

const doc = (body: string, extra: Partial<Parameters<typeof buildDocx>[0]> = {}): Uint8Array => buildDocx({ body, ...extra });
const text = (body: string, data: unknown, options = {}): string[] => bodyText(render(doc(body), data, options));

describe('render: values', () => {
  it('fills values split over runs, keeping the text around them', () => {
    expect(text(p('Dear {cust', run('omer.na', '<w:b/>'), 'me}, total {total}.'), { customer: { name: 'Anna' }, total: 12 })).toEqual(['Dear Anna, total 12.']);
  });

  it('writes the value with the run properties of the tag’s first character and keeps the other runs as they were', () => {
    const body = p(run('Before ', '<w:i/>'), run('{na', '<w:b/>'), run('me}', '<w:u w:val="single"/>'), run(' after', '<w:i/>'));
    const xml = partXml(render(doc(body), { name: 'Anna' }));
    expect(xml).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Before </w:t></w:r>');
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>Anna</w:t></w:r>');
    expect(xml).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> after</w:t></w:r>');
    expect(xml).not.toContain('w:u ');
  });

  it('escapes every value, so data cannot add XML', () => {
    const evil = '</w:t></w:r><w:r><w:t>injected & <b>';
    const bytes = render(doc(p('{x}')), { x: evil });
    expect(bodyText(bytes)).toEqual([evil]);
    expect(partXml(bytes)).toContain('&lt;/w:t&gt;&lt;/w:r&gt;');
  });

  it('turns line breaks and tabs into w:br and w:tab, and keeps spaces at the ends', () => {
    const bytes = render(doc(p('[{x}]')), { x: ' a\tb\nc\r\nd ' });
    expect(bodyText(bytes)).toEqual(['[ a\tb\nc\nd ]']);
    expect(partXml(bytes)).toContain('<w:t xml:space="preserve"> a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:br/><w:t xml:space="preserve">d </w:t>');
  });

  it('writes numbers, booleans and null, and formats with formatters', () => {
    expect(text(p('{a} {b} {c}|{d | upper} {e | default("-")}'), { a: 1.5, b: false, c: null, d: 'ok', e: '' })).toEqual(['1.5 false |OK -']);
  });

  it('evaluates expressions', () => {
    expect(text(p('{a > 1} {a == 2 && b} {!b} {c || "none"}'), { a: 2, b: true, c: '' })).toEqual(['true true false none']);
  });

  it('fills tags in headers, footers, footnotes, endnotes, tables and text boxes', () => {
    const bytes = render(doc(table([[p('{a}')]]) + p(textBox(p('{b}'))), { headers: [p('{h}')], footers: [p('{f}')], footnotes: [p('{n}')], endnotes: [p('{e}')] }), { a: 'A', b: 'B', h: 'H', f: 'F', n: 'N', e: 'E' });
    expect(storyTexts(bytes)).toEqual({
      '/word/document.xml': ['A', '\ufffc', 'B'],
      '/word/header1.xml': ['H'],
      '/word/footer1.xml': ['F'],
      '/word/footnotes.xml': ['N'],
      '/word/endnotes.xml': ['E'],
    });
    // The other form of the text box (mc:Fallback) would still show the tag, so it is left out.
    expect(partXml(bytes)).not.toContain('mc:Fallback');
  });

  it('leaves parts without tags byte for byte as they were', () => {
    const template = doc(p('{a}'), { headers: [p('static')] });
    expect(partXml(render(template, { a: 1 }), '/word/header1.xml')).toBe(partXml(template, '/word/header1.xml'));
  });
});

describe('render: sections', () => {
  it('repeats content within a paragraph', () => {
    expect(text(p('Tags: {#tags}{.}, {/tags}end'), { tags: ['a', 'b', 'c'] })).toEqual(['Tags: a, b, c, end']);
  });

  it('repeats paragraphs between tags that are alone in their paragraphs, and removes those paragraphs', () => {
    const body = p('Items:') + p('{#items}') + p('- {name}: {price}') + p('  note') + p('{/items}') + p('End');
    expect(text(body, { items: [{ name: 'Desk', price: 100 }, { name: 'Chair', price: 50 }] })).toEqual(['Items:', '- Desk: 100', '  note', '- Chair: 50', '  note', 'End']);
  });

  it('repeats a table row when the section opens and closes in cells of that row', () => {
    const body = table([[p('Name'), p('Price')], [p('{#items}{name}'), p('{price}{/items}')], [p('Total'), p('{total}')]]);
    expect(text(body, { items: [{ name: 'A', price: 1 }, { name: 'B', price: 2 }], total: 3 })).toEqual(['Name', 'Price', 'A', '1', 'B', '2', 'Total', '3']);
  });

  it('repeats a range of table rows', () => {
    const body = table([[p('{#people}{name}')], [p('{email}{/people}')], [p('end')]]);
    expect(text(body, { people: [{ name: 'A', email: 'a@x' }, { name: 'B', email: 'b@x' }] })).toEqual(['A', 'a@x', 'B', 'b@x', 'end']);
  });

  it('nests loops and looks names up in outer items', () => {
    const body = p('{#orders}') + p('Order {number} for {customer}') + table([[p('{#lines}{product} ({customer})'), p('{qty}{/lines}')]]) + p('{/orders}');
    const data = { customer: 'Anna', orders: [{ number: 1, lines: [{ product: 'X', qty: 2 }] }, { number: 2, customer: 'Bob', lines: [{ product: 'Y', qty: 1 }, { product: 'Z', qty: 3 }] }] };
    expect(text(body, data)).toEqual(['Order 1 for Anna', 'X (Anna)', '2', 'Order 2 for Bob', 'Y (Bob)', '1', 'Z (Bob)', '3']);
  });

  it('shows conditions and inverted sections by the truth of the value', () => {
    const body = p('{#isVip}VIP {/isVip}{^isVip}Regular {/isVip}{#items}has items{/items}{^items}no items{/items}');
    expect(text(body, { isVip: true, items: [] })).toEqual(['VIP no items']);
    expect(text(body, { isVip: 0, items: [1] })).toEqual(['Regular has items']);
    expect(text(body, { items: [] })).toEqual(['Regular no items']);
  });

  it('uses an object as the scope of its section', () => {
    expect(text(p('{#customer}{name}, {city}{/customer}'), { customer: { name: 'Anna', city: 'Kraków' } })).toEqual(['Anna, Kraków']);
  });

  it('shows the content of a section over an expression once, in the same scope', () => {
    expect(text(p('{#total > 100}Free delivery for {name}.{/total > 100}'), { total: 150, name: 'Anna' })).toEqual(['Free delivery for Anna.']);
    expect(text(p('{#total > 100}Free delivery.{/total > 100}'), { total: 50 })).toEqual(['']);
  });

  it('leaves bookmarks and comment ranges in the first copy only', () => {
    const body = p('{#items}') + p('<w:bookmarkStart w:id="1" w:name="mark"/>', '{.}', '<w:bookmarkEnd w:id="1"/>') + p('{/items}');
    const xml = partXml(render(doc(body), { items: ['a', 'b', 'c'] }));
    expect(xml.match(/w:bookmarkStart/g)).toHaveLength(1);
    expect(xml.match(/w:bookmarkEnd/g)).toHaveLength(1);
  });

  it('refuses sections whose tags are not placed so that the content to repeat is clear', () => {
    const outside = expectDvError(() => render(doc(p('Items: {#items}') + p('{name}') + p('{/items}')), { items: [] }), 'DV_E_TEMPLATE_INVALID');
    expect(outside.errors.map((e) => e.code)).toEqual(['DV_E_SECTION_PLACEMENT']);
    const crossing = expectDvError(() => render(doc(table([[p('{#items}')]]) + p('{/items}')), { items: [] }), 'DV_E_TEMPLATE_INVALID');
    expect(crossing.errors.map((e) => e.code)).toEqual(['DV_E_SECTION_PLACEMENT']);
  });
});

describe('render: data problems', () => {
  it('lists every missing field and invalid value at once, with places and hints', () => {
    const body = p('{customer.name}') + p('{#items}{nme}{/items}') + p('{total | number}') + p('{when | date}') + p('{obj}') + p('{x == 1}');
    const error = expectDvError(() => render(doc(body), { customer: {}, items: [{ name: 'A' }], total: '12', when: 'yesterday', obj: { a: 1 } }), 'DV_E_DATA_INVALID');
    expect(error.errors.map((e: DvError) => [e.code, e.location.paragraph, e.details['path'] ?? null])).toEqual([
      ['DV_E_MISSING_FIELD', 1, 'customer.name'],
      ['DV_E_MISSING_FIELD', 2, 'nme'],
      ['DV_E_INVALID_VALUE', 3, null],
      ['DV_E_INVALID_VALUE', 4, null],
      ['DV_E_INVALID_VALUE', 5, null],
      ['DV_E_MISSING_FIELD', 6, 'x'],
    ]);
    expect(error.errors[1]?.hint).toMatch(/Did you mean "name"\?/);
    for (const e of error.errors) expect(e.hint.length).toBeGreaterThan(0);
  });

  it('shows nothing for missing values with { missing: "empty" }', () => {
    expect(text(p('[{a}][{b.c}]'), {}, { missing: 'empty' })).toEqual(['[][]']);
  });

  it('treats a missing condition as false, but a missing list as an error', () => {
    expect(text(p('{#vip}VIP{/vip}{^vip}not VIP{/vip}'), {})).toEqual(['not VIP']);
    expectDvError(() => render(doc(p('{#items}{name}{/items}')), {}), 'DV_E_DATA_INVALID');
  });

  it('refuses characters that a document cannot hold', () => {
    const error = expectDvError(() => render(doc(p('{x}')), { x: 'a\u0001b' }), 'DV_E_DATA_INVALID');
    expect(error.errors[0]?.message).toMatch(/U\+0001 at position 2/);
  });

  it('reports template problems before looking at the data', () => {
    expectDvError(() => render(doc(p('{a')), {}), 'DV_E_TEMPLATE_INVALID');
  });

  it('validates its options', () => {
    expectDvError(() => render(doc(p('x')), {}, { locale: 'not a locale!' }), 'DV_E_INVALID_OPTION');
    expectDvError(() => render(doc(p('x')), {}, { timeZone: 'Mars/Base' }), 'DV_E_INVALID_OPTION');
    expectDvError(() => render(doc(p('x')), {}, { missing: 'skip' } as never), 'DV_E_INVALID_OPTION');
    expectDvError(() => render(doc(p('x')), {}, { colour: 1 } as never), 'DV_E_INVALID_OPTION');
    expectDvError(() => render('x' as never, {}), 'DV_E_INVALID_INPUT');
  });
});

describe('render: limits', () => {
  it('limits the number of repetitions', () => {
    expectDvError(() => render(doc(p('{#a}{#b}x{/b}{/a}')), { a: Array(20).fill({ b: Array(20).fill(1) }) }, { limits: { maxIterations: 100 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxIterations' });
    expect(text(p('{#a}x{/a}'), { a: Array(100).fill(1) }, { limits: { maxIterations: 100 } })[0]).toHaveLength(100);
  });

  it('limits the size of the result while it is built', () => {
    expectDvError(() => render(doc(p('{#a}{x}{/a}')), { a: Array(1000).fill({ x: 'y'.repeat(1000) }) }, { limits: { maxOutputBytes: 100_000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxOutputBytes' });
  });

  it('collects at most maxErrors data problems', () => {
    const error = expectDvError(() => render(doc(p('{#a}{x}{/a}')), { a: Array(50).fill({}) }, { limits: { maxErrors: 5 } }), 'DV_E_DATA_INVALID');
    expect(error.errors).toHaveLength(5);
  });
});
