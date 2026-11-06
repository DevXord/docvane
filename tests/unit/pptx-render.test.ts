// render on presentations: values, loops inside shapes and tables, repeated slides with their
// notes, images in place of shapes, links and Markdown.
import { describe, expect, it } from 'vitest';
import { inspect, render } from 'docvane';
import { expectDvError } from '../helpers/expect-error';
import { png } from '../helpers/images';
import { ap, ar, buildPptx, ptable, sp } from '../helpers/pptx';
import { pptxPart, slideTexts } from '../helpers/read-pptx';
import { zipNames, zipText } from '../helpers/read-docx';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('render on PPTX: text', () => {
  it('fills values with the run properties of the tag, and line breaks as a:br', () => {
    const bytes = render(buildPptx([{ shapes: sp('Title', ap(ar('Hello ', 'i="1"'), ar('{na', 'b="1"'), ar('me}', 'u="sng"'), '!')) }]), { name: 'Anna\nNowak' });
    expect(slideTexts(bytes)).toEqual([{ slide: ['Hello Anna\nNowak!'], notes: [] }]);
    const { xml } = pptxPart(bytes, '/ppt/slides/slide1.xml');
    expect(xml).toContain('<a:r><a:rPr lang="en-US" b="1"/><a:t>Anna</a:t></a:r><a:br><a:rPr lang="en-US" b="1"/></a:br><a:r><a:rPr lang="en-US" b="1"/><a:t>Nowak</a:t></a:r>');
    expect(xml).toContain('<a:r><a:rPr lang="en-US" i="1"/><a:t>Hello </a:t></a:r>');
    expect(xml).not.toContain('xml:space');
  });

  it('repeats paragraphs in a shape, content in a paragraph and table rows', () => {
    const shapes = sp('List', ap('{#items}') + ap('- {name}') + ap('{/items}') + ap('Tags: {#tags}{.} {/tags}')) + ptable('T', [[ap('Name'), ap('Price')], [ap('{#items}{name}'), ap('{price}{/items}')]]);
    const bytes = render(buildPptx([{ shapes }]), { items: [{ name: 'A', price: 1 }, { name: 'B', price: 2 }], tags: ['x', 'y'] });
    expect(slideTexts(bytes)[0]?.slide).toEqual(['- A', '- B', 'Tags: x y ', 'Name', 'Price', 'A', '1', 'B', '2']);
  });

  it('fills notes', () => {
    expect(slideTexts(render(buildPptx([{ shapes: sp('A', ap('x')), notes: sp('N', ap('Say {hi}')) }]), { hi: 'hello' }))[0]?.notes).toEqual(['Say hello']);
  });
});

describe('render on PPTX: repeated slides', () => {
  const template = (): Uint8Array =>
    buildPptx([
      { shapes: sp('Title', ap('Products of {company}')) },
      {
        shapes: sp('Start', ap('{#products}')) + sp('Name', ap('{name}')) + sp('Logo', ap('{%logo}')),
        notes: sp('N', ap('Talk about {name}')),
        rels: [`<Relationship Id="rIdLayout" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`],
      },
      { shapes: sp('Price', ap('Price: {price}')) + sp('End', ap('{/products}')) },
      { shapes: sp('Bye', ap('Thanks')) },
    ]);
  const data = { company: 'ACME', products: [{ name: 'Desk', price: 100, logo: png(10, 10) }, { name: 'Chair', price: 50, logo: png(10, 10) }, { name: 'Lamp', price: 20, logo: png(20, 10) }] };

  it('repeats the range of slides for each item, in order, with notes, and drops the shapes of the section tags', () => {
    const bytes = render(template(), data);
    expect(slideTexts(bytes).map((s) => [s.slide.join('|'), s.notes.join('|')])).toEqual([
      ['Products of ACME', ''],
      ['Desk', 'Talk about Desk'],
      ['Price: 100', ''],
      ['Chair', 'Talk about Chair'],
      ['Price: 50', ''],
      ['Lamp', 'Talk about Lamp'],
      ['Price: 20', ''],
      ['Thanks', ''],
    ]);
    expect(inspect(bytes).tags).toEqual([]);
  });

  it('gives copies new parts, relationships, notes with a link back, unique slide ids and Overrides', () => {
    const bytes = render(template(), data);
    const pres = pptxPart(bytes, '/ppt/presentation.xml');
    const ids = [...pres.xml.matchAll(/<p:sldId [^>]*id="(\d+)" r:id="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(ids).toHaveLength(8);
    expect(new Set(ids.map((i) => i[0])).size).toBe(8);
    expect(new Set(ids.map((i) => i[1])).size).toBe(8);
    const copies = zipNames(bytes).filter((n) => n.startsWith('ppt/slides/docvane'));
    expect(copies).toHaveLength(4);
    const copy = pptxPart(bytes, `/${String(copies[0])}`);
    expect(copy.rels).toContain('Target="../slideLayouts/slideLayout1.xml"');
    const notesTarget = /Type="[^"]+\/notesSlide" Target="([^"]+)"/.exec(copy.rels)?.[1];
    expect(notesTarget).toMatch(/^\.\.\/notesSlides\/docvane\d+\.xml$/);
    expect(pptxPart(bytes, `/ppt/notesSlides/${String(notesTarget).split('/').pop()}`).rels).toContain(`Target="../slides/${String(copies[0]).split('/').pop()}"`);
    const types = zipText(bytes, '[Content_Types].xml');
    for (const name of copies) expect(types).toContain(`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
  });

  it('puts the images of each copy in place of the shape, sharing media parts', () => {
    const bytes = render(template(), data);
    expect(zipNames(bytes).filter((n) => n.startsWith('ppt/media/'))).toHaveLength(2);
    const { xml, rels } = pptxPart(bytes, '/ppt/slides/slide2.xml');
    expect(xml).toMatch(/<p:pic><p:nvPicPr><p:cNvPr id="\d+" name="Logo" descr=""\/>/);
    expect(xml).toContain('<a:off x="1260000" y="360000"/><a:ext cx="1800000" cy="1800000"/>');
    expect(rels).toMatch(/Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/image" Target="\.\.\/media\/docvane\d\.png"/);
  });

  it('removes the slides of an empty list with their notes', () => {
    const bytes = render(template(), { company: 'ACME', products: [] });
    expect(slideTexts(bytes).map((s) => s.slide.join('|'))).toEqual(['Products of ACME', 'Thanks']);
    expect(zipNames(bytes).some((n) => n.includes('slide2.xml') || n.includes('notesSlide2'))).toBe(false);
    expect(zipText(bytes, '[Content_Types].xml')).not.toContain('slide2.xml');
    expect(pptxPart(bytes, '/ppt/presentation.xml').rels).not.toContain('slides/slide2.xml');
  });
});

describe('render on PPTX: links, Markdown, placement', () => {
  it('writes links as a:hlinkClick with an external relationship', () => {
    const bytes = render(buildPptx([{ shapes: sp('A', ap('{site | link("Site")}')) }]), { site: 'https://example.com' });
    const { xml, rels } = pptxPart(bytes, '/ppt/slides/slide1.xml');
    const id = /<a:hlinkClick xmlns:r="[^"]+" r:id="([^"]+)"\/>/.exec(xml)?.[1];
    expect(xml).toContain('<a:t>Site</a:t>');
    expect(rels).toContain(`Id="${String(id)}" Type="${REL}/hyperlink" Target="https://example.com" TargetMode="External"`);
  });

  it('writes Markdown as paragraphs with list levels and bold headings', () => {
    const bytes = render(buildPptx([{ shapes: sp('Body', '<a:p><a:pPr marL="0"/><a:r><a:rPr lang="pl-PL"/><a:t>{~text}</a:t></a:r></a:p>') }]), { text: '# Title\n\nSome **bold** text.\n\n- one\n  - two' });
    expect(slideTexts(bytes)[0]?.slide).toEqual(['Title', 'Some bold text.', 'one', 'two']);
    const { xml } = pptxPart(bytes, '/ppt/slides/slide1.xml');
    expect(xml).toContain('<a:pPr marL="0"/><a:r><a:rPr lang="pl-PL" b="1"><\/a:rPr><a:t>Title</a:t>'.replace('<\\/', '</'));
    expect([...xml.matchAll(/<a:pPr lvl="(\d)"/g)].map((m) => m[1])).toEqual(['0', '1']);
  });

  it('refuses an image tag that shares its shape with text, and sections between slides that are not alone in shapes', () => {
    expect(expectDvError(() => render(buildPptx([{ shapes: sp('A', ap('Logo {%logo}')) }]), { logo: png(1, 1) }), 'DV_E_TEMPLATE_INVALID').errors[0]?.code).toBe('DV_E_TAG_PLACEMENT');
    expect(expectDvError(() => render(buildPptx([{ shapes: sp('A', ap('x {#a}')) }, { shapes: sp('B', ap('{/a}')) }]), { a: [] }), 'DV_E_TEMPLATE_INVALID').errors[0]?.code).toBe('DV_E_SECTION_PLACEMENT');
  });
});
