// The text model of a slide or notes part of a presentation (PresentationML with DrawingML text),
// with the same records as the WordprocessingML model (../docx/paragraphs), so that the lexer, the
// tag parser, the section tree, the schema and the renderer work on both. Observed in files saved
// by LibreOffice 24.2.7.2 (F-018), to be checked in ECMA-376 Part 1 §19 and §21 and PowerPoint:
// - Text is the content of a:t inside a:r, in a:p paragraphs of p:txBody (shapes) and a:txBody
//   (table cells).
// - a:br gives "\n", a:fld (a field such as the slide number) gives U+FFFC: neither can be in a tag.
// - Shapes (p:sp, p:graphicFrame, p:pic, p:cxnSp, p:grpSp) are counted per container, the slide or
//   a group, and named by p:cNvPr/@name; tables in a graphic frame count rows and cells.
// - Of mc:AlternateContent the first mc:Choice is read, as in documents.
import type { DvContainer, DvLocation, DvStory } from '../errors';
import { describeContainer, MC_NAMESPACE, selectedBranch, type ParagraphRecord, type Piece } from '../docx/paragraphs';
import type { RawDocument, RawElement } from '../xml/raw-tree';

/** DrawingML: Transitional and Strict. */
export const DML_NAMESPACES: ReadonlySet<string> = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);
/** PresentationML: Transitional and Strict. */
export const PML_NAMESPACES: ReadonlySet<string> = new Set(['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']);

const SHAPES: ReadonlySet<string> = new Set(['sp', 'graphicFrame', 'pic', 'cxnSp', 'grpSp', 'contentPart']);

export const isDml = (e: RawElement, local?: string): boolean => DML_NAMESPACES.has(e.ns) && (local === undefined || e.local === local);
export const isPml = (e: RawElement, local?: string): boolean => PML_NAMESPACES.has(e.ns) && (local === undefined || e.local === local);

/** The name of a shape: p:cNvPr/@name inside its non-visual properties. */
export function shapeName(shape: RawElement): string {
  for (const nv of shape.children) {
    if (nv.kind !== 'element' || !isPml(nv) || !nv.local.startsWith('nv')) continue;
    for (const c of nv.children) if (c.kind === 'element' && isPml(c, 'cNvPr')) return c.attrs.get('name') ?? '';
  }
  return '';
}

interface Scope {
  readonly within: readonly DvContainer[];
  readonly prefix: string;
  paragraphs: number;
  shapes: number;
  tables: number;
}

/** Walks the paragraphs of one slide or notes part, in document order. */
export function walkSlideParagraphs(doc: RawDocument, options: { readonly part: string; readonly story: DvStory; readonly slide: number }): ParagraphRecord[] {
  const { part, story, slide } = options;
  const out: ParagraphRecord[] = [];
  const scopes: Scope[] = [{ within: [], prefix: story === 'notes' ? `slide ${String(slide)} notes` : `slide ${String(slide)}`, paragraphs: 0, shapes: 0, tables: 0 }];
  const tables: { scope: Scope; index: number; rows: number; cells: number }[] = [];
  const alternates: RawElement[] = [];
  const scope = (): Scope => scopes[scopes.length - 1] as Scope;
  const push = (container: DvContainer): void => {
    const s = scope();
    scopes.push({ within: [...s.within, container], prefix: `${s.prefix}, ${describeContainer(container)}`, paragraphs: 0, shapes: 0, tables: 0 });
  };

  const paragraph = (p: RawElement): void => {
    const s = scope();
    const n = ++s.paragraphs;
    const location: DvLocation = { part, story, slide, ...(s.within.length === 0 ? {} : { within: s.within }), paragraph: n, description: `${s.prefix}, paragraph ${String(n)}` };
    const pieces: Piece[] = [];
    let text = '';
    const visitRun = (e: RawElement): void => {
      for (const c of e.children) {
        if (c.kind !== 'element') continue;
        if (isDml(c, 'r')) {
          for (const t of c.children) {
            if (t.kind !== 'element' || !isDml(t, 't')) continue;
            for (const node of t.children) {
              if (node.kind !== 'text' || node.text === '') continue;
              pieces.push({ kind: 'text', node, t, run: c, textStart: text.length, textEnd: text.length + node.text.length });
              text += node.text;
            }
          }
        } else if (isDml(c, 'br') || isDml(c, 'fld')) {
          pieces.push({ kind: 'char', element: c, textStart: text.length, textEnd: text.length + 1 });
          text += isDml(c, 'br') ? '\n' : '￼';
        }
      }
    };
    visitRun(p);
    out.push({ element: p, text, pieces, location, alternates: [...alternates] });
  };

  const visit = (e: RawElement): void => {
    if (e.ns === MC_NAMESPACE && e.local === 'AlternateContent') {
      const branch = selectedBranch(e);
      if (branch !== undefined) {
        alternates.push(e);
        visitChildren(branch);
        alternates.pop();
      }
      return;
    }
    if (isPml(e) && SHAPES.has(e.local)) {
      const s = scope();
      push({ kind: 'shape', shape: ++s.shapes, name: shapeName(e) });
      visitChildren(e);
      scopes.pop();
      return;
    }
    if (isDml(e, 'tbl')) {
      const s = scope();
      tables.push({ scope: s, index: ++s.tables, rows: 0, cells: 0 });
      visitChildren(e);
      tables.pop();
      return;
    }
    if (isDml(e, 'tr')) {
      const t = tables[tables.length - 1];
      if (t !== undefined) {
        t.rows++;
        t.cells = 0;
      }
    } else if (isDml(e, 'tc')) {
      const t = tables[tables.length - 1];
      if (t !== undefined) {
        push({ kind: 'table', table: t.index, row: t.rows, cell: ++t.cells });
        visitChildren(e);
        scopes.pop();
        return;
      }
    } else if (isDml(e, 'p')) {
      paragraph(e);
      return;
    }
    visitChildren(e);
  };
  const visitChildren = (e: RawElement): void => {
    for (const c of e.children) if (c.kind === 'element') visit(c);
  };
  visit(doc.root);
  return out;
}

/** The shape (p:sp) that holds a paragraph, if any. */
export function shapeOf(paragraph: RawElement): RawElement | undefined {
  for (let e = paragraph.parent; e !== null; e = e.parent) if (isPml(e, 'sp')) return e;
  return undefined;
}

/** The text of all paragraphs of a shape joined by line ends, for "alone in its shape" checks. */
export function shapeText(shape: RawElement, records: readonly ParagraphRecord[]): string {
  return records
    .filter((r) => shapeOf(r.element) === shape)
    .map((r) => r.text)
    .join('\n');
}
