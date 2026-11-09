// Templates built in code for the tests, the smoke tests and the 5-minute start: the offer of
// examples/offer, and a small presentation and workbook. The repository holds no Office files
// (D-084), so they are made here, in memory, with fflate (a dependency of tplvane) and xlvane.
// The parts follow the shape LibreOffice and Word write; they are small, not complete documents.
//
//   node scripts/make-example.mjs     writes examples/offer/offer.docx
import { strToU8, zipSync } from 'fflate';
import { createWorkbook, writeWorkbook } from 'xlvane';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A ZIP package from [name, text] pairs; the dates are fixed, so the same input gives the same bytes. */
const zip = (entries) => zipSync(Object.fromEntries(entries.map(([name, text]) => [name, [strToU8(text), { mtime: new Date(2026, 10, 6) }]])), { level: 6 });
const relationships = (rels) => `${HEAD}<Relationships xmlns="${PKG_REL}">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

// Word: a run, a paragraph in a style, a table cell.
const run = (text, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
const para = (style, ...runs) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.map((r) => (r.startsWith('<') ? r : run(r))).join('')}</w:p>`;
const cell = (width, text) => `<w:tc><w:tcPr><w:tcW w:w="${String(width)}" w:type="dxa"/></w:tcPr>${para('TableContents', text)}</w:tc>`;
const row = (texts) => `<w:tr>${texts.map((t, i) => cell(i < 2 ? 2409 : 2410, t)).join('')}</w:tr>`;

const FONTS = '<w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif" w:eastAsia="WenQuanYi Zen Hei" w:cs="FreeSans"/>';
/** A paragraph style; `rPr` is the inner XML of its run properties after the fonts. */
const paragraphStyle = (id, name, rPr = '<w:sz w:val="24"/>', extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}<w:qFormat/><w:pPr><w:widowControl w:val="false"/></w:pPr><w:rPr>${FONTS}${rPr}</w:rPr></w:style>`;

/**
 * The offer of the 5-minute start (examples/offer): a logo, a title, the customer in bold, a date,
 * a table of items with a loop over its second row, a total, a condition, Markdown and a closing.
 * The tags and their places are those of the offer saved by LibreOffice 24.2 in 1.0.0.
 */
export function offerDocx() {
  const body = [
    para('Normal', '{%logo}'),
    para('Title', 'Offer {number}'),
    para('Normal', 'For ', run('{customer.name}', true), ', {customer.company}'),
    para('Normal', 'Date: {date | date("long")}'),
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2409"/><w:gridCol w:w="2409"/><w:gridCol w:w="2410"/><w:gridCol w:w="2410"/></w:tblGrid>` +
      row(['Product', 'Qty', 'Price', 'Total']) +
      row(['{#items}{name}', '{qty}', '{price | currency("EUR")}', '{total | currency("EUR")}{/items}']) +
      '</w:tbl>',
    para('Normal', 'Total: {sum | currency("EUR")}'),
    para('Normal', '{#vip}As a VIP customer you get free delivery.{/vip}'),
    para('Normal', '{~notes}'),
    para('Normal', 'Regards, {author}'),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>',
  ].join('');
  const styles =
    `${HEAD}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${FONTS}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:suppressAutoHyphens w:val="true"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    paragraphStyle('Normal', 'Normal') +
    paragraphStyle('Title', 'Title', '<w:b/><w:sz w:val="40"/>', '<w:next w:val="Normal"/>') +
    paragraphStyle('ListBullet', 'List Bullet') +
    paragraphStyle('TableContents', 'Table Contents', undefined, '<w:basedOn w:val="Normal"/>') +
    '</w:styles>';
  return zip([
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ],
    ['_rels/.rels', relationships([['rId1', 'officeDocument', 'word/document.xml']])],
    ['word/document.xml', `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body}</w:body></w:document>`],
    ['word/_rels/document.xml.rels', relationships([['rId1', 'styles', 'styles.xml']])],
    ['word/styles.xml', styles],
  ]);
}

/** Data for {@link pptxSmoke}; the result contains "Offer for Anna Nowak". */
export const PPTX_SMOKE_DATA = { customer: { name: 'Anna Nowak' }, products: [{ name: 'Desk' }, { name: 'Chair' }] };

/** A presentation of one slide: a title with a value and a loop over the paragraphs of a shape. */
export function pptxSmoke() {
  const shape = (id, name, paragraphs) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="${String(id * 1000000)}"/><a:ext cx="8229600" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((t) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${escape(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
  const tree = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape(2, 'Title', ['Offer for {customer.name}'])}${shape(3, 'Products', ['{#products}', '{name}', '{/products}'])}</p:spTree></p:cSld>`;
  return zip([
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    ],
    ['_rels/.rels', relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['ppt/presentation.xml', `${HEAD}<p:presentation xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', relationships([['rId2', 'slide', 'slides/slide1.xml']])],
    ['ppt/slides/slide1.xml', `${HEAD}<p:sld xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}">${tree}</p:sld>`],
    ['ppt/slides/_rels/slide1.xml.rels', relationships([])],
  ]);
}

/** Data for {@link xlsxSmoke}; the result contains "Offer for Anna Nowak". */
export const XLSX_SMOKE_DATA = { customer: { name: 'Anna Nowak' }, items: [{ name: 'Desk', price: 1200 }, { name: 'Chair', price: 349.99 }] };

/** A workbook of one sheet: a title, a loop over a row with a formula, and a total below it. */
export function xlsxSmoke() {
  const wb = createWorkbook();
  const sheet = wb.addSheet('Offer');
  sheet.set('A1', 'Offer for {customer.name}');
  sheet.set('A3', '{#items}{name}');
  sheet.set('B3', '{price}{/items}');
  sheet.set('A4', 'Total');
  sheet.set('B4', { formula: 'SUM(B3:B3)' });
  return writeWorkbook(wb);
}
