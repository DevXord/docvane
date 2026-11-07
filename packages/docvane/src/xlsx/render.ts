// Renders a workbook template through the public API of xlvane (D-041): editCells for values,
// insertRows and deleteRows for repeated rows, shiftFormula for the formulas of the copies. docvane
// has no code of its own that reads or writes SpreadsheetML.
//
// Rendering has two steps. The plan evaluates every tag against the data, so that all problems of
// the data are reported at once and nothing is written when there is one. Applying the plan then
// edits the file: first the cells outside sections over rows, then each such section from the
// bottom of its sheet up, so that the rows above a section keep their numbers (D-042):
// 1. no item: the rows of the section are deleted (with the rows that only mark it);
// 2. n items: n - 1 copies of the rows are inserted below them (a single row brings its row and
//    cell formats along, `style: 'above'`); every cell of the copies is written: values of tags,
//    the template's constants, its formulas moved by the offset of the copy, and the formats of
//    cells with values;
// 3. the docvane rule (D-041): areas in formulas of every sheet whose lower end is the last
//    template row now end at the last copy (./ranges.ts);
// 4. the rows that only mark the section are deleted.
// Last, formulas that still hold a cached result are written again without it (D-044): the results
// in the template are out of date, and LibreOffice shows cached results of Excel files unless it is
// set to recalculate them (F-022); a formula without a result is computed by every application.
import { deleteRows, editCells, insertRows, readWorkbook, shiftFormula, type Cell, type CellEdit, type CellInput, type Sheet, type Workbook } from 'xlvane';
import { DvError } from '../errors';
import type { ParagraphRecord } from '../docx/paragraphs';
import { limitError, type Limits } from '../limits';
import type { TagRecord } from '../template/analyze';
import { TagEvaluator, type EvalContext } from '../template/evaluator';
import type { SectionTree, TreeChild } from '../template/structure';
import { clip } from '../util/clip';
import { cellLocation, xlvaneLimits, type CellText, type RowSection, type WorkbookAnalysis } from './analyze';
import { viaXlvane } from './errors';
import { extendAreas } from './ranges';
import { compactSharedStrings } from './shared-strings';

/** The most characters a cell can hold (observed in xlvane 1.3.3, which refuses more: F-021). */
const MAX_CELL_TEXT = 32767;

/** A section over rows with the values of its tag cells, one per copy. */
interface PlannedSection {
  readonly sheet: string;
  readonly rows: RowSection;
  readonly count: number;
  readonly cells: ReadonlyMap<CellText, readonly CellInput[]>;
}

/** What to write. */
export interface WorkbookPlan {
  readonly edits: readonly CellEdit[];
  readonly sections: readonly PlannedSection[];
}

/** The tree children in each cell, with the tags that are to show nothing (those of a section over rows). */
function byCell(children: readonly TreeChild[], cellOf: ReadonlyMap<ParagraphRecord, CellText>, out: Map<CellText, TreeChild[]> = new Map()): Map<CellText, TreeChild[]> {
  for (const child of children) {
    const tag = 'tag' in child ? child.tag : child.section.open;
    const cell = cellOf.get(tag.paragraph) as CellText;
    const list = out.get(cell) ?? [];
    list.push(child);
    out.set(cell, list);
  }
  return out;
}

const startOf = (child: TreeChild): number => ('tag' in child ? child.tag.start : child.section.open.start);

class CellRenderer extends TagEvaluator {
  constructor(ctx: EvalContext) {
    super(ctx);
  }

  /** The scopes of each repetition of a section, counted against maxIterations. */
  repetitions(section: SectionTree, scopes: readonly unknown[]): (readonly unknown[])[] {
    const list = this.iterations(section, scopes);
    this.ctx.iterations += list.length;
    if (this.ctx.iterations > this.ctx.limits.maxIterations) {
      throw limitError('maxIterations', this.ctx.limits.maxIterations, `Sections repeat their content more than ${String(this.ctx.limits.maxIterations)} times in all.`, section.open.info.location);
    }
    return list;
  }

  /**
   * The value of a cell. `items` are the tree children in the cell; tags in `silent` show nothing.
   * A cell that holds one value tag and nothing else (but spaces) gets the type of the value.
   * Returns undefined when a tag has a problem, which is recorded.
   */
  cell(text: string, items: readonly TreeChild[], silent: ReadonlySet<TagRecord>, scopes: readonly unknown[]): CellInput | undefined {
    const sorted = [...items].sort((a, b) => startOf(a) - startOf(b));
    const shown = sorted.filter((c) => !('tag' in c && silent.has(c.tag)));
    const only = shown.length === 1 ? shown[0] : undefined;
    if (only !== undefined && 'tag' in only && only.tag.info.kind === 'value') {
      // Every other item is a silent tag here: the cell is typed when nothing but spaces is left around the tags.
      let rest = '';
      let pos = 0;
      for (const c of sorted) {
        rest += text.slice(pos, startOf(c));
        pos = 'tag' in c ? c.tag.end : c.section.close.end;
      }
      rest += text.slice(pos);
      if (rest.trim() === '') return this.typed(only.tag, scopes);
    }
    const out = this.range(text, 0, text.length, sorted, silent, scopes);
    if (out.length > MAX_CELL_TEXT) {
      const tag = shown[0] === undefined ? undefined : 'tag' in shown[0] ? shown[0].tag : shown[0].section.open;
      if (tag !== undefined) this.invalid(tag, `The text of the cell would have ${String(out.length)} characters.`, `A cell holds at most ${String(MAX_CELL_TEXT)} characters. Shorten the value.`);
      return undefined;
    }
    this.count(out.length, items);
    return out === '' ? null : out;
  }

  private count(length: number, items: readonly TreeChild[]): void {
    this.ctx.output += length;
    if (this.ctx.output > this.ctx.limits.maxOutputBytes) {
      const first = items[0];
      throw limitError('maxOutputBytes', this.ctx.limits.maxOutputBytes, `The result would be larger than ${String(this.ctx.limits.maxOutputBytes)} characters of text.`, first === undefined ? {} : ('tag' in first ? first.tag : first.section.open).info.location);
    }
  }

  /** The text of `text[from, to)` with its tags and sections rendered; a tag with a problem shows nothing (the problem is recorded). */
  private range(text: string, from: number, to: number, children: readonly TreeChild[], silent: ReadonlySet<TagRecord>, scopes: readonly unknown[]): string {
    let out = '';
    let pos = from;
    for (const child of children) {
      out += text.slice(pos, startOf(child));
      if ('tag' in child) {
        pos = child.tag.end;
        if (silent.has(child.tag)) continue;
        const value = this.valueText(child.tag, scopes);
        if (value !== null) out += typeof value === 'string' ? value : value.text;
        continue;
      }
      const { section } = child;
      for (const inner of this.repetitions(section, scopes)) {
        out += this.range(text, section.open.end, section.close.start, section.children, silent, inner);
        if (out.length > MAX_CELL_TEXT) break;
      }
      pos = section.close.end;
    }
    return out + text.slice(pos, to);
  }

  /** The typed value of a value tag that fills its cell. */
  private typed(tag: TagRecord, scopes: readonly unknown[]): CellInput | undefined {
    const { ok, value } = this.evaluate(tag, scopes);
    if (!ok) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value;
    if (value instanceof Date) {
      // The 1900 date system of Excel holds 1900-01-01 to 9999-12-31; checked here, so that
      // validate reports it as render would, with the place of the tag (D-071).
      const year = value.getUTCFullYear();
      if (!Number.isNaN(value.getTime()) && (year < 1900 || year > 9999)) {
        this.invalid(tag, `The date of "${clip(tag.info.raw)}" is outside the years 1900 to 9999 that Excel can hold.`, 'Pass a date from 1900 to 9999, or format it as text with | date.');
        return undefined;
      }
      // A cell holds a date and time without a zone: the time as it is in the timeZone option,
      // as the date formatter shows it (D-071).
      if (!Number.isNaN(value.getTime())) return wallClock(value, this.ctx.formatting.ctx.timeZone);
      this.invalid(tag, `The value of "${clip(tag.info.raw)}" is an invalid date.`, 'Pass a valid Date.');
      return undefined;
    }
    if (value === null) return null;
    if (value === undefined && this.ctx.missing === 'empty') {
      this.valueText(tag, scopes);
      return null;
    }
    const text = this.valueText(tag, scopes);
    if (text === null) return undefined;
    const s = typeof text === 'string' ? text : text.text;
    if (s.length > MAX_CELL_TEXT) {
      this.invalid(tag, `The value of "${clip(tag.info.raw)}" has ${String(s.length)} characters.`, `A cell holds at most ${String(MAX_CELL_TEXT)} characters. Shorten the value.`);
      return undefined;
    }
    this.count(s.length, [{ tag }]);
    return s === '' ? null : s;
  }
}

/** A Date whose UTC fields are the date and time of `date` in `timeZone`. */
function wallClock(date: Date, timeZone: string): Date {
  if (timeZone === 'UTC') return date;
  const parts: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const out = new Date(Date.UTC(2000, 0, 1, parts['hour'] ?? 0, parts['minute'] ?? 0, parts['second'] ?? 0, date.getUTCMilliseconds()));
  out.setUTCFullYear(parts['year'] ?? 1970, (parts['month'] ?? 1) - 1, parts['day'] ?? 1);
  return out;
}

/** Evaluates every tag of the workbook against the data. Problems go to `ctx.problems`. */
export function planWorkbook(analysis: WorkbookAnalysis, data: unknown, ctx: EvalContext): WorkbookPlan {
  const renderer = new CellRenderer(ctx);
  const edits: CellEdit[] = [];
  const sections: PlannedSection[] = [];
  const none = new Set<TagRecord>();
  for (const sheet of analysis.sheets) {
    const inRows = new Set<SectionTree>(sheet.rowSections.map((r) => r.section));
    const plain = sheet.tree.filter((c) => !('section' in c && inRows.has(c.section)));
    for (const [cell, items] of byCell(plain, analysis.cellOf)) {
      const value = renderer.cell(cell.paragraph.text, items, none, [data]);
      if (value !== undefined) edits.push({ sheet: sheet.sheet.name, cell: cell.cell.ref, value });
    }
    for (const rows of sheet.rowSections) {
      const { section } = rows;
      const silent = new Set<TagRecord>([section.open, section.close]);
      const cells = byCell(section.children, analysis.cellOf);
      for (const tag of silent) {
        const cell = analysis.cellOf.get(tag.paragraph) as CellText;
        const list = cells.get(cell) ?? [];
        list.push({ tag });
        cells.set(cell, list);
      }
      const repetitions = renderer.repetitions(section, [data]);
      const values = new Map<CellText, CellInput[]>();
      for (const [cell, items] of cells) {
        // Rows that only mark the section are deleted; their cells need no value.
        if (rows.markers && (cell.cell.row === rows.open || cell.cell.row === rows.close)) continue;
        const list: CellInput[] = [];
        for (const scopes of repetitions) list.push(renderer.cell(cell.paragraph.text, items, silent, scopes) ?? null);
        values.set(cell, list);
      }
      // The copies of the template rows count against maxOutputBytes here too, so that validate
      // reports what render would (D-071).
      if (repetitions.length > 1 && rows.last >= rows.first) {
        const perCopy = rowCells(sheet.sheet, rows.first, rows.last).reduce((n, cell) => n + 32 + String(cell.formula?.text ?? cell.value ?? '').length, 0);
        ctx.output += perCopy * (repetitions.length - 1);
        if (ctx.output > ctx.limits.maxOutputBytes) {
          throw limitError('maxOutputBytes', ctx.limits.maxOutputBytes, `The repeated rows would be larger than ${String(ctx.limits.maxOutputBytes)} characters.`, section.open.info.location);
        }
      }
      sections.push({ sheet: sheet.sheet.name, rows, count: repetitions.length, cells: values });
    }
  }
  return { edits, sections };
}

/** A cell value as it is in the file, to write it again in a copy. */
function copyValue(cell: Cell, sheet: Sheet, offset: number): CellInput | undefined {
  if (cell.formula !== null) {
    const { formula } = cell;
    const unsupported = (why: string): DvError =>
      new DvError('DV_E_NOT_SUPPORTED', `The formula in ${sheet.name}!${cell.ref} cannot be copied to the repeated rows: ${why}`, {
        location: cellLocation(sheet, cell.ref),
        hint: 'Move the formula out of the rows that repeat, or write it as an ordinary formula with A1 references.',
        details: { kind: formula.kind },
      });
    if (formula.kind === 'array' || formula.kind === 'dataTable') throw unsupported(formula.kind === 'array' ? 'it is an array formula.' : 'it is a data table.');
    if (formula.text === null) throw unsupported('it is a shared formula that cannot be read for this cell.');
    const moved = shiftFormula(formula.text, offset, 0);
    if (moved === null) throw unsupported('its references cannot be moved safely, or would leave the sheet.');
    return { formula: moved };
  }
  switch (cell.type) {
    case 'empty':
      return undefined;
    case 'error':
      return { error: cell.value as never };
    case 'string':
      return cell.richText === undefined ? (cell.value as string) : { richText: cell.richText };
    default:
      return cell.value;
  }
}

/** Limits for files that docvane itself wrote in an earlier step: their size grew with the repetitions, which the limits of rendering already bound. */
function ownLimits(limits: Limits): { limits: Record<string, number> } {
  return { limits: { ...xlvaneLimits(limits), maxCompressionRatio: Number.MAX_SAFE_INTEGER } };
}

/** The cells of rows `first` to `last`, with values or formats. */
function rowCells(sheet: Sheet, first: number, last: number): Cell[] {
  const out: Cell[] = [];
  for (const cell of sheet.cells()) if (cell.row >= first && cell.row <= last) out.push(cell);
  for (const cell of sheet.styledCells()) if (cell.row >= first && cell.row <= last) out.push(cell);
  return out;
}

/** The least work the sections of a plan will take (see applySection), checked before any of it is done. */
export function checkSectionWork(plan: WorkbookPlan, size: number, limits: Limits): void {
  const first = plan.sections[0];
  if (first !== undefined && plan.sections.length * size * 48 > limits.maxOutputBytes) {
    throw limitError('maxOutputBytes', limits.maxOutputBytes, `The workbook has so many repeated sections that writing them would process more than ${String(limits.maxOutputBytes)} bytes.`, first.rows.section.open.info.location);
  }
}

/** Writes the plan into the workbook. */
export function applyWorkbook(bytes: Uint8Array, plan: WorkbookPlan, limits: Limits): Uint8Array {
  const own = ownLimits(limits);
  let current = bytes;
  if (plan.edits.length > 0) current = viaXlvane(() => editCells(current, plan.edits, { limits: xlvaneLimits(limits) }).bytes, 'Writing the cells failed');
  // From the bottom of each sheet up, so that the rows above a section keep their numbers. The plan
  // lists the sections sheet by sheet from the top down; sheets do not depend on each other's order.
  const budget = { output: 0, work: 0, limits };
  checkSectionWork(plan, current.length, limits);
  for (const planned of [...plan.sections].reverse()) current = applySection(current, planned, own, budget);
  return compactSharedStrings(dropCachedResults(current, own), limits);
}

/** Writes every formula that has a cached result again without it, so that applications compute it on open. */
function dropCachedResults(bytes: Uint8Array, own: { limits: Record<string, number> }): Uint8Array {
  const workbook: Workbook = viaXlvane(() => readWorkbook(bytes, own), 'Reading the workbook failed');
  const edits: CellEdit[] = [];
  for (const sheet of workbook.sheets) {
    if (sheet.kind !== 'worksheet') continue;
    for (const cell of sheet.cells()) {
      const { formula } = cell;
      // xlvane writes no array formula; one keeps its stored result (inspect refuses those that would change, D-071).
      if (formula === null || formula.text === null || formula.kind === 'dataTable' || formula.kind === 'array' || cell.type === 'empty') continue;
      edits.push({ sheet: sheet.name, cell: cell.ref, value: { formula: formula.text } });
    }
  }
  return edits.length === 0 ? bytes : viaXlvane(() => editCells(bytes, edits, own).bytes, 'Writing the formulas failed');
}

function applySection(bytes: Uint8Array, planned: PlannedSection, own: { limits: Record<string, number> }, budget: { output: number; work: number; readonly limits: Limits }): Uint8Array {
  const { rows, count, sheet: name } = planned;
  let current = bytes;
  // Each section reads and writes the whole workbook a few times through xlvane, so many sections
  // cost their number times the size of the workbook; that work counts against maxOutputBytes
  // (D-071). The file is compressed: its size is weighted to approach the XML that is parsed.
  budget.work += current.length * 48;
  if (budget.work > budget.limits.maxOutputBytes) {
    throw limitError('maxOutputBytes', budget.limits.maxOutputBytes, `The workbook has so many repeated sections that writing them would process more than ${String(budget.limits.maxOutputBytes)} bytes.`, rows.section.open.info.location);
  }
  if (count === 0) {
    return viaXlvane(() => deleteRows(current, { sheet: name, at: rows.open, count: rows.close - rows.open + 1, ...own }).bytes, `Deleting the rows of ${clip(rows.section.open.info.raw)} failed`);
  }
  const height = rows.last - rows.first + 1;
  const added = (count - 1) * height;
  const before: Workbook = viaXlvane(() => readWorkbook(current, own), 'Reading the workbook failed');
  const sheet = before.getSheet(name);
  const template = height > 0 ? rowCells(sheet, rows.first, rows.last) : [];
  const tagCells = new Map<string, readonly CellInput[]>();
  for (const [cell, values] of planned.cells) tagCells.set(cell.cell.ref, values);

  const edits: CellEdit[] = [];
  for (const [ref, values] of tagCells) edits.push({ sheet: name, cell: ref, value: values[0] ?? null });
  if (added > 0) {
    // Every copied cell is written: count the copies against maxOutputBytes before building them (D-062).
    const perCopy = template.reduce((n, cell) => n + 32 + String(cell.formula?.text ?? cell.value ?? '').length, 0);
    budget.output += perCopy * (count - 1);
    if (budget.output > budget.limits.maxOutputBytes) {
      throw limitError('maxOutputBytes', budget.limits.maxOutputBytes, `The repeated rows would be larger than ${String(budget.limits.maxOutputBytes)} characters.`, rows.section.open.info.location);
    }
    current = viaXlvane(() => insertRows(current, { sheet: name, at: rows.last + 1, count: added, style: height === 1 ? 'above' : 'none', ...own }).bytes, `Inserting the rows of ${clip(rows.section.open.info.raw)} failed`);
    const copies: { cell: Cell; value: CellInput | undefined }[] = template.map((cell) => ({ cell, value: undefined }));
    for (let k = 1; k < count; k++) {
      const offset = k * height;
      for (const { cell } of copies) {
        const values = tagCells.get(cell.ref);
        const value = values === undefined ? copyValue(cell, sheet, offset) : (values[k] ?? null);
        if (value === undefined) continue;
        const ref = `${cell.ref.replace(/[0-9]+$/, '')}${String(cell.row + offset)}`;
        const style = height > 1 && Object.keys(cell.style).length > 0 ? cell.style : undefined;
        edits.push(style === undefined ? { sheet: name, cell: ref, value } : { sheet: name, cell: ref, value, style });
      }
    }
    // The docvane rule: areas that end on the last template row now end on the last copy (D-041).
    const after: Workbook = viaXlvane(() => readWorkbook(current, own), 'Reading the workbook failed');
    const change = { sheet: name, row: rows.last, to: rows.last + added };
    for (const other of after.sheets) {
      if (other.kind !== 'worksheet') continue;
      for (const cell of other.cells()) {
        const { formula } = cell;
        if (formula === null || formula.text === null || formula.kind === 'dataTable' || formula.kind === 'array') continue;
        if (other.name === name && cell.row >= rows.first && cell.row <= rows.last + added) continue;
        const text = extendAreas(formula.text, { ...change, formulaSheet: other.name });
        if (text === formula.text) continue;
        edits.push({ sheet: other.name, cell: cell.ref, value: { formula: text } });
      }
    }
  }
  if (edits.length > 0) current = viaXlvane(() => editCells(current, edits, own).bytes, 'Writing the repeated rows failed');
  if (rows.markers) {
    current = viaXlvane(() => deleteRows(current, { sheet: name, at: rows.close + added, ...own }).bytes, 'Deleting the row of the closing tag failed');
    current = viaXlvane(() => deleteRows(current, { sheet: name, at: rows.open, ...own }).bytes, 'Deleting the row of the opening tag failed');
  }
  return current;
}
