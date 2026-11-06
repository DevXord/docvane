// {url | link}: hyperlinks to http, https and mailto addresses only, in the template's Hyperlink style.
import { describe, expect, it } from 'vitest';
import { inspect, render, type DvWarning } from 'docvane';
import { buildDocx, p, run, style } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { bodyText, partXml } from '../helpers/read-docx';

const STYLES = style('character', 'Hyperlink', 'Hyperlink');

describe('links', () => {
  it('writes a hyperlink with an external relationship and the Hyperlink style of the template', () => {
    const bytes = render(buildDocx({ body: p('See ', run('{site | link("our site")}', '<w:b/>'), '.'), styles: STYLES }), { site: "https://example.com/?a=1&b=it's" });
    expect(bodyText(bytes)).toEqual(['See our site.']);
    const xml = partXml(bytes);
    const id = /<w:hyperlink xmlns:r="[^"]+" r:id="([^"]+)">/.exec(xml)?.[1];
    expect(xml).toContain('<w:rPr><w:rStyle w:val="Hyperlink"/><w:b/></w:rPr><w:t>our site</w:t>');
    expect(partXml(bytes, '/word/_rels/document.xml.rels')).toContain(
      `<Relationship Id="${String(id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=it's" TargetMode="External"/>`,
    );
  });

  it('shows the address when the formatter has no text, and accepts mailto', () => {
    expect(bodyText(render(buildDocx({ body: p('{a | link} {b | link}'), styles: STYLES }), { a: 'http://x.org', b: 'mailto:office@example.com' }))).toEqual(['http://x.org mailto:office@example.com']);
  });

  it('refuses addresses that are not absolute http, https or mailto', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>', '/relative', 'example.com', 'https://', 'https://a b', 'https://x"onmouseover="1', 'mailto:', 'vbscript:x']) {
      const error = expectDvError(() => render(buildDocx({ body: p('{u | link}') }), { u: url }), 'DV_E_DATA_INVALID');
      expect(error.errors[0]?.code, url).toBe('DV_E_INVALID_VALUE');
    }
  });

  it('warns when the template has no Hyperlink style and adds no formatting of its own', () => {
    const warnings: DvWarning[] = [];
    const xml = partXml(render(buildDocx({ body: p('{u | link}') }), { u: 'https://example.com' }, { onWarning: (w) => warnings.push(w) }));
    expect(xml).not.toContain('w:rStyle');
    expect(xml).not.toMatch(/w:color|w:u /);
    expect(warnings.map((w) => w.code)).toEqual(['DV_W_STYLE_MISSING']);
  });

  it('describes the value before link as an address in the schema', () => {
    expect(inspect(buildDocx({ body: p('{site | link}') })).schema.properties?.['site']).toMatchObject({ type: 'string', description: 'Link address (http, https or mailto) in body, paragraph 1.' });
  });
});
