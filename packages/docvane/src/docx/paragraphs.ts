// The text model of a WordprocessingML part: the paragraphs of a story (main body, header,
// footer, footnotes, endnotes) with their text and where it is, read in one pass of the XML
// parser with spans. Word splits the text of a paragraph into many runs (w:r) for spelling marks,
// bookmarks, changes of formatting and editing sessions, so a tag can be spread over several
// w:t elements; the paragraph text joins them so that tags are found however they are split.
//
// Which elements count (D-015; ECMA-376 Part 1 §17 to be checked, F-012 … F-016, observed in
// LibreOffice 24.2.7.2):
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
import { parseXml, type XmlSpan } from '../xml/parser';

/** WordprocessingML namespaces: Transitional and Strict (ECMA-376 Part 1 and Part 4). */
export const WML_NAMESPACES: ReadonlySet<string> = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
/** Markup Compatibility (ECMA-376 Part 3). */
const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

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

interface ParagraphBuilder {
  readonly xmlStart: number;
  readonly location: DvLocation;
  text: string;
  readonly segments: TextSegment[];
}

interface AlternateFrame {
  taken: boolean;
}

function describeContainer(c: DvContainer): string {
  return c.kind === 'table' ? `table ${String(c.table)} row ${String(c.row)} cell ${String(c.cell)}` : `text box ${String(c.textBox)}`;
}

/** Reads the paragraphs of one part, in the order in which they start. */
export function readParagraphs(xml: string, options: ReadParagraphsOptions): Paragraph[] {
  const { part, story } = options;
  const out: ParagraphBuilder[] = [];
  const storyPrefix = story === 'header' || story === 'footer' ? `${story} ${part}` : story;
  const scopes: Scope[] = [];
  const tables: TableFrame[] = [];
  const paragraphs: ParagraphBuilder[] = [];
  const alternates: AlternateFrame[] = [];
  /** Names of the open elements, `{ns}local` for WML elements, so that the parent is known. */
  const open: string[] = [];
  let notes = 0;
  /** Depth inside a skipped element (0: not skipping). */
  let skip = 0;
  /** The w:t element being read, if any. */
  let textElement: { readonly para: ParagraphBuilder; readonly textStart: number; readonly xmlStart: number } | null = null;

  const scope = (): Scope | undefined => scopes[scopes.length - 1];
  const pushScope = (within: readonly DvContainer[], prefix: string, note: number | undefined): void => {
    scopes.push({ within, prefix, note, paragraphs: 0, tables: 0, textBoxes: 0 });
  };
  const parentIs = (name: string): boolean => open[open.length - 1] === name;

  parseXml(
    xml,
    {
      start(ns, local, attrs, span: XmlSpan) {
        if (skip > 0) {
          skip++;
          return;
        }
        const wml = WML_NAMESPACES.has(ns);
        if (ns === MC_NAMESPACE) {
          if (local === 'AlternateContent') {
            const para = paragraphs[paragraphs.length - 1];
            if (para !== undefined && parentIs('w:r')) para.text += '\ufffc';
            alternates.push({ taken: false });
          } else if (local === 'Choice' || local === 'Fallback') {
            const frame = alternates[alternates.length - 1];
            if (frame === undefined || frame.taken) {
              skip = 1;
              return;
            }
            frame.taken = true;
          }
          open.push(`mc:${local}`);
          return;
        }
        if (!wml) {
          open.push(`{${ns}}${local}`);
          return;
        }
        const name = `w:${local}`;
        if (NOT_TEXT_CONTAINERS.has(local)) {
          skip = 1;
          return;
        }
        switch (local) {
          case 'body':
          case 'hdr':
          case 'ftr':
            if (scopes.length === 0) pushScope([], storyPrefix, undefined);
            break;
          case 'footnote':
          case 'endnote': {
            const type = attrs.get(`{${ns}}type`);
            if (type !== undefined && SKIPPED_NOTE_TYPES.has(type)) {
              skip = 1;
              return;
            }
            notes++;
            pushScope([], `${local} ${String(notes)}`, notes);
            break;
          }
          case 'tbl': {
            const s = scope();
            if (s !== undefined) tables.push({ scope: s, index: ++s.tables, rows: 0, cells: 0 });
            break;
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
            if (t !== undefined) {
              const container: DvContainer = { kind: 'table', table: t.index, row: t.rows, cell: ++t.cells };
              pushScope([...t.scope.within, container], `${t.scope.prefix}, ${describeContainer(container)}`, t.scope.note);
            }
            break;
          }
          case 'txbxContent': {
            const s = scope();
            if (s !== undefined) {
              const container: DvContainer = { kind: 'textBox', textBox: ++s.textBoxes };
              pushScope([...s.within, container], `${s.prefix}, ${describeContainer(container)}`, s.note);
            }
            break;
          }
          case 'p': {
            const s = scope();
            if (s !== undefined) {
              const paragraph = ++s.paragraphs;
              const location: DvLocation = {
                part,
                story,
                ...(s.note === undefined ? {} : { note: s.note }),
                ...(s.within.length === 0 ? {} : { within: s.within }),
                paragraph,
                description: `${s.prefix}, paragraph ${String(paragraph)}`,
              };
              const builder: ParagraphBuilder = { xmlStart: span.start, location, text: '', segments: [] };
              paragraphs.push(builder);
              out.push(builder);
            }
            break;
          }
          case 't': {
            const para = paragraphs[paragraphs.length - 1];
            if (para !== undefined && parentIs('w:r') && !span.empty) textElement = { para, textStart: para.text.length, xmlStart: span.end };
            break;
          }
          default: {
            const char = RUN_CHARACTERS.get(local);
            const para = paragraphs[paragraphs.length - 1];
            if (char !== undefined && para !== undefined && parentIs('w:r')) para.text += char;
          }
        }
        open.push(name);
      },
      end(ns, local, span: XmlSpan) {
        if (skip > 0) {
          skip--;
          return;
        }
        open.pop();
        if (ns === MC_NAMESPACE) {
          if (local === 'AlternateContent') alternates.pop();
          return;
        }
        if (!WML_NAMESPACES.has(ns)) return;
        switch (local) {
          case 'footnote':
          case 'endnote':
          case 'tc':
          case 'txbxContent':
            scopes.pop();
            break;
          case 'tbl':
            tables.pop();
            break;
          case 'p':
            paragraphs.pop();
            break;
          case 't':
            if (textElement !== null) {
              const { para, textStart, xmlStart } = textElement;
              if (para.text.length > textStart) para.segments.push({ textStart, textEnd: para.text.length, xmlStart, xmlEnd: span.start });
              textElement = null;
            }
            break;
          default:
        }
      },
      text(value) {
        if (skip === 0 && textElement !== null) textElement.para.text += value;
      },
    },
    { part, limits: options.limits },
  );

  out.sort((a, b) => a.xmlStart - b.xmlStart);
  return out.map((b) => {
    const segments = b.segments;
    return {
      text: b.text,
      segments,
      location: b.location,
      xmlStart: b.xmlStart,
      xmlOffset(textOffset: number): number {
        // Binary search for the segment that holds the offset.
        let lo = 0;
        let hi = segments.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const s = segments[mid] as TextSegment;
          if (textOffset < s.textStart) hi = mid - 1;
          else if (textOffset >= s.textEnd) lo = mid + 1;
          else return s.xmlStart + (textOffset - s.textStart);
        }
        return b.xmlStart;
      },
    };
  });
}
