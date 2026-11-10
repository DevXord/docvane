// A rendered body never ends with a table (D-086): when the content of the body ends with a w:tbl,
// render adds an empty paragraph after it, before the last section properties. ECMA-376 allows a
// body that ends with a table, but LibreOffice 26.2 does not finish exporting such a document as
// text, and the last section properties belong after the final paragraph (Part 1, Annex L.1.7.1).
import { describe, expect, it } from 'vitest';
import { inspect, render } from 'tplvane';
import { buildDocx, p, table } from '../helpers/docx';
import { bodyText, partXml } from '../helpers/read-docx';

const lastBlocks = (bytes: Uint8Array): string => /<w:body>([\s\S]*)<\/w:body>/.exec(partXml(bytes))?.[1]?.slice(-60) ?? '';

describe('a rendered body ends with a paragraph', () => {
  it('adds an empty paragraph when removing the closing tag leaves the body ending with a table', () => {
    const out = render(buildDocx({ body: p('Orders:') + p('{#o}') + table([[p('{name}')]]) + p('{/o}') }), { o: [{ name: 'A' }, { name: 'B' }] });
    expect(partXml(out)).toMatch(/<\/w:tbl><w:p\/><w:sectPr\/><\/w:body>/);
    expect(bodyText(out)).toEqual(['Orders:', 'A', 'B', '']);
    expect(inspect(out).tags).toEqual([]);
  });

  it('adds one when the template itself ends with a table', () => {
    const out = render(buildDocx({ body: p('{title}') + table([[p('{name}')]]) }), { title: 'T', name: 'A' });
    expect(partXml(out)).toMatch(/<\/w:tbl><w:p\/><w:sectPr\/><\/w:body>/);
  });

  it('adds nothing when the body already ends with a paragraph', () => {
    const template = buildDocx({ body: p('{#o}') + table([[p('{name}')]]) + p('{/o}') + p('End') });
    const out = render(template, { o: [{ name: 'A' }] });
    expect(lastBlocks(out)).toMatch(/End<\/w:t><\/w:r><\/w:p><w:sectPr\/>$/);
    expect(bodyText(out)).toEqual(['A', 'End']);
  });

  it('adds it after a table that holds a table, and leaves headers and footers alone', () => {
    const out = render(buildDocx({ body: p('{x}') + table([[table([[p('in')]])]]), headers: [table([[p('{x}')]])] }), { x: 'v' });
    expect(partXml(out)).toMatch(/<\/w:tbl><\/w:tc><\/w:tr><\/w:tbl><w:p\/><w:sectPr\/>/);
    expect(partXml(out, '/word/header1.xml')).not.toContain('<w:p/>');
  });
});
