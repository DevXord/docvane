// Builds small DOCX packages in memory for tests, with the ZIP writer copied from xlvane. The
// parts follow the shape LibreOffice and Word write (checked against files saved by LibreOffice
// 24.2 in tests/corpus/libreoffice); they are minimal, not complete documents.
import { writeZip } from '../../packages/tplvane/src/zip/writer';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const V = 'urn:schemas-microsoft-com:vml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:v="${V}" mc:Ignorable="wps"`;

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A run with one `w:t`; `rPr` is inner XML of `w:rPr`. */
export const run = (text: string, rPr = ''): string => `<w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;

/** A paragraph of runs (strings are made into runs) and other inline XML (strings starting with `<`). */
export const p = (...content: string[]): string => `<w:p>${content.map((c) => (c.startsWith('<') ? c : run(c))).join('')}</w:p>`;

/** A table; each row is a list of cells, each cell the inner XML of `w:tc` (paragraphs). */
export const table = (rows: string[][]): string =>
  `<w:tbl><w:tblPr/><w:tblGrid/>${rows.map((cells) => `<w:tr>${cells.map((c) => `<w:tc><w:tcPr/>${c}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

/** A run holding a text box with the given paragraphs, written as Word does: a DrawingML choice and a VML fallback. */
export const textBox = (paragraphs: string): string =>
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx><w:txbxContent>${paragraphs}</w:txbxContent></wps:txbx></wps:wsp></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${paragraphs}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

export interface DocxSpec {
  /** Inner XML of `w:body`. */
  readonly body: string;
  /** Inner XML of each `w:hdr`. */
  readonly headers?: readonly string[];
  /** Inner XML of each `w:ftr`. */
  readonly footers?: readonly string[];
  /** Inner XML of each footnote (paragraphs); ids start at 1, after the two separators. */
  readonly footnotes?: readonly string[];
  /** Inner XML of each endnote. */
  readonly endnotes?: readonly string[];
  /** Extra package parts, by ZIP name. */
  readonly extra?: Readonly<Record<string, string>>;
  /** Replaces the package relationships part. */
  readonly packageRels?: string;
  /** Extra relationships of the main part. */
  readonly documentRels?: readonly string[];
  /** Inner XML of `w:styles`; adds a styles part. Use {@link style} for its entries. */
  readonly styles?: string;
  /** Replaces the root element of the main part (default `w:document`); may add attributes after the name. */
  readonly root?: string;
}

const notes = (kind: 'footnote' | 'endnote', items: readonly string[]): string => {
  const sep = `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s ${NS}>${sep}${items.map((n, i) => `<w:${kind} w:id="${String(i + 1)}">${n}</w:${kind}>`).join('')}</w:${kind}s>`;
};

/** Builds a DOCX package from `spec`. */
export function buildDocx(spec: DocxSpec): Uint8Array {
  const parts: [string, string][] = [];
  const overrides: string[] = [];
  const rels: string[] = [...(spec.documentRels ?? [])];
  let id = 100;
  const add = (zipName: string, type: string, relType: string, xml: string): void => {
    parts.push([zipName, xml]);
    overrides.push(`<Override PartName="/${zipName}" ContentType="${type}"/>`);
    rels.push(`<Relationship Id="rId${String(id++)}" Type="${REL}/${relType}" Target="${zipName.slice('word/'.length)}"/>`);
  };
  (spec.headers ?? []).forEach((h, i) =>
    add(`word/header${String(i + 1)}.xml`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml', 'header', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${h}</w:hdr>`),
  );
  (spec.footers ?? []).forEach((f, i) =>
    add(`word/footer${String(i + 1)}.xml`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml', 'footer', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${f}</w:ftr>`),
  );
  if (spec.styles !== undefined) add('word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml', 'styles', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>${spec.styles}</w:styles>`);
  if (spec.footnotes) add('word/footnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml', 'footnotes', notes('footnote', spec.footnotes));
  if (spec.endnotes) add('word/endnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml', 'endnotes', notes('endnote', spec.endnotes));
  const root = spec.root ?? 'w:document';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} ${NS}><w:body>${spec.body}${spec.body.includes('<w:sectPr') ? '' : '<w:sectPr/>'}</w:body></${root.split(' ')[0] ?? root}>`;
  const entries: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${overrides.join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      spec.packageRels ??
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    ['word/document.xml', document],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`],
    ...parts,
    ...Object.entries(spec.extra ?? {}),
  ];
  const enc = new TextEncoder();
  return writeZip(entries.map(([name, xml]) => ({ name, data: enc.encode(xml) })));
}

/** A style definition for {@link DocxSpec.styles}, written as LibreOffice 24.2 writes one (F-016). */
export const style = (type: 'paragraph' | 'character', id: string, name: string): string => `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;

