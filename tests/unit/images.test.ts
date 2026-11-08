// {%name}: images from bytes, data URLs and objects, sized from the file and fitted to the page or cell.
import { describe, expect, it } from 'vitest';
import { inspect, render } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { dataUrl, gif, jpegHeader, png } from '../helpers/images';
import { partXml, zipNames, zipText } from '../helpers/read-docx';

const EMU_PER_INCH = 914400;
const extent = (xml: string): [number, number][] => [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('images', () => {
  it('inserts an image from bytes as an inline picture with its own media part, relationship and content type', () => {
    const bytes = render(buildDocx({ body: p('Logo: {%logo}.') }), { logo: png(96, 48) });
    const xml = partXml(bytes);
    expect(xml).toContain('<wp:inline');
    expect(extent(xml)).toEqual([[EMU_PER_INCH, EMU_PER_INCH / 2]]);
    expect(zipNames(bytes)).toContain('word/media/tplvane1.png');
    const rels = partXml(bytes, '/word/_rels/document.xml.rels');
    const id = /<a:blip xmlns:r="[^"]+" r:embed="([^"]+)"/.exec(xml)?.[1];
    expect(rels).toContain(`Id="${String(id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/tplvane1.png"`);
    expect(zipText(bytes, '[Content_Types].xml')).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(xml).toMatch(/Logo: <\/w:t><\/w:r><w:r><w:drawing>/);
  });

  it('accepts data URLs, JPEG and GIF, and objects with size and alt text', () => {
    const body = p('{%a}{%b}{%c}');
    const xml = partXml(render(buildDocx({ body }), { a: dataUrl(png(10, 10)), b: { data: jpegHeader(300, 150, 300), alt: 'Logo "&" <co>' }, c: { data: gif(), width: 5 } }));
    const sizes = extent(xml);
    expect(sizes[0]).toEqual([95250, 95250]);
    expect(sizes[1]).toEqual([EMU_PER_INCH, EMU_PER_INCH / 2]);
    expect(sizes[2]).toEqual([5 * 360000, 5 * 360000]);
    expect(xml).toContain('descr="Logo &quot;&amp;&quot; &lt;co&gt;"');
  });

  it('shrinks a large image to the text column, keeping its proportions', () => {
    // A4 (11906 twips) with 1134-twip margins: 9638 twips of text, as LibreOffice writes it.
    const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1134" w:right="1134" w:top="1134" w:bottom="1134"/></w:sectPr>';
    const template = buildDocx({ body: p('{%x}') + sectPr });
    const xml = partXml(render(template, { x: png(2000, 1000) }));
    const [cx, cy] = extent(xml)[0] ?? [0, 0];
    expect(cx).toBe(9638 * 635);
    expect(cy).toBe(Math.round((9638 * 635) / 2));
  });

  it('fits an image to the width of its table cell', () => {
    const body = `<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr>${p('{%x}')}</w:tc></w:tr></w:tbl>`;
    const [cx] = extent(partXml(render(buildDocx({ body }), { x: png(500, 100) })))[0] ?? [0];
    expect(cx).toBe(EMU_PER_INCH);
  });

  it('adds one media part and one relationship for the same image used many times, and unique drawing ids', () => {
    const logo = png(8, 8);
    const bytes = render(buildDocx({ body: p('{#items}{%logo}{/items}') }), { items: [{ logo }, { logo }, { logo: png(9, 9) }] });
    expect(zipNames(bytes).filter((n) => n.startsWith('word/media/'))).toHaveLength(2);
    const xml = partXml(bytes);
    const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(3);
    expect(new Set([...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1])).size).toBe(2);
  });

  it('adds relationships to the part where the tag is, creating the relationships part when needed', () => {
    const bytes = render(buildDocx({ body: p('x'), headers: [p('{%logo}')] }), { logo: png(4, 4) });
    expect(partXml(bytes, '/word/_rels/header1.xml.rels')).toContain('Target="media/tplvane1.png"');
  });

  it('shows nothing for null and reports missing images', () => {
    expect(partXml(render(buildDocx({ body: p('[{%x}]') }), { x: null }))).not.toContain('<w:drawing>');
    expect(expectDvError(() => render(buildDocx({ body: p('{%x}') }), {}), 'TV_E_DATA_INVALID').errors[0]?.code).toBe('TV_E_MISSING_FIELD');
  });

  it('refuses values that are not images', () => {
    for (const x of [new TextEncoder().encode('<svg/>'), 'just text', 'data:image/png;base64,@@@', 'data:text/html;base64,PGI+', 42, { data: png(1, 1), width: -1 }, { data: png(1, 1), alt: 7 }, 'file:///etc/passwd']) {
      const error = expectDvError(() => render(buildDocx({ body: p('{%x}') }), { x }), 'TV_E_DATA_INVALID');
      expect(error.errors[0]?.code, String(x)).toBe('TV_E_INVALID_VALUE');
    }
  });

  it('enforces image limits', () => {
    expectDvError(() => render(buildDocx({ body: p('{%x}') }), { x: png(10, 10) }, { limits: { maxImageBytes: 50 } }), 'TV_E_LIMIT_EXCEEDED', { limit: 'maxImageBytes' });
    expectDvError(() => render(buildDocx({ body: p('{%x}') }), { x: gif(40000, 40000) }, { limits: { maxImagePixels: 1_000_000 } }), 'TV_E_LIMIT_EXCEEDED', { limit: 'maxImagePixels' });
    expectDvError(() => render(buildDocx({ body: p('{#a}{%x}{/a}') }), { a: [{ x: png(1, 1) }, { x: png(2, 2) }] }, { limits: { maxImages: 1 } }), 'TV_E_LIMIT_EXCEEDED', { limit: 'maxImages' });
  });

  it('describes images in the schema as a data URL or an object', () => {
    const logo = inspect(buildDocx({ body: p('{%logo}') })).schema.properties?.['logo'];
    expect(logo?.anyOf?.map((s) => s.type)).toEqual(['string', 'object']);
  });
});
