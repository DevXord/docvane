// Reads the tags of a workbook template through the public API of xlvane (D-041). Every text cell
// that holds a brace is a "paragraph" for the shared lexer and parser, so tags, expressions,
// formatters, sections and the schema mean the same as in documents and presentations. Formulas
// are not read for tags: braces there are array constants.
//
// Sections (D-042):
// - A section that opens and closes in one cell repeats or shows part of the cell's text.
// - A section that opens and closes in different cells repeats the rows from the row of its
//   opening tag to the row of its closing tag. When each of its two tags is alone in its row (no
//   other cell of the row has a value), those two rows only mark the section and are deleted, and
//   the rows between them repeat.
// - Rows repeat on one level: a section over rows cannot be inside another one, and every tag in
//   the rows of a section must belong to it.
import { readWorkbook, type Cell, type Sheet, type Workbook } from 'xlvane';
import { DvError, type DvLocation } from '../errors';
import { formattersOf } from '../expr/ast';
import type { Limits } from '../limits';
import type { ParagraphRecord } from '../docx/paragraphs';
import { clip } from '../util/clip';
import { makeElement, type RawElement } from '../xml/raw-tree';
import type { TagRecord } from '../template/analyze';
import { buildTree, type SectionTree, type TreeChild } from '../template/structure';
import { DEFAULT_DELIMITERS, type Delimiters } from '../template/lexer';
import { viaXlvane } from './errors';

/** A text cell with tags, and the paragraph record the lexer read it as. */
export interface CellText {
  readonly sheet: Sheet;
  readonly cell: Cell;
  readonly paragraph: ParagraphRecord;
}

/** A section that repeats rows. */
export interface RowSection {
  readonly section: SectionTree;
  /** The rows of the opening and the closing tag. */
  readonly open: number;
  readonly close: number;
  /** Whether the two tags are alone in their rows, which are then deleted. */
  readonly markers: boolean;
  /** The rows that repeat; `last < first` when there are none. */
  readonly first: number;
  readonly last: number;
}

/** One sheet: its tags in reading order (row by row), its tree and its sections over rows, top to bottom. */
export interface SheetAnalysis {
  readonly sheet: Sheet;
  readonly tags: readonly TagRecord[];
  readonly tree: readonly TreeChild[];
  readonly rowSections: readonly RowSection[];
}

/** A workbook template. */
export interface WorkbookAnalysis {
  readonly workbook: Workbook;
  readonly sheets: readonly SheetAnalysis[];
  readonly cellOf: ReadonlyMap<ParagraphRecord, CellText>;
}

// Cells have no XML element of their own in the shared paragraph record; the renderer of workbooks never looks at it.
const NO_ELEMENT: RawElement = makeElement({ ns: '', local: 'c', qname: 'c' }, '', '');

/** The location of a cell. */
export function cellLocation(sheet: Sheet, ref: string): DvLocation {
  const location: DvLocation = { story: 'sheet', sheet: sheet.name, cell: ref, description: `sheet ${sheet.name}, cell ${ref}` };
  return sheet.part === null ? location : { part: sheet.part, ...location };
}

/** The read limits of docvane in the shape xlvane takes them; xlvane's own cell limits keep their defaults. */
export function xlvaneLimits(limits: Limits): Record<string, number> {
  const { maxInputBytes, maxEntries, maxEntryBytes, maxTotalBytes, maxCompressionRatio, compressionRatioMinBytes, maxXmlDepth, maxXmlAttributes, maxXmlNameLength, maxXmlTextLength, maxXmlTreeElements } = limits;
  return { maxInputBytes, maxEntries, maxEntryBytes, maxTotalBytes, maxCompressionRatio, compressionRatioMinBytes, maxXmlDepth, maxXmlAttributes, maxXmlNameLength, maxXmlTextLength, maxXmlTreeElements };
}

function placement(tag: TagRecord, message: string, hint: string): DvError {
  return new DvError('DV_E_SECTION_PLACEMENT', message, { location: tag.info.location, hint, details: { tag: clip(tag.info.raw) } });
}

/** Tags that need what an Excel template cannot do through xlvane yet (D-043). */
function unsupported(tag: TagRecord): DvError | null {
  const raw = clip(tag.info.raw);
  if (tag.info.kind === 'image' || tag.info.kind === 'markdown') {
    const what = tag.info.kind === 'image' ? 'Images' : 'Markdown';
    return new DvError('DV_E_NOT_SUPPORTED', `${what} tags such as "${raw}" are not supported in Excel templates yet.`, {
      location: tag.info.location,
      hint: tag.info.kind === 'image' ? 'Remove the tag, or use a Word or PowerPoint template for images.' : `Write the text with a value tag instead, for example {${tag.info.path}}.`,
      details: { tag: raw },
    });
  }
  if ([...formattersOf(tag.parsed.expr), ...tag.parsed.formatters].some((f) => f.name === 'link')) {
    return new DvError('DV_E_NOT_SUPPORTED', `The link formatter in "${raw}" is not supported in Excel templates yet.`, {
      location: tag.info.location,
      hint: 'Write the address as text without "| link", or add the hyperlink to the cell in Excel.',
      details: { tag: raw },
    });
  }
  return null;
}

/** Every tag of a part of the tree, sections included. */
function collect(children: readonly TreeChild[], out: Set<TagRecord>): void {
  for (const child of children) {
    if ('tag' in child) out.add(child.tag);
    else {
      out.add(child.section.open);
      out.add(child.section.close);
      collect(child.section.children, out);
    }
  }
}

/** The section whose rows include `row`; `sections` are sorted and do not overlap. */
function sectionAt(sections: readonly RowSection[], row: number): RowSection | null {
  let lo = 0;
  let hi = sections.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sections[mid] as RowSection;
    if (row < s.open) hi = mid - 1;
    else if (row > s.close) lo = mid + 1;
    else return s;
  }
  return null;
}

/** The first tag of a tree child. */
const firstTag = (child: TreeChild): TagRecord => ('tag' in child ? child.tag : child.section.open);

/**
 * Reads the sheets of a workbook. `scan` lexes and parses paragraphs into tag records (the same
 * code as for documents) and `report` collects problems.
 */
export function analyzeWorkbook(bytes: Uint8Array, limits: Limits, scan: (paragraphs: readonly ParagraphRecord[]) => TagRecord[], report: (error: DvError) => void, delimiters: Delimiters = DEFAULT_DELIMITERS): WorkbookAnalysis {
  const workbook = viaXlvane(() => readWorkbook(bytes, { limits: xlvaneLimits(limits) }), 'Reading the workbook failed');
  const cellOf = new Map<ParagraphRecord, CellText>();
  const sheets: SheetAnalysis[] = [];
  for (const sheet of workbook.sheets) {
    if (sheet.kind !== 'worksheet') continue;
    const cells: Cell[] = [];
    for (const cell of sheet.cells()) {
      if (cell.formula === null && cell.type === 'string' && typeof cell.value === 'string' && (cell.value.includes(delimiters.start) || cell.value.includes(delimiters.end) || cell.value.includes('{'))) cells.push(cell);
    }
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    const paragraphs: ParagraphRecord[] = [];
    for (const cell of cells) {
      const paragraph: ParagraphRecord = { element: NO_ELEMENT, text: cell.value as string, pieces: [], location: cellLocation(sheet, cell.ref), alternates: [] };
      paragraphs.push(paragraph);
      cellOf.set(paragraph, { sheet, cell, paragraph });
    }
    const tags: TagRecord[] = [];
    for (const tag of scan(paragraphs)) {
      const problem = unsupported(tag);
      if (problem === null) tags.push(tag);
      else report(problem);
    }
    const tree = buildTree(tags, limits);
    for (const problem of tree.problems) report(problem);
    const rowSections = classify(sheet, tree.children, cellOf, report);
    sheets.push({ sheet, tags, tree: tree.children, rowSections });
  }
  return { workbook, sheets, cellOf };
}

/** Finds the sections over rows of one sheet and checks where they are. */
function classify(sheet: Sheet, tree: readonly TreeChild[], cellOf: ReadonlyMap<ParagraphRecord, CellText>, report: (error: DvError) => void): RowSection[] {
  const cellOfTag = (tag: TagRecord): Cell => (cellOf.get(tag.paragraph) as CellText).cell;
  const candidates: { section: SectionTree; open: Cell; close: Cell }[] = [];
  const nested = (children: readonly TreeChild[]): void => {
    for (const child of children) {
      if ('tag' in child) continue;
      const { section } = child;
      if (cellOfTag(section.open) !== cellOfTag(section.close)) {
        report(
          placement(section.open, `The section "${clip(section.open.info.raw)}" repeats rows, but it is inside another section that repeats rows.`, 'Rows repeat on one level in this version. Keep the inner section within one cell, or move it out of the outer section.'),
        );
      } else nested(section.children);
    }
  };
  for (const child of tree) {
    if ('tag' in child) continue;
    const { section } = child;
    const open = cellOfTag(section.open);
    const close = cellOfTag(section.close);
    if (open === close) continue;
    candidates.push({ section, open, close });
    nested(section.children);
  }
  if (candidates.length === 0) return [];

  // Which rows have other values, to recognise rows that hold only the tag of a section.
  const wanted = new Set<number>();
  for (const c of candidates) {
    wanted.add(c.open.row);
    wanted.add(c.close.row);
  }
  const filled = new Map<number, number>();
  for (const cell of sheet.cells()) if (wanted.has(cell.row) && (cell.type !== 'empty' || cell.formula !== null)) filled.set(cell.row, (filled.get(cell.row) ?? 0) + 1);
  const alone = (tag: TagRecord, cell: Cell): boolean => (cell.value as string).trim() === tag.info.raw && filled.get(cell.row) === 1;

  const sections: RowSection[] = [];
  // Tags already reported: those of the sections that repeat rows, and of the ones rejected here.
  const inside = new Set<TagRecord>();
  for (const c of candidates) {
    const markers = c.open.row < c.close.row && alone(c.section.open, c.open) && alone(c.section.close, c.close);
    const previous = sections[sections.length - 1];
    if (previous !== undefined && c.open.row <= previous.close) {
      report(placement(c.section.open, `The section "${clip(c.section.open.info.raw)}" starts in row ${String(c.open.row)}, which the section before it repeats.`, 'Start each section that repeats rows in a row below the end of the one before it.'));
      collect([{ section: c.section }], inside);
      continue;
    }
    sections.push({ section: c.section, open: c.open.row, close: c.close.row, markers, first: markers ? c.open.row + 1 : c.open.row, last: markers ? c.close.row - 1 : c.close.row });
  }

  // Every tag in the rows of a section belongs to it: the whole row repeats.
  for (const s of sections) collect([{ section: s.section }], inside);
  for (const child of tree) {
    const tag = firstTag(child);
    if (inside.has(tag)) continue;
    const row = cellOfTag(tag).row;
    const around = sectionAt(sections, row);
    if (around === null) continue;
    report(
      placement(
        tag,
        `The tag "${clip(tag.info.raw)}" is in row ${String(row)}, which the section "${clip(around.section.open.info.raw)}" repeats, but it is outside the section.`,
        `Move ${clip(around.section.open.info.raw)} before this tag, or move the tag to another row.`,
      ),
    );
  }
  return sections;
}
