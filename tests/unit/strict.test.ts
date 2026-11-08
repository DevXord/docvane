// A Strict package stays Strict: what a render adds (pictures, links, repeated slides) uses the
// Strict namespaces and relationship types of ECMA-376 Part 1, not the Transitional ones of Part 4
// (F-025). The templates are the helpers' Transitional files with every Transitional name replaced.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { ap, buildPptx, sp } from '../helpers/pptx';
import { png } from '../helpers/images';

const NAMES: readonly (readonly [string, string])[] = [
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'],
  ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'],
  ['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main'],
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'],
];

/** Every XML part and relationships part of the package, rewritten. */
function rewrite(bytes: Uint8Array, change: (xml: string) => string): Uint8Array {
  const files = unzipSync(bytes);
  for (const [name, data] of Object.entries(files)) if (/\.(xml|rels)$/.test(name)) files[name] = strToU8(change(strFromU8(data)));
  return zipSync(files);
}

const toStrict = (bytes: Uint8Array): Uint8Array => rewrite(bytes, (xml) => NAMES.reduce((s, [t, st]) => s.split(t).join(st), xml));

/** The text of every XML part and relationships part, joined. */
function allXml(bytes: Uint8Array): string {
  return Object.entries(unzipSync(bytes))
    .filter(([name]) => /\.(xml|rels)$/.test(name))
    .map(([, data]) => strFromU8(data))
    .join('\n');
}

/** Transitional names other than those of OPC itself (content types, package relationships, markup compatibility), which both classes share. */
const transitional = (xml: string): string[] => [...new Set(xml.match(/http:\/\/schemas\.openxmlformats\.org\/(?!package\/|markup-compatibility\/)[^"' <]+/g) ?? [])];

describe('Strict packages', () => {
  it('get Strict names for pictures and links in documents', () => {
    const template = toStrict(buildDocx({ body: p('{%logo} {site | link("Site")}') }));
    expect(transitional(allXml(template))).toEqual([]);
    const out = allXml(render(template, { logo: png(4, 4), site: 'https://example.com' }));
    expect(transitional(out)).toEqual([]);
    expect(out).toContain('Type="http://purl.oclc.org/ooxml/officeDocument/relationships/image"');
    expect(out).toContain('Type="http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink"');
    expect(out).toContain('xmlns:wp="http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"');
    expect(out).toContain('<a:graphicData uri="http://purl.oclc.org/ooxml/drawingml/picture">');
  });

  it('get Strict names for pictures, links and repeated slides in presentations', () => {
    const template = toStrict(buildPptx([{ shapes: sp('S', ap('{#items}')) + sp('N', ap('{name | link("x")}')) + sp('P', ap('{%photo}')) + sp('E', ap('{/items}')) }]));
    expect(transitional(allXml(template))).toEqual([]);
    const out = allXml(render(template, { items: [{ name: 'https://a.example', photo: png(4, 4) }, { name: 'https://b.example', photo: png(4, 4) }] }));
    expect(transitional(out)).toEqual([]);
    expect(out).toContain('Type="http://purl.oclc.org/ooxml/officeDocument/relationships/slide"');
    expect(out).toContain('Type="http://purl.oclc.org/ooxml/officeDocument/relationships/image"');
  });

  it('keep Transitional names in Transitional packages', () => {
    const out = allXml(render(buildDocx({ body: p('{%logo}') }), { logo: png(4, 4) }));
    expect(out).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"');
    expect(out).not.toContain('purl.oclc.org');
  });
});
