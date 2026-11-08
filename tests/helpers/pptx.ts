// Builds small PPTX packages in memory for tests, in the shape LibreOffice 24.2 writes (F-018):
// presentation.xml with p:sldIdLst, slides with p:spTree, notes slides with relationships both
// ways. Masters, layouts and themes are left out unless a test needs them.
import { writeZip } from '../../packages/tplvane/src/zip/writer';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PNS = `xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"`;

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A run; `rPr` is the attributes and children of a:rPr, written as `attrs|children`. */
export const ar = (text: string, attrs = '', children = ''): string => `<a:r><a:rPr lang="en-US"${attrs === '' ? '' : ` ${attrs}`}${children === '' ? '/>' : `>${children}</a:rPr>`}<a:t>${escape(text)}</a:t></a:r>`;
/** A paragraph of runs (strings become runs; strings starting with `<` are XML). */
export const ap = (...content: string[]): string => `<a:p>${content.map((c) => (c.startsWith('<') ? c : ar(c))).join('')}<a:endParaRPr lang="en-US"/></a:p>`;

let nextId = 2;
/** A text shape with a name, a frame in EMU and paragraphs. */
export const sp = (name: string, paragraphs: string, frame: [number, number, number, number] | null = [360000, 360000, 3600000, 1800000]): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${String(nextId++)}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${frame === null ? '' : `<a:xfrm><a:off x="${String(frame[0])}" y="${String(frame[1])}"/><a:ext cx="${String(frame[2])}" cy="${String(frame[3])}"/></a:xfrm>`}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;

/** A table in a graphic frame; each cell is the paragraphs of its text body. */
export const ptable = (name: string, rows: string[][]): string =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${String(nextId++)}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="3600000" cy="720000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${(rows[0] ?? []).map(() => '<a:gridCol w="1800000"/>').join('')}</a:tblGrid>${rows
    .map((cells) => `<a:tr h="360000">${cells.map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${c}</a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`)
    .join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

export interface SlideSpec {
  /** Shapes inside p:spTree. */
  readonly shapes: string;
  /** Shapes of the notes slide, if any. */
  readonly notes?: string;
  /** Extra relationships of the slide. */
  readonly rels?: readonly string[];
}

const tree = (shapes: string): string =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;

/** Builds a PPTX package. */
export function buildPptx(slides: readonly SlideSpec[], extra: Readonly<Record<string, string | Uint8Array>> = {}): Uint8Array {
  const parts: [string, string | Uint8Array][] = [];
  const overrides: string[] = [];
  const presRels: string[] = [];
  const ids: string[] = [];
  slides.forEach((s, i) => {
    const n = String(i + 1);
    parts.push([`ppt/slides/slide${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${PNS}>${tree(s.shapes)}</p:sld>`]);
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    const rels = [...(s.rels ?? [])];
    if (s.notes !== undefined) {
      parts.push([`ppt/notesSlides/notesSlide${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${PNS}>${tree(s.notes)}</p:notes>`]);
      overrides.push(`<Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`);
      parts.push([`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slide" Target="../slides/slide${n}.xml"/></Relationships>`]);
      rels.push(`<Relationship Id="rIdNotes" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
    }
    parts.push([`ppt/slides/_rels/slide${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`]);
    presRels.push(`<Relationship Id="rId${String(10 + i)}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`);
    ids.push(`<p:sldId id="${String(256 + i)}" r:id="rId${String(10 + i)}"/>`);
  });
  const entries: [string, string | Uint8Array][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides.join('')}</Types>`,
    ],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`],
    ['ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${PNS}><p:sldIdLst>${ids.join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join('')}</Relationships>`],
    ...parts,
    ...Object.entries(extra),
  ];
  const enc = new TextEncoder();
  return writeZip(entries.map(([name, data]) => ({ name, data: typeof data === 'string' ? enc.encode(data) : data })));
}
