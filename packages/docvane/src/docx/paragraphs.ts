// The text model of a WordprocessingML part: the paragraphs of a story (main body, header,
// footer, footnotes, endnotes) with their text and where it is, read from the byte-preserving
// tree of the part (../xml/raw-tree). Word splits the text of a paragraph into many runs (w:r) for
// spelling marks, bookmarks, changes of formatting and editing sessions, so a tag can be spread
// over several w:t elements; the paragraph text joins them so that tags are found however they are
// split. `inspect` and `render` read paragraphs through the same walk, so they see the same tags.
//
// Which elements count (D-015; ECMA-376 Part 1 §17 to be checked, F-010, observed in
// LibreOffice 24.2.7.2, F-011, F-012):
// - Text is the content of w:t inside w:r, at any depth inside the paragraph (hyperlinks, smart
//   tags, content controls, simple fields, custom XML, insertions).
// - w:delText, w:instrText and everything inside w:del and w:moveFrom are not text.
// - w:tab gives "\t", w:br and w:cr give "\n", w:noBreakHyphen U+2011, w:softHyphen U+00AD, and
//   inline objects (w:sym, w:drawing, w:pict, w:object, mc:AlternateContent, note references)
//   give U+FFFC, when they are children of w:r. None of them can be part of a tag.
// - Of mc:AlternateContent the first mc:Choice is read, or mc:Fallback when there is no Choice;
//   the other branches hold the same content in another form (Word writes a text box twice).
// - Paragraphs inside a text box (w:txbxContent) are paragraphs of their own.
// - Footnotes and endnotes with w:type separator, continuationSeparator or continuationNotice
//   are skipped.
import type { DvContainer, DvLocation, DvStory } from '../errors';
import type { ReadLimits } from '../limits';
import { parseRawTree, type RawDocument, type RawElement, type RawText } from '../xml/raw-tree';

/** WordprocessingML namespaces: Transitional and Strict (ECMA-376 Part 1 and Part 4). */
export const WML_NAMESPACES: ReadonlySet<string> = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
/** Markup Compatibility (ECMA-376 Part 3). */
export const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** One w:t element: its text in the paragraph and its content in the XML of the part. */
export interface TextSegment {
  readonly textStart: number;
  readonly textEnd: number;
  /** Offset of the first character of the element content, after the start tag. */
  readonly xmlStart: number;
  /** Offset of the end tag. */
  readonly xmlEnd: number;
}

/** A paragraph with its text, where its text comes from, and where it is in the document. */
export interface Paragraph {
  readonly text: string;
  readonly segments: readonly TextSegment[];
  readonly location: DvLocation;
  /** Offset of the w:p start tag in the XML. */
  readonly xmlStart: number;
  /**
   * The XML offset of a character of the text: inside the content of its w:t (exact when the
   * content has no entity or character references before it), or the paragraph start when the
   * character comes from an element such as w:tab.
   */
  xmlOffset(textOffset: number): number;
}

/** A piece of the text of a paragraph: the text of a w:t, or the character an element stands for. */
export type Piece =
  | { readonly kind: 'text'; readonly node: RawText; readonly t: RawElement; readonly run: RawElement; readonly textStart: number; readonly textEnd: number }
  | { readonly kind: 'char'; readonly element: RawElement; readonly textStart: number; readonly textEnd: number };

/** A paragraph of the tree, with the pieces its text is made of. */
export interface ParagraphRecord {
  readonly element: RawElement;
  readonly text: string;
  readonly pieces: readonly Piece[];
  readonly location: DvLocation;
  /** The mc:AlternateContent elements whose selected branch holds this paragraph, innermost last. */
  readonly alternates: readonly RawElement[];
}

export interface ReadParagraphsOptions {
  readonly part: string;
  readonly story: DvStory;
  readonly limits: ReadLimits;
}

const NOT_TEXT_CONTAINERS: ReadonlySet<string> = new Set(['del', 'moveFrom']);
const RUN_CHARACTERS: ReadonlyMap<string, string> = new Map([
  ['tab', '\t'],
  ['br', '\n'],
  ['cr', '\n'],
  ['noBreakHyphen', '\u2011'],
  ['softHyphen', '\u00ad'],
  ['sym', '\ufffc'],
  ['drawing', '\ufffc'],
  ['pict', '\ufffc'],
  ['object', '\ufffc'],
  ['footnoteReference', '\ufffc'],
  ['endnoteReference', '\ufffc'],
]);
const SKIPPED_NOTE_TYPES: ReadonlySet<string> = new Set(['separator', 'continuationSeparator', 'continuationNotice']);

/** A container in which paragraphs, tables and text boxes are counted. */
interface Scope {
  readonly within: readonly DvContainer[];
  readonly prefix: string;
  readonly note: number | undefined;
  paragraphs: number;
  tables: number;
  textBoxes: number;
}

interface TableFrame {
  readonly scope: Scope;
  readonly index: number;
  rows: number;
  cells: number;
}

interface Builder {
  readonly element: RawElement;
  readonly location: DvLocation;
  readonly alternates: readonly RawElement[];
  text: string;
  readonly pieces: Piece[];
}

const isWml = (e: RawElement, local?: string): boolean => WML_NAMESPACES.has(e.ns) && (local === undefined || e.local === local);
const isRun = (e: RawElement | null): boolean => e !== null && isWml(e, 'r');

function describeContainer(c: DvContainer): string {
  return c.kind === 'table' ? `table ${String(c.table)} row ${String(c.row)} cell ${String(c.cell)}` : `text box ${String(c.textBox)}`;
}

/** The branch of an mc:AlternateContent that is read: the first mc:Choice, else mc:Fallback. */
export function selectedBranch(alternate: RawElement): RawElement | undefined {
  let fallback: RawElement | undefined;
  for (const child of alternate.children) {
    if (child.kind !== 'element' || child.ns !== MC_NAMESPACE) continue;
    if (child.local === 'Choice') return child;
    if (child.local === 'Fallback') fallback ??= child;
  }
  return fallback;
}

/** Walks the paragraphs of one story part, in document order (a paragraph before those inside it). */
export function walkParagraphs(doc: RawDocument, options: Pick<ReadParagraphsOptions, 'part' | 'story'>): ParagraphRecord[] {
  const { part, story } = options;
  const out: Builder[] = [];
  const storyPrefix = story === 'header' || story === 'footer' ? `${story} ${part}` : story;
  const scopes: Scope[] = [];
  const tables: TableFrame[] = [];
  const paragraphs: Builder[] = [];
  const alternates: RawElement[] = [];
  let notes = 0;

  const scope = (): Scope | undefined => scopes[scopes.length - 1];
  const pushScope = (within: readonly DvContainer[], prefix: string, note: number | undefined): void => {
    scopes.push({ within, prefix, note, paragraphs: 0, tables: 0, textBoxes: 0 });
  };

  // Depth-first; the depth is bounded by the parser's maxXmlDepth.
  const visit = (e: RawElement): void => {
    const para = paragraphs[paragraphs.length - 1];
    if (e.ns === MC_NAMESPACE) {
      if (e.local === 'AlternateContent') {
        if (para !== undefined && isRun(e.parent)) {
          para.pieces.push({ kind: 'char', element: e, textStart: para.text.length, textEnd: para.text.length + 1 });
          para.text += '\ufffc';
        }
        const branch = selectedBranch(e);
        if (branch !== undefined) {
          alternates.push(e);
          visitChildren(branch);
          alternates.pop();
        }
        return;
      }
      visitChildren(e);
      return;
    }
    if (!isWml(e)) {
      visitChildren(e);
      return;
    }
    if (NOT_TEXT_CONTAINERS.has(e.local)) return;
    switch (e.local) {
      case 'body':
      case 'hdr':
      case 'ftr':
        if (scopes.length === 0) pushScope([], storyPrefix, undefined);
        visitChildren(e);
        return;
      case 'footnote':
      case 'endnote': {
        const type = e.attrs.get(`{${e.ns}}type`);
        if (type !== undefined && SKIPPED_NOTE_TYPES.has(type)) return;
        notes++;
        pushScope([], `${e.local} ${String(notes)}`, notes);
        visitChildren(e);
        scopes.pop();
        return;
      }
      case 'tbl': {
        const s = scope();
        if (s === undefined) break;
        tables.push({ scope: s, index: ++s.tables, rows: 0, cells: 0 });
        visitChildren(e);
        tables.pop();
        return;
      }
      case 'tr': {
        const t = tables[tables.length - 1];
        if (t !== undefined) {
          t.rows++;
          t.cells = 0;
        }
        break;
      }
      case 'tc': {
        const t = tables[tables.length - 1];
        if (t === undefined) break;
        const container: DvContainer = { kind: 'table', table: t.index, row: t.rows, cell: ++t.cells };
        pushScope([...t.scope.within, container], `${t.scope.prefix}, ${describeContainer(container)}`, t.scope.note);
        visitChildren(e);
        scopes.pop();
        return;
      }
      case 'txbxContent': {
        const s = scope();
        if (s === undefined) break;
        const container: DvContainer = { kind: 'textBox', textBox: ++s.textBoxes };
        pushScope([...s.within, container], `${s.prefix}, ${describeContainer(container)}`, s.note);
        visitChildren(e);
        scopes.pop();
        return;
      }
      case 'p': {
        const s = scope();
        if (s === undefined) break;
        const paragraph = ++s.paragraphs;
        const location: DvLocation = {
          part,
          story,
          ...(s.note === undefined ? {} : { note: s.note }),
          ...(s.within.length === 0 ? {} : { within: s.within }),
          paragraph,
          description: `${s.prefix}, paragraph ${String(paragraph)}`,
        };
        const builder: Builder = { element: e, location, alternates: [...alternates], text: '', pieces: [] };
        out.push(builder);
        paragraphs.push(builder);
        visitChildren(e);
        paragraphs.pop();
        return;
      }
      case 't':
        if (para !== undefined && isRun(e.parent)) {
          for (const child of e.children) {
            if (child.kind !== 'text' || child.text === '') continue;
            para.pieces.push({ kind: 'text', node: child, t: e, run: e.parent as RawElement, textStart: para.text.length, textEnd: para.text.length + child.text.length });
            para.text += child.text;
          }
        }
        return;
      default: {
        const char = RUN_CHARACTERS.get(e.local);
        if (char !== undefined && para !== undefined && isRun(e.parent)) {
          para.pieces.push({ kind: 'char', element: e, textStart: para.text.length, textEnd: para.text.length + 1 });
          para.text += char;
          return;
        }
      }
    }
    visitChildren(e);
  };
  const visitChildren = (e: RawElement): void => {
    for (const child of e.children) if (child.kind === 'element') visit(child);
  };

  visit(doc.root);
  return out.map((b) => ({ element: b.element, text: b.text, pieces: b.pieces, location: b.location, alternates: b.alternates }));
}

/** The source offset of a character of a paragraph, for ordering tags by their place in the part. */
export function sourceOffset(record: ParagraphRecord, textOffset: number): number {
  for (const piece of record.pieces) {
    if (textOffset >= piece.textStart && textOffset < piece.textEnd) {
      return piece.kind === 'text' ? piece.node.start + (textOffset - piece.textStart) : piece.element.start;
    }
  }
  return record.element.start;
}

/** Reads the paragraphs of one part, in the order in which they start. */
export function readParagraphs(xml: string, options: ReadParagraphsOptions): Paragraph[] {
  const doc = parseRawTree(xml, { part: options.part, limits: options.limits });
  return walkParagraphs(doc, options).map((record) => {
    const segments: TextSegment[] = [];
    for (const piece of record.pieces) {
      if (piece.kind !== 'text') continue;
      segments.push({ textStart: piece.textStart, textEnd: piece.textEnd, xmlStart: piece.node.start, xmlEnd: piece.node.start + piece.node.raw.length });
    }
    return {
      text: record.text,
      segments,
      location: record.location,
      xmlStart: record.element.start,
      xmlOffset: (textOffset: number): number => sourceOffset(record, textOffset),
    };
  });
}
