// The text model of WordprocessingML parts: which text belongs to which paragraph, and where it is.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';
import { readParagraphs, type Paragraph } from '../../packages/docvane/src/docx/paragraphs';
import { NS, p, run, table, textBox } from '../helpers/docx';
const body = (inner: string): string => `<w:document ${NS}><w:body>${inner}<w:sectPr/></w:body></w:document>`;
const read = (xml: string, story: 'body' | 'header' | 'footnote' = 'body'): Paragraph[] => readParagraphs(xml, { part: '/word/document.xml', story, limits: DEFAULT_LIMITS });
const texts = (xml: string): string[] => read(xml).map((para) => para.text);

describe('readParagraphs', () => {
  it('joins the text of all runs of a paragraph', () => {
    expect(texts(body(p('Dear {cust', 'omer.na', 'me}')))).toEqual(['Dear {customer.name}']);
  });

  it('ignores what is not text: proofing marks, bookmarks, comments, run properties, empty runs', () => {
    const para = `<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr>${run('{cus')}<w:proofErr w:type="spellStart"/><w:bookmarkStart w:id="0" w:name="b"/>${run('tom', '<w:b/>')}<w:bookmarkEnd w:id="0"/><w:commentRangeStart w:id="1"/><w:r><w:rPr/></w:r>${run('er}')}<w:commentRangeEnd w:id="1"/><w:r><w:lastRenderedPageBreak/><w:t>!</w:t></w:r><w:proofErr w:type="spellEnd"/></w:p>`;
    expect(texts(body(para))).toEqual(['{customer}!']);
  });

  it('reads runs inside hyperlinks, smart tags, content controls, simple fields, custom XML and insertions', () => {
    const para =
      `<w:p><w:hyperlink r:id="rId9">${run('{a')}</w:hyperlink><w:smartTag w:uri="u" w:element="e">${run('b')}</w:smartTag>` +
      `<w:sdt><w:sdtPr/><w:sdtContent>${run('c')}</w:sdtContent></w:sdt><w:fldSimple w:instr="PAGE">${run('d')}</w:fldSimple>` +
      `<w:customXml w:element="x">${run('e')}</w:customXml><w:ins w:id="1" w:author="a">${run('f}')}</w:ins></w:p>`;
    expect(texts(body(para))).toEqual(['{abcdef}']);
  });

  it('leaves out deleted text and field instructions', () => {
    const para =
      `<w:p>${run('{a')}<w:del w:id="1" w:author="a"><w:r><w:delText>XX</w:delText></w:r></w:del>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('b')}<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `<w:moveFrom w:id="2" w:author="a">${run('MOVED')}</w:moveFrom>${run('}')}</w:p>`;
    expect(texts(body(para))).toEqual(['{ab}']);
  });

  it('writes tabs, breaks and inline objects as characters that cannot be part of a tag', () => {
    const para = `<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t><w:cr/><w:noBreakHyphen/><w:softHyphen/><w:sym w:font="Symbol" w:char="F020"/><w:drawing/><w:footnoteReference w:id="2"/></w:r></w:p>`;
    expect(texts(body(para))).toEqual(['A\tB\nC\n‑­￼￼￼']);
  });

  it('does not count tab stops of paragraph properties as text', () => {
    const para = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${run('x')}</w:p>`;
    expect(texts(body(para))).toEqual(['x']);
  });

  it('numbers paragraphs, tables, rows and cells from 1, per container', () => {
    const xml = body(p('one') + table([[p('a1') + p('a2'), p('b')], [p('c'), table([[p('deep')]])]]) + p('two') + table([[p('t2')]]));
    const where = read(xml).map((para) => [para.text, para.location.description]);
    expect(where).toEqual([
      ['one', 'body, paragraph 1'],
      ['a1', 'body, table 1 row 1 cell 1, paragraph 1'],
      ['a2', 'body, table 1 row 1 cell 1, paragraph 2'],
      ['b', 'body, table 1 row 1 cell 2, paragraph 1'],
      ['c', 'body, table 1 row 2 cell 1, paragraph 1'],
      ['deep', 'body, table 1 row 2 cell 2, table 1 row 1 cell 1, paragraph 1'],
      ['two', 'body, paragraph 2'],
      ['t2', 'body, table 2 row 1 cell 1, paragraph 1'],
    ]);
    expect(read(xml)[5]?.location).toMatchObject({
      part: '/word/document.xml',
      story: 'body',
      paragraph: 1,
      within: [
        { kind: 'table', table: 1, row: 2, cell: 2 },
        { kind: 'table', table: 1, row: 1, cell: 1 },
      ],
    });
  });

  it('reads the first branch of mc:AlternateContent only, so a text box is read once', () => {
    const xml = body(p('Box: ', textBox(p('In box {box', 'Value}')), ' after'));
    const paragraphs = read(xml);
    expect(paragraphs.map((para) => para.text)).toEqual(['Box: ￼ after', 'In box {boxValue}']);
    expect(paragraphs[1]?.location.description).toBe('body, text box 1, paragraph 1');
    expect(paragraphs[1]?.location.within).toEqual([{ kind: 'textBox', textBox: 1 }]);
  });

  it('reads mc:Fallback when there is no mc:Choice', () => {
    const xml = body(`<w:p><w:r><mc:AlternateContent><mc:Fallback><w:pict><w:txbxContent>${p('fallback')}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`);
    expect(texts(xml)).toEqual(['￼', 'fallback']);
  });

  it('orders paragraphs by where they start in the part', () => {
    const xml = body(p('{#a}', textBox(p('{x}')), '{/a}') + p('end'));
    const paragraphs = read(xml);
    expect(paragraphs.map((para) => para.text)).toEqual(['{#a}￼{/a}', '{x}', 'end']);
  });

  it('maps every text offset back to the w:t element it comes from', () => {
    const xml = body(p('ab', 'c&d', run('<e>')));
    const [para] = read(xml);
    expect(para?.text).toBe('abc&d<e>');
    expect(para?.segments.map((s) => [para.text.slice(s.textStart, s.textEnd), xml.slice(s.xmlStart, s.xmlEnd)])).toEqual([
      ['ab', 'ab'],
      ['c&d', 'c&amp;d'],
      ['<e>', '&lt;e&gt;'],
    ]);
    expect(para?.xmlOffset(0)).toBe(para?.segments[0]?.xmlStart);
    expect(para?.xmlOffset(2)).toBe(para?.segments[1]?.xmlStart);
  });

  it('counts footnotes and endnotes in order, skipping separators', () => {
    const xml = `<w:footnotes ${NS}><w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="2">${p('first')}</w:footnote><w:footnote w:id="3">${p('second') + p('second b')}</w:footnote></w:footnotes>`;
    const paragraphs = readParagraphs(xml, { part: '/word/footnotes.xml', story: 'footnote', limits: DEFAULT_LIMITS });
    expect(paragraphs.map((para) => [para.text, para.location.description])).toEqual([
      ['first', 'footnote 1, paragraph 1'],
      ['second', 'footnote 2, paragraph 1'],
      ['second b', 'footnote 2, paragraph 2'],
    ]);
    expect(paragraphs[0]?.location.note).toBe(1);
  });

  it('names headers and footers by their part', () => {
    const xml = `<w:hdr ${NS}>${p('Header {company.name}')}</w:hdr>`;
    const [para] = readParagraphs(xml, { part: '/word/header1.xml', story: 'header', limits: DEFAULT_LIMITS });
    expect(para?.location.description).toBe('header /word/header1.xml, paragraph 1');
  });

  it('reads the Strict namespace of WordprocessingML', () => {
    const strict = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
    expect(texts(`<w:document xmlns:w="${strict}"><w:body>${p('{a', 'b}')}</w:body></w:document>`)).toEqual(['{ab}']);
  });

  it('ignores text of elements in other namespaces', () => {
    const xml = body(`<w:p xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>${run('y')}</w:p>`);
    expect(texts(xml)).toEqual(['y']);
  });
});
