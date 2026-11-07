// Regression tests of the third review before 1.0.0 (D-071): functional tests, a code review,
// penetration tests and interoperability tests. Each test reproduces a verified finding.
import { describe, expect, it } from 'vitest';
import { inspect, preview, render, renderAsync, validate } from 'docvane';
import { buildXlsx, readXlsx } from '../helpers/xlsx';
import { buildDocx, p, table } from '../helpers/docx';
import { ap, buildPptx, ptable, sp } from '../helpers/pptx';
import { partXml } from '../helpers/read-docx';
import { pptxPart } from '../helpers/read-pptx';
import { expectDvError } from '../helpers/expect-error';
import { openZip } from '../../packages/docvane/src/zip/reader';
import { writeZip } from '../../packages/docvane/src/zip/writer';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';
import { parseXml } from '../../packages/docvane/src/xml/parser';
import { buildZip } from '../helpers/raw-zip';

/** A copy of a package with one part's text changed. */
function edit(bytes: Uint8Array, name: string, change: (text: string) => string): Uint8Array {
  const zip = openZip(bytes, DEFAULT_LIMITS);
  return writeZip(
    zip.entries.map((e) => {
      const data = zip.read(e);
      return { name: e.name, data: e.name === name ? new TextEncoder().encode(change(new TextDecoder().decode(data))) : data };
    }),
  );
}

const zipText = (bytes: Uint8Array, name: string): string => new TextDecoder().decode(openZip(bytes, DEFAULT_LIMITS).read(name));
const wellFormed = (xml: string): void => {
  parseXml(xml, { start() {}, end() {}, text() {} } as never, { part: 'test', limits: DEFAULT_LIMITS } as never);
};

describe('review 3: limits', () => {
  it('bounds long chains of && and ||, whatever maxTagLength says', () => {
    const chain = `{${Array.from({ length: 20_000 }, (_, i) => `a${String(i)}`).join(' || ')}}`;
    const error = expectDvError(() => inspect(buildDocx({ body: p(chain) }), { limits: { maxTagLength: Infinity } }), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors[0]?.code).toBe('DV_E_LIMIT_EXCEEDED');
  });

  it('keeps "did you mean" hints cheap when the data has many fields', () => {
    const data: Record<string, unknown> = { items: Array.from({ length: 2000 }, () => ({})) };
    for (let i = 0; i < 20_000; i++) data[`k${String(i)}`] = i;
    const started = Date.now();
    const error = expectDvError(() => render(buildDocx({ body: p('{#items}{zzz}{/items}') }), data), 'DV_E_DATA_INVALID');
    expect(error.errors).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('counts a part read twice once against maxTotalBytes', () => {
    const template = buildDocx({ body: p('{a}') + p('x'.repeat(200_000)) });
    const total = openZip(template, DEFAULT_LIMITS).entries.reduce((n, e) => n + e.uncompressedSize, 0);
    const limits = { maxTotalBytes: Math.ceil(total * 1.2) };
    expect(inspect(template, { limits }).tags).toHaveLength(1);
    expect(render(template, { a: 'b' }, { limits }).length).toBeGreaterThan(0);
  });

  it('counts the text of preview against maxOutputBytes, also for cells in the last column', () => {
    const sheet: Record<string, string> = {};
    for (let r = 1; r <= 50; r++) sheet[`XFD${String(r)}`] = 'x';
    expectDvError(() => preview(buildXlsx({ S: sheet }), { limits: { maxOutputBytes: 100_000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxOutputBytes' });
  });

  it('counts the elements of a part against maxXmlTreeElements', () => {
    const template = buildDocx({ body: p('{a}') + '<w:p/>'.repeat(5000) });
    expectDvError(() => inspect(template, { limits: { maxXmlTreeElements: 2000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxXmlTreeElements' });
  });

  it('counts Markdown output against maxOutputBytes while it is built', () => {
    const started = Date.now();
    expectDvError(() => render(buildDocx({ body: p('{~md}') }), { md: 'a*'.repeat(200_000) }, { limits: { maxOutputBytes: 100_000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxOutputBytes' });
    expectDvError(() => render(buildPptx([{ shapes: sp('T', ap('{~md}')) }]), { md: 'a*'.repeat(200_000) }, { limits: { maxOutputBytes: 100_000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxOutputBytes' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reads a header named twice in different case once', () => {
    const template = edit(buildDocx({ body: p('x'), headers: [p('{h}')] }), 'word/_rels/document.xml.rels', (t) =>
      t.replace('</Relationships>', '<Relationship Id="rIdDup" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="HEADER1.xml"/></Relationships>'),
    );
    expect(inspect(template).tags.map((t) => t.raw)).toEqual(['{h}']);
  });
});

describe('review 3: containers keep a paragraph', () => {
  it('puts an empty paragraph back in a cell, a header and a shape left without one', () => {
    const cell = partXml(render(buildDocx({ body: table([[p('{#items}') + p('{name}') + p('{/items}'), p('x')]]) }), { items: [] }));
    for (const tc of cell.match(/<w:tc>.*?<\/w:tc>/g) ?? []) expect(tc).toMatch(/<w:p[ >/]/);
    const md = partXml(render(buildDocx({ body: table([[p('{~md}'), p('x')]]) }), { md: '' }));
    for (const tc of md.match(/<w:tc>.*?<\/w:tc>/g) ?? []) expect(tc).toMatch(/<w:p[ >/]/);
    const header = partXml(render(buildDocx({ body: p('x'), headers: [p('{#show}') + p('secret') + p('{/show}')] }), { show: false }), '/word/header1.xml');
    expect(header).toMatch(/<w:p[ >/]/);
    expect(header).not.toContain('secret');
    const slide = pptxPart(render(buildPptx([{ shapes: sp('T', ap('{~md}')) }]), { md: '' }), '/ppt/slides/slide1.xml').xml;
    expect(slide).toMatch(/<p:txBody>.*<a:p[ >/].*<\/p:txBody>/);
  });
});

describe('review 3: slides', () => {
  it('gives a copied slide its own notes when the relationship target is absolute', () => {
    const template = edit(buildPptx([{ shapes: sp('s', ap('{#items}')) + sp('v', ap('{name}')) + sp('e', ap('{/items}')), notes: sp('n', ap('note {name}')) }]), 'ppt/slides/_rels/slide1.xml.rels', (t) =>
      t.replace('../notesSlides/notesSlide1.xml', '/ppt/notesSlides/notesSlide1.xml'),
    );
    const out = render(template, { items: [{ name: 'A' }, { name: 'B' }] });
    const zip = openZip(out, DEFAULT_LIMITS);
    const copyRels = zip.entries.filter((e) => /ppt\/slides\/_rels\/docvane\d+\.xml\.rels/.test(e.name)).map((e) => new TextDecoder().decode(zip.read(e)));
    expect(copyRels).toHaveLength(1);
    expect(copyRels[0]).not.toContain('notesSlide1.xml');
  });

  it('reports an image shape without its own position as a template problem, whatever the data', () => {
    const template = edit(buildPptx([{ shapes: sp('P', ap('{%img}')) }]), 'ppt/slides/slide1.xml', (t) => t.replace(/<a:xfrm>.*?<\/a:xfrm>/, ''));
    for (const img of [null, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC']) {
      const error = expectDvError(() => render(template, { img }), 'DV_E_TEMPLATE_INVALID');
      expect(error.errors[0]?.code).toBe('DV_E_TAG_PLACEMENT');
    }
  });

  it('reports slide sections of one level that share a slide', () => {
    for (const template of [
      buildPptx([{ shapes: sp('a', ap('{#a}')) + sp('b', ap('{/a}')) + sp('c', ap('{#b}')) + sp('v', ap('{name}')) }, { shapes: sp('e', ap('{/b}')) }]),
      buildPptx([{ shapes: sp('a', ap('{#a}')) }, { shapes: sp('b', ap('{/a}')) + sp('c', ap('{#b}')) }, { shapes: sp('e', ap('{/b}')) }]),
    ]) {
      const error = expectDvError(() => render(template, { a: [{}], b: [{ name: 'x' }], name: 'root' }), 'DV_E_TEMPLATE_INVALID');
      expect(error.errors.map((e) => e.code)).toContain('DV_E_SECTION_PLACEMENT');
    }
  });

  it('refuses to repeat a slide with a chart or comments, which copies would share', () => {
    const rels = ['<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>'];
    const template = buildPptx([{ shapes: sp('s', ap('{#items}')) + sp('v', ap('{name}')) + sp('e', ap('{/items}')), rels }], { 'ppt/charts/chart1.xml': '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' });
    expectDvError(() => render(template, { items: [{ name: 'a' }, { name: 'b' }] }), 'DV_E_NOT_SUPPORTED');
    expect(render(template, { items: [{ name: 'a' }] }).length).toBeGreaterThan(0);
  });

  it('keeps "$" patterns of the slide list as text', () => {
    const template = edit(buildPptx([{ shapes: sp('s', ap('{#items}')) + sp('v', ap('{name}')) + sp('e', ap('{/items}')) }]), 'ppt/presentation.xml', (t) =>
      t.replace('<p:sldId id="256" r:id="rId10"/>', () => `<p:sldId id="256" r:id="rId10"><p:extLst><p:ext uri="{X}"><x:y xmlns:x="urn:x" v="cost $' and $&amp; total"/></p:ext></p:extLst></p:sldId>`),
    );
    const xml = zipText(render(template, { items: [{ name: 'A' }, { name: 'B' }] }), 'ppt/presentation.xml');
    wellFormed(xml);
    expect(xml).toContain("cost $' and $&amp; total");
  });

  it('does not write an attribute twice when the template quotes it with apostrophes', () => {
    const template = edit(buildPptx([{ shapes: sp('T', ap('{~md}')) }]), 'ppt/slides/slide1.xml', (t) => t.replace(/<a:rPr([^>]*?)(\/?)>/, "<a:rPr$1 b='0'$2>"));
    const xml = pptxPart(render(template, { md: '**bold** text' }), '/ppt/slides/slide1.xml').xml;
    wellFormed(xml);
  });
});

describe('review 3: package parts written from their parsed form', () => {
  const slides = (): Uint8Array => buildPptx([{ shapes: sp('s', ap('{#show}')) + sp('x', ap('secret')) + sp('e', ap('{/show}')) }, { shapes: sp('t', ap('kept')) }]);

  it('removes the relationship of a removed slide however it is written', () => {
    for (const style of ['end-tag', 'apostrophes', 'comment'] as const) {
      const template = edit(slides(), 'ppt/_rels/presentation.xml.rels', (t) => {
        if (style === 'end-tag') return t.replace(/(<Relationship [^>]*Target="slides\/slide1\.xml")\/>/, '$1></Relationship>');
        if (style === 'apostrophes') return t.replace(/<Relationship ([^>]*Target="slides\/slide1\.xml"[^>]*)\/>/, (_, a: string) => `<Relationship ${a.replace(/"/g, "'")}/>`);
        return t.replace('</Relationships>', '<!-- </Relationships> --></Relationships>');
      });
      const out = render(template, { show: false });
      const rels = zipText(out, 'ppt/_rels/presentation.xml.rels');
      wellFormed(rels);
      expect(rels, style).not.toMatch(/slides\/slide1\.xml/);
      const names = openZip(out, DEFAULT_LIMITS).entries.map((e) => e.name);
      expect(names).not.toContain('ppt/slides/slide1.xml');
      const types = zipText(out, '[Content_Types].xml');
      expect(types).not.toContain('/ppt/slides/slide1.xml');
      expect(types).not.toContain('/ppt/slides/_rels/slide1.xml.rels');
    }
  });
});

describe('review 3: renderAsync', () => {
  it('reports problems of the data before fetching any image, and checks each image as it arrives', async () => {
    let calls = 0;
    const fetchImage = (): Promise<Uint8Array> => {
      calls++;
      return Promise.resolve(new Uint8Array(1000));
    };
    await expect(renderAsync(buildDocx({ body: p('{%logo}{name}') }), { logo: 'https://x.example/a.png' }, { fetchImage })).rejects.toMatchObject({ code: 'DV_E_DATA_INVALID' });
    expect(calls).toBe(0);
    await expect(renderAsync(buildDocx({ body: p('{%logo}') }), { logo: 'https://x.example/a.png' }, { fetchImage, limits: { maxImageBytes: 100 } })).rejects.toMatchObject({ code: 'DV_E_LIMIT_EXCEEDED' });
  });
});

describe('review 3: ZIP items that are not parts', () => {
  it('leaves items that are not part names out of the result, and renders', () => {
    const zip = openZip(buildDocx({ body: p('{a}') }), DEFAULT_LIMITS);
    const stray = ['../evil.xml', 'a\\..\\b.xml', 'C:/x.xml', '/abs.txt', ' lead.txt', 'dir/./x.xml', 'ok-folder/'];
    const template = buildZip([...zip.entries.map((e) => ({ name: e.name, data: zip.read(e) })), ...stray.map((name) => ({ name, data: 'x' }))]);
    expect(inspect(template).tags).toHaveLength(1);
    const names = openZip(render(template, { a: 'b' }), DEFAULT_LIMITS).entries.map((e) => e.name);
    for (const name of stray) expect(names).not.toContain(name);
    expect(names).toContain('word/document.xml');
  });
});

describe('review 3: link addresses', () => {
  it('refuses characters that break XML or reorder the shown text', () => {
    for (const url of ['https://a.example/\uFFFE', 'https://a.example/\uFFFF', 'https://a.example/\uD800x', 'https://a.example/\u202Etxt.exe', 'https://a\u200B.example/']) {
      const error = expectDvError(() => render(buildDocx({ body: p('{u | link}') }), { u: url }), 'DV_E_DATA_INVALID');
      expect(error.errors[0]?.code, JSON.stringify(url)).toBe('DV_E_INVALID_VALUE');
    }
  });
});

describe('review 3: merged cells', () => {
  it('refuses repeated rows of a slide table with cells merged down, and copies merges in documents', () => {
    const slide = buildPptx([{ shapes: ptable('T', [[ap('{#items}{name}'), ap('{/items}')], [ap('x'), ap('y')]]).replace('<a:tc>', '<a:tc rowSpan="2">') }]);
    const error = expectDvError(() => render(slide, { items: [{ name: 'a' }, { name: 'b' }] }), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors[0]?.code).toBe('DV_E_SECTION_PLACEMENT');
    const body = table([[p('Items'), p('{#items}{name}'), p('{/items}')]]).replace('<w:tc><w:tcPr/>', '<w:tc><w:tcPr><w:vMerge/></w:tcPr>');
    expect(partXml(render(buildDocx({ body }), { items: [{ name: 'a' }, { name: 'b' }] })).match(/<w:vMerge\/>/g)).toHaveLength(2);
  });
});

describe('review 3: notes', () => {
  it('refuses a footnote in content that repeats, instead of sharing it between the copies', () => {
    const ref = '<w:r><w:footnoteReference w:id="2"/></w:r>';
    const template = buildDocx({ body: p('{#items}') + p('{name}', ref) + p('{/items}'), footnotes: [p('Note for {name}')] });
    expectDvError(() => render(template, { items: [{ name: 'a' }, { name: 'b' }], name: 'root' }), 'DV_E_NOT_SUPPORTED');
  });
});

describe('review 3: text boxes', () => {
  it('finds and fills tags in VML text boxes and in drawings without mc:AlternateContent', () => {
    const vml = `<w:r><w:pict><v:shape><v:textbox><w:txbxContent>${p('{name}')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
    const template = buildDocx({ body: p('before', vml) });
    expect(inspect(template).tags.map((t) => t.raw)).toEqual(['{name}']);
    const xml = partXml(render(template, { name: 'Anna' }));
    expect(xml).toContain('Anna');
    expect(xml).not.toContain('{name}');
  });
});

describe('review 3: messages', () => {
  it('names the content control or the shapes when a section is placed across them', () => {
    const sdt = buildDocx({ body: `<w:sdt><w:sdtContent>${p('{#items}')}</w:sdtContent></w:sdt>` + p('{name}') + p('{/items}') });
    const inControl = expectDvError(() => render(sdt, { items: [{ name: 'a' }] }), 'DV_E_TEMPLATE_INVALID');
    expect(inControl.errors[0]?.message).toMatch(/content control/);
    const shapes = buildPptx([{ shapes: sp('T', ap('{#regions}{name}')) + sp('B', ap('more {/regions}')) }]);
    const inShapes = expectDvError(() => render(shapes, { regions: [{ name: 'a' }] }), 'DV_E_TEMPLATE_INVALID');
    expect(inShapes.errors[0]?.message).toMatch(/different shapes/);
  });

  it('gives the position of a syntax problem after a start delimiter of any length', () => {
    const at = (body: string, delimiters?: { start: string; end: string }): unknown => expectDvError(() => inspect(buildDocx({ body: p(body) }), delimiters === undefined ? {} : { delimiters }), 'DV_E_TEMPLATE_INVALID').errors[0]?.details['position'];
    expect(at('[[a b]]', { start: '[[', end: ']]' })).toBe(5);
    expect(at('{a b}')).toBe(4);
  });
});

describe('review 3: values', () => {
  it('does not call a getter of a list item in validate, as render does not', () => {
    let calls = 0;
    const items: unknown[] = [];
    Object.defineProperty(items, 0, { get: () => (calls++, { name: 'x' }), enumerable: true });
    items.length = 1;
    validate(buildDocx({ body: p('{#items}{name}{/items}') }), { items });
    expect(calls).toBe(0);
  });

  it('prints no minus sign for zero, formats years below 100 and refuses impossible offsets', () => {
    const out = (body: string, data: Record<string, unknown>): string => partXml(render(buildDocx({ body: p(body) }), data)).replace(/<[^>]+>/g, '');
    expect(out('[{a | number(0)}][{b | number}][{c | currency("EUR")}][{d | percent}]', { a: -0.4, b: -0, c: -0.001, d: -0.001 })).toContain('[0][0][€0.00][0%]');
    expect(out('{x | date("yyyy-MM-dd")}', { x: '0050-03-04' })).toContain('0050-03-04');
    const error = expectDvError(() => render(buildDocx({ body: p('{x | date}') }), { x: '2026-01-01T00:30:00+25:00' }), 'DV_E_DATA_INVALID');
    expect(error.errors[0]?.code).toBe('DV_E_INVALID_VALUE');
  });

  it('reports a data URL with a base64 length atob refuses as an invalid value', () => {
    const error = expectDvError(() => render(buildDocx({ body: p('{%logo}') }), { logo: 'data:image/png;base64,AAAAA' }), 'DV_E_DATA_INVALID');
    expect(error.errors[0]?.code).toBe('DV_E_INVALID_VALUE');
  });
});

describe('review 3: workbooks', () => {
  it('keeps no text of the template in the shared strings of the result', () => {
    const template = buildXlsx({ S: { A1: '{#internal}Internal margin 42% - do not share{/internal}', A2: 'Name: {name}', A3: 'Kept text' } });
    const out = render(template, { internal: false, name: 'Anna' });
    const names = openZip(out, DEFAULT_LIMITS).entries.map((e) => e.name);
    const strings = names.includes('xl/sharedStrings.xml') ? zipText(out, 'xl/sharedStrings.xml') : '';
    expect(strings).not.toContain('do not share');
    expect(strings).not.toContain('{');
    expect(preview(out).text).toContain('Name: Anna');
    expect(preview(out).text).toContain('Kept text');
  });

  it('leaves out the comments and charts of removed slides', () => {
    const rels = ['<Relationship Id="rIdM" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/>'];
    const template = buildPptx([{ shapes: sp('s', ap('{#show}')) + sp('x', ap('x')) + sp('e', ap('{/show}')), rels }, { shapes: sp('t', ap('kept')) }], { 'ppt/comments/comment1.xml': '<p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cm><p:text>secret remark</p:text></p:cm></p:cmLst>' });
    const names = openZip(render(template, { show: false }), DEFAULT_LIMITS).entries.map((e) => e.name);
    expect(names).not.toContain('ppt/comments/comment1.xml');
  });

  it('writes a typed date in the time zone of the option, and refuses years Excel cannot hold in validate too', () => {
    const out = render(buildXlsx({ S: { A1: '{d}' } }), { d: new Date('2026-07-01T12:00:00Z') }, { timeZone: 'Europe/Warsaw' });
    expect(String(readXlsx(out)['S']?.['A1'])).toBe('2026-07-01T14:00:00.000Z');
    const result = validate(buildXlsx({ S: { A1: '{d}' } }), { d: new Date('1800-01-01T00:00:00Z') });
    expect(result.errors.map((e) => [e.code, e.location.cell])).toEqual([['DV_E_INVALID_VALUE', 'A1']]);
  });

  it('refuses a workbook with so many row sections that writing them would take too long, in validate too', () => {
    const sheet: Record<string, string> = {};
    for (let i = 0; i < 400; i++) {
      sheet[`A${String(2 * i + 1)}`] = '{#l}{.}';
      sheet[`A${String(2 * i + 2)}`] = '{/l}';
    }
    const template = buildXlsx({ S: sheet });
    const started = Date.now();
    expectDvError(() => validate(template, { l: [1, 2] }, { limits: { maxOutputBytes: 1_000_000 } }), 'DV_E_LIMIT_EXCEEDED');
    expectDvError(() => render(template, { l: [1, 2] }, { limits: { maxOutputBytes: 1_000_000 } }), 'DV_E_LIMIT_EXCEEDED');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('counts copied rows against maxOutputBytes in validate as in render', () => {
    const sheet: Record<string, string> = { A1: '{#items}{.}', B1: 'x'.repeat(1000), C1: '{/items}' };
    expectDvError(() => validate(buildXlsx({ S: sheet }), { items: Array.from({ length: 500 }, (_, i) => i) }, { limits: { maxOutputBytes: 100_000 } }), 'DV_E_LIMIT_EXCEEDED');
  });

  it('reads tags in the new delimiters after a change, in cells without "{"', () => {
    const template = buildXlsx({ S: { A1: '{=[[ ]]=}', A2: '[[name]]' } });
    expect(inspect(template).tags.map((t) => t.raw)).toContain('[[name]]');
    expect(preview(render(template, { name: 'Anna' })).text).toContain('Anna');
  });
});

describe('review 3: Markdown', () => {
  const text = (md: string): string => partXml(render(buildDocx({ body: p('{~md}') }), { md })).replace(/<[^>]+>/g, '');
  it('writes images as text, keeps parentheses in addresses, reads code in double backticks, and shows an empty link as text', () => {
    expect(text('see ![alt](x.png) here')).toBe('see ![alt](x.png) here');
    const linked = render(buildDocx({ body: p('{~md}') }), { md: '[wiki](http://x.y/a_(b))' });
    expect(partXml(linked).replace(/<[^>]+>/g, '')).toBe('wiki');
    expect(zipText(linked, 'word/_rels/document.xml.rels')).toContain('Target="http://x.y/a_(b)"');
    expect(text('a ``co`de`` b')).toBe('a co`de b');
    expect(text('a []() b')).toBe('a []() b');
  });
});

describe('review 3: schema', () => {
  it('reads outer fields used in a loop without false warnings, types || fallbacks as values, and x.length as a list', () => {
    const loop = validate(buildDocx({ body: p('{#items}{name} for {company}; {/items}') }), { company: 'ACME', items: [{ name: 'a' }, { name: 'b' }] });
    expect(loop.warnings).toEqual([]);
    const fallback = validate(buildDocx({ body: p('{nickname || name}') }), { nickname: 'Bob', name: 'Robert' });
    expect(fallback.warnings).toEqual([]);
    expect(fallback.schema.properties?.['nickname']).not.toMatchObject({ type: 'boolean' });
    const length = validate(buildDocx({ body: p('{#users.length > 1}many{/users.length > 1}') + p('{#users}{name}{/users}') }), { users: [{ name: 'a' }, { name: 'b' }] });
    expect(length.warnings).toEqual([]);
    expect(inspect(buildDocx({ body: p('{#users.length > 1}many{/users.length > 1}') + p('{#users}{name}{/users}') })).warnings).toEqual([]);
  });
});
