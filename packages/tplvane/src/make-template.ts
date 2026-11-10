// `makeTemplate` (D-079): turns sample text of a finished document, presentation or workbook into
// tags. Each entry names a plain text (no regular expressions) and the tag or template text that
// replaces it. Every match is found on the original first, in one paragraph or one text cell,
// however the text is split into runs; then the paragraphs are rewritten with the code render uses
// to isolate tags (docx/normalize.ts), so a tag keeps the formatting of the first run of its match.
// Workbooks go through xlvane (editCells), and only text cells are read. The result must be a
// valid template: it is checked with inspect, whose schema is returned.
import { editCells, readWorkbook, type Cell, type CellEdit, type CellInput, type RichTextRun, type Sheet } from 'xlvane';
import { openDocx } from './docx/package';
import { isolateTags, WML_DIALECT, type TextDialect } from './docx/normalize';
import { MC_NAMESPACE, selectedBranch, walkParagraphs, type ParagraphRecord } from './docx/paragraphs';
import { TvError, type TvLocation, type TvWarning } from './errors';
import { checkOptions, delimitersOption, inspect } from './inspect';
import { limitError, type Limits } from './limits';
import type { JsonSchema } from './model';
import { isPartName, partKey, zipNameToPartName } from './opc/part-name';
import { DML_DIALECT } from './pptx/render';
import { walkSlideParagraphs } from './pptx/paragraphs';
import { storyName } from './preview';
import { lexText, type Delimiters } from './template/lexer';
import { scanParagraph, type TagRecord } from './template/analyze';
import { clip } from './util/clip';
import { makeElement, parseRawTree, serialize, type RawDocument } from './xml/raw-tree';
import { cellLocation, xlvaneLimits } from './xlsx/analyze';
import { viaXlvane } from './xlsx/errors';
import { writeZip, type ZipWriteEntry } from './zip/writer';

/**
 * One entry of {@link makeTemplate}: a text of the document and what replaces it. Give exactly one
 * of `tag` and `with`.
 *
 * @example
 * ```ts
 * import type { TemplateReplacement } from 'tplvane';
 *
 * const entries: TemplateReplacement[] = [
 *   { find: 'Jan Kowalski', tag: 'customer.name' },
 *   { find: 'Laptop', with: '{#items}{name}' },
 *   { find: 'ACME', tag: 'company', where: 'footer' },
 *   { find: 'Anna', tag: 'author', occurrence: 1 },
 * ];
 * console.log(entries.length);
 * ```
 */
export interface TemplateReplacement {
  /** The text to replace, exactly as {@link preview} shows it, with letter case, within one paragraph or cell; a space also matches a no-break space. */
  readonly find: string;
  /** The content of a tag, without delimiters: `customer.name`, `price | currency("PLN")`, `#items`. */
  readonly tag?: string;
  /** Template text written as it is: tags with their delimiters, and text around them. */
  readonly with?: string;
  /** Only in the parts whose name, as {@link preview} shows it, is this or starts with it and a space: `body`, `header`, `footer`, `footnotes`, `slide 2`, `slide 2 notes`, `sheet Data`. */
  readonly where?: string;
  /** Only this match, counted from 1 in reading order; by default every match. */
  readonly occurrence?: number;
}

/**
 * What {@link makeTemplate} did for one entry: how many texts it replaced, and where.
 *
 * @example
 * ```ts
 * import { makeTemplate, type ReplacementReport } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const report: ReplacementReport | undefined = makeTemplate(bytes, [{ find: 'ACME', tag: 'company' }]).replacements[0];
 * console.log(report?.count, report?.locations[0]?.description);
 * ```
 */
export interface ReplacementReport {
  readonly find: string;
  readonly count: number;
  /** Where each match started in the original, with its `character` counted from 1. */
  readonly locations: readonly TvLocation[];
}

/**
 * The result of {@link makeTemplate}.
 *
 * @example
 * ```ts
 * import { makeTemplate, type MakeTemplateResult } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const result: MakeTemplateResult = makeTemplate(bytes, [{ find: 'ACME', tag: 'company' }]);
 * console.log(result.document.length, JSON.stringify(result.schema));
 * ```
 */
export interface MakeTemplateResult {
  /** The new template. */
  readonly document: Uint8Array;
  /** One report per entry, in the order of the entries. */
  readonly replacements: readonly ReplacementReport[];
  /** The JSON Schema of the data the new template needs, as {@link inspect} returns it. */
  readonly schema: JsonSchema;
  /** The warnings of {@link inspect} for the new template. */
  readonly warnings: readonly TvWarning[];
}

/**
 * Options of {@link makeTemplate}.
 *
 * @example
 * ```ts
 * import { makeTemplate, type MakeTemplateOptions } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const options: MakeTemplateOptions = { delimiters: { start: '[[', end: ']]' } };
 * console.log(makeTemplate(bytes, [{ find: 'ACME', tag: 'company' }], options).replacements[0]?.count);
 * ```
 */
export interface MakeTemplateOptions {
  /** Changes some of the {@link Limits}; the others keep their defaults. */
  readonly limits?: Partial<Limits>;
  /** The delimiters of the tags that `tag` writes and that `with` and the document are read with; default `{` and `}`. */
  readonly delimiters?: { readonly start: string; readonly end: string };
}

/** A text that can be searched: a paragraph of a story, or a text cell of a sheet. */
interface Unit {
  readonly part: string;
  readonly text: string;
  readonly location: TvLocation;
  /** Where tags of the document already are. */
  readonly tags: readonly { readonly start: number; readonly end: number; readonly raw: string }[];
  readonly paragraph?: ParagraphRecord;
  readonly cell?: { readonly sheet: Sheet; readonly cell: Cell };
}

interface Entry {
  readonly index: number;
  readonly find: string;
  readonly text: string;
  readonly where: string | undefined;
  readonly occurrence: number | undefined;
}

interface Match {
  readonly entry: Entry;
  readonly unit: Unit;
  readonly start: number;
  readonly end: number;
}

const option = (index: number, message: string, hint: string): TvError => new TvError('TV_E_INVALID_OPTION', `Entry ${String(index + 1)}: ${message}`, { hint, details: { entry: index + 1 } });

/** Checks that `text` is template text with valid tags, read with `delimiters`; throws the first problem. */
function checkTemplateText(text: string, index: number, delimiters: Delimiters, limits: Limits, single: boolean): void {
  const paragraph: ParagraphRecord = { element: makeElement({ ns: '', local: 'p', qname: 'p' }, '', ''), text, pieces: [], location: { description: `entry ${String(index + 1)}` }, alternates: [] };
  const problems: TvError[] = [];
  const records: TagRecord[] = [];
  const after = scanParagraph(paragraph, delimiters, limits, 1, (e) => problems.push(e), () => undefined, records);
  const first = problems[0];
  if (first !== undefined) throw first;
  if (after.start !== delimiters.start || after.end !== delimiters.end) throw option(index, 'it changes the delimiters.', 'Write tags with the delimiters of the document; set other ones with the "delimiters" option.');
  if (single && (records.length !== 1 || records[0]?.start !== 0 || records[0].end !== text.length)) {
    throw new TvError('TV_E_TAG_SYNTAX', `Entry ${String(index + 1)}: "${clip(text)}" is not one tag.`, { location: paragraph.location, hint: 'Give the content of one tag in "tag", such as "customer.name"; write several tags or text around them in "with".', details: { entry: index + 1, tag: clip(text) } });
  }
}

/** Reads and checks the entries. */
function readEntries(replacements: unknown, delimiters: Delimiters, limits: Limits): Entry[] {
  if (!Array.isArray(replacements)) throw new TvError('TV_E_INVALID_OPTION', 'The replacements must be an array of entries such as { find: "ACME", tag: "company" }.', { hint: 'Pass a list, for example makeTemplate(bytes, [{ find: "Jan Kowalski", tag: "customer.name" }]).' });
  if (replacements.length > limits.maxTags) throw limitError('maxTags', limits.maxTags, `There are more than ${String(limits.maxTags)} entries.`);
  return replacements.map((raw: unknown, index): Entry => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw option(index, 'it must be an object.', 'Write each entry as { find: "…", tag: "…" } or { find: "…", with: "…" }.');
    const e = raw as Record<string, unknown>;
    for (const key of Object.keys(e)) if (!['find', 'tag', 'with', 'where', 'occurrence'].includes(key)) throw option(index, `unknown field "${clip(key)}".`, 'The fields of an entry are find, tag, with, where and occurrence.');
    const { find, tag, where, occurrence } = e;
    const replacement = e['with'];
    if (typeof find !== 'string' || find === '') throw option(index, '"find" must be a text that is not empty.', 'Copy the text from the output of preview.');
    if (find.length > limits.maxXmlTextLength) throw limitError('maxXmlTextLength', limits.maxXmlTextLength, `Entry ${String(index + 1)}: "find" is longer than ${String(limits.maxXmlTextLength)} characters.`);
    if ((tag === undefined) === (replacement === undefined)) throw option(index, 'give exactly one of "tag" and "with".', 'Use "tag" for the content of one tag, such as "customer.name", and "with" for template text, such as "{#items}{name}".');
    if (tag !== undefined && typeof tag !== 'string') throw option(index, '"tag" must be a text.', 'Give the content of the tag without delimiters, such as "customer.name".');
    if (replacement !== undefined && typeof replacement !== 'string') throw option(index, '"with" must be a text.', 'Give template text, such as "{#items}{name}".');
    if (where !== undefined && (typeof where !== 'string' || where === '')) throw option(index, '"where" must be the name of a part, as preview shows it.', 'Use for example "body", "header", "footer", "slide 2" or "sheet Data".');
    if (occurrence !== undefined && (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 1)) throw option(index, '"occurrence" must be a whole number from 1.', 'Leave it out to replace every match, or give the number of the match in reading order.');
    const text = typeof tag === 'string' ? `${delimiters.start}${tag}${delimiters.end}` : (replacement as string);
    checkTemplateText(text, index, delimiters, limits, typeof tag === 'string');
    return { index, find, text, where: where as string | undefined, occurrence: occurrence as number | undefined };
  });
}

/** The tags already in a text, read with the delimiters in force there; returns the delimiters after it. */
function existingTags(text: string, delimiters: Delimiters, limits: Limits): { tags: Unit['tags']; delimiters: Delimiters } {
  const lexed = lexText(text, limits.maxTagLength, 0, delimiters);
  return { tags: lexed.tags.map((t) => ({ start: t.start, end: t.end, raw: t.raw })), delimiters: lexed.delimiters };
}

/**
 * The text as it is searched: a no-break space (U+00A0, U+202F, U+2007) counts as a space, since
 * number and currency formats and word processors write them and preview shows them as spaces
 * (D-085). One character stands for one, so offsets stay those of the original.
 */
const searchable = (text: string): string => text.replace(/[\u00a0\u202f\u2007]/g, ' ');

const inPart = (part: string, where: string | undefined): boolean => where === undefined || part === where || part.startsWith(`${where} `);

/** Whether `[start, end)` of a paragraph is text of w:t or a:t only, not a tab, a break or an object. */
function onlyText(paragraph: ParagraphRecord | undefined, start: number, end: number): boolean {
  if (paragraph === undefined) return true;
  return paragraph.pieces.every((piece) => piece.kind === 'text' || piece.textEnd <= start || piece.textStart >= end);
}

/** A rich text with the matches replaced; the replacement takes the font of the run where its match starts. */
function replaceRich(runs: readonly RichTextRun[], matches: readonly Match[]): RichTextRun[] {
  const out: RichTextRun[] = [];
  const push = (text: string, font: RichTextRun['font']): void => {
    if (text !== '') out.push(font === undefined ? { text } : { text, font });
  };
  let offset = 0;
  let m = 0;
  for (const run of runs) {
    const runEnd = offset + run.text.length;
    let at = offset;
    while (at < runEnd) {
      const match = matches[m];
      if (match === undefined || match.start >= runEnd) {
        push(run.text.slice(at - offset), run.font);
        break;
      }
      if (match.start > at) {
        push(run.text.slice(at - offset, match.start - offset), run.font);
        at = match.start;
      }
      if (match.start === at) push(match.entry.text, run.font);
      // Skip the matched text, which may go on in the next runs.
      const skipTo = Math.min(match.end, runEnd);
      at = skipTo;
      if (match.end <= runEnd) m++;
    }
    offset = runEnd;
  }
  return out;
}

const NOT_FOUND_HINT = 'Copy the text exactly as preview shows it, with letter case: a match lies within one paragraph or cell, and does not cross a tab, a line break or an object. Check "where" and "occurrence".';

/**
 * Turns texts of a finished Word document, PowerPoint presentation or Excel workbook into tags: a
 * template made from a real example. Each entry names a plain text (`find`) and either the content
 * of one tag (`tag`, written with the delimiters) or template text (`with`). Every match is found
 * in the original first, within one paragraph or one text cell however the text is split into runs,
 * in the body, tables, text boxes, headers, footers, footnotes and endnotes, slides and their notes,
 * and the text cells of sheets; numbers, dates and formulas are not read. A tag keeps the
 * formatting of the first run of its match.
 *
 * Throws {@link TvError}: `TV_E_TEXT_NOT_FOUND` lists every entry without a match;
 * `TV_E_REPLACEMENT_OVERLAP` when two matches, or a match and a tag of the document, overlap;
 * `TV_E_TEMPLATE_INVALID` when the result is not a valid template (for example a loop that is
 * opened and not closed), with the problems of {@link inspect}; `TV_E_INVALID_OPTION` and tag
 * errors for wrong entries. Nothing is returned then.
 *
 * @example
 * ```ts
 * import { readFileSync, writeFileSync } from 'node:fs';
 * import { makeTemplate } from 'tplvane';
 *
 * const result = makeTemplate(readFileSync('offer-for-jan.docx'), [
 *   { find: 'Jan Kowalski', tag: 'customer.name' },
 *   { find: 'Laptop', with: '{#items}{name}' },
 *   { find: '4 500,00 zł', with: '{price | currency("PLN")}{/items}' },
 * ]);
 * writeFileSync('offer.docx', result.document);
 * console.log(result.replacements.map((r) => `${r.find}: ${String(r.count)}`), result.schema);
 * ```
 */
export function makeTemplate(document: Uint8Array, replacements: readonly TemplateReplacement[], options?: MakeTemplateOptions): MakeTemplateResult {
  if (!(document instanceof Uint8Array)) {
    throw new TvError('TV_E_INVALID_INPUT', 'The document must be a Uint8Array (a Node.js Buffer is one).', { hint: 'Read the file into bytes first, for example makeTemplate(readFileSync("offer.docx"), entries).' });
  }
  const limits = checkOptions(options, ['limits', 'delimiters'], 'makeTemplate');
  const delimiters = delimitersOption(options);
  const entries = readEntries(replacements, delimiters, limits);
  const docx = openDocx(document, limits);

  // The searchable texts, in reading order.
  const units: Unit[] = [];
  const docs = new Map<string, RawDocument>();
  let sheets: readonly Sheet[] = [];
  if (docx.format === 'xlsx') {
    const workbook = viaXlvane(() => readWorkbook(document, { limits: xlvaneLimits(limits) }), 'Reading the workbook failed');
    sheets = workbook.sheets.filter((s) => s.kind === 'worksheet');
    for (const sheet of sheets) {
      let current = delimiters;
      const cells = [...sheet.cells()].filter((c) => c.formula === null && c.type === 'string' && typeof c.value === 'string').sort((a, b) => a.row - b.row || a.col - b.col);
      for (const cell of cells) {
        const text = cell.value as string;
        const found = existingTags(text, current, limits);
        current = found.delimiters;
        units.push({ part: `sheet ${sheet.name}`, text, location: cellLocation(sheet, cell.ref), tags: found.tags, cell: { sheet, cell } });
      }
    }
  } else {
    for (const story of docx.stories) {
      const xml = docx.pkg.readXml(story.part);
      if (xml === undefined) continue;
      const doc = parseRawTree(xml, { part: story.part, limits });
      docs.set(story.part, doc);
      const paragraphs = docx.format === 'pptx' ? walkSlideParagraphs(doc, { part: story.part, story: story.story, slide: story.slide ?? 0 }) : walkParagraphs(doc, story);
      const part = storyName(story);
      let current = delimiters;
      for (const paragraph of paragraphs) {
        const found = existingTags(paragraph.text, current, limits);
        current = found.delimiters;
        units.push({ part, text: paragraph.text, location: { ...paragraph.location, part: story.part }, tags: found.tags, paragraph });
      }
    }
  }
  // Every entry reads every text once: their product is the work, counted against maxOutputBytes (D-071).
  const textLength = units.reduce((n, u) => n + u.text.length, 0);
  if (entries.length * textLength > limits.maxOutputBytes) throw limitError('maxOutputBytes', limits.maxOutputBytes, `Searching ${String(entries.length)} entries in ${String(textLength)} characters of text is more work than ${String(limits.maxOutputBytes)} allows.`);

  // Find every match on the original.
  const matches: Match[] = [];
  const missing: TvError[] = [];
  for (const entry of entries) {
    let seen = 0;
    let kept = 0;
    const find = searchable(entry.find);
    for (const unit of units) {
      if (!inPart(unit.part, entry.where)) continue;
      const text = searchable(unit.text);
      for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) {
        const end = at + entry.find.length;
        if (!onlyText(unit.paragraph, at, end)) continue;
        seen++;
        if (entry.occurrence !== undefined && seen !== entry.occurrence) continue;
        if (matches.length >= limits.maxTags) throw limitError('maxTags', limits.maxTags, `The entries match more than ${String(limits.maxTags)} texts.`, unit.location);
        matches.push({ entry, unit, start: at, end });
        kept++;
      }
    }
    if (kept === 0) {
      const message =
        entry.occurrence !== undefined && seen > 0
          ? `The text "${clip(entry.find)}" occurs ${String(seen)} time${seen === 1 ? '' : 's'}${entry.where === undefined ? '' : ` in ${clip(entry.where)}`}, so there is no occurrence ${String(entry.occurrence)} (entry ${String(entry.index + 1)}).`
          : `The text "${clip(entry.find)}" is not in the document${entry.where === undefined ? '' : ` (in ${clip(entry.where)})`} (entry ${String(entry.index + 1)}).`;
      missing.push(new TvError('TV_E_TEXT_NOT_FOUND', message, { hint: NOT_FOUND_HINT, details: { entry: entry.index + 1, find: clip(entry.find), found: seen } }));
    }
  }
  if (missing.length > 0) {
    const first = missing[0] as TvError;
    throw new TvError('TV_E_TEXT_NOT_FOUND', missing.length === 1 ? first.message : `${String(missing.length)} entries have no match. The first: ${first.message}`, { hint: NOT_FOUND_HINT, details: { count: missing.length }, errors: missing });
  }

  // Overlaps, per text.
  const byUnit = new Map<Unit, Match[]>();
  for (const match of matches) {
    const list = byUnit.get(match.unit) ?? [];
    list.push(match);
    byUnit.set(match.unit, list);
  }
  for (const [unit, list] of byUnit) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      const match = list[i] as Match;
      const location = { ...unit.location, character: match.start + 1 };
      const previous = list[i - 1];
      if (previous !== undefined && previous.end > match.start) {
        throw new TvError('TV_E_REPLACEMENT_OVERLAP', `The text "${clip(match.entry.find)}" (entry ${String(match.entry.index + 1)}) overlaps "${clip(previous.entry.find)}" (entry ${String(previous.entry.index + 1)}).`, {
          location,
          hint: 'Make the entries find different parts of the text, or replace both with one entry and "with".',
          details: { entry: match.entry.index + 1, other: previous.entry.index + 1 },
        });
      }
      const tag = unit.tags.find((t) => t.start < match.end && match.start < t.end);
      if (tag !== undefined) {
        throw new TvError('TV_E_REPLACEMENT_OVERLAP', `The text "${clip(match.entry.find)}" (entry ${String(match.entry.index + 1)}) overlaps the tag "${clip(tag.raw)}" already in the document.`, {
          location,
          hint: 'Leave the tags of the document out of "find"; replace the text around them.',
          details: { entry: match.entry.index + 1, tag: clip(tag.raw) },
        });
      }
    }
  }

  // Rewrite.
  let output: Uint8Array;
  if (docx.format === 'xlsx') {
    const edits: CellEdit[] = [];
    for (const [unit, list] of byUnit) {
      const { sheet, cell } = unit.cell as NonNullable<Unit['cell']>;
      let value: CellInput;
      if (cell.richText !== undefined) value = { richText: replaceRich(cell.richText, list) };
      else {
        let text = '';
        let at = 0;
        for (const match of list) {
          text += unit.text.slice(at, match.start) + match.entry.text;
          at = match.end;
        }
        value = text + unit.text.slice(at);
      }
      edits.push({ sheet: sheet.name, cell: cell.ref, value });
    }
    output = edits.length === 0 ? document : viaXlvane(() => editCells(document, edits, { limits: xlvaneLimits(limits) }).bytes, 'Writing the cells failed');
  } else {
    const dialect: TextDialect = docx.format === 'pptx' ? DML_DIALECT : WML_DIALECT;
    const changed = new Map<string, string>();
    const touched = new Set<string>();
    for (const [unit, list] of byUnit) {
      const paragraph = unit.paragraph as ParagraphRecord;
      // The paragraph's tags for isolateTags: only their place and the text the anchor gets.
      isolateTags(paragraph, list.map((m) => ({ start: m.start, end: m.end, info: { raw: m.entry.text } }) as unknown as TagRecord), dialect);
      // The other form of a text box would keep the old text: only the branch that is read stays, as in render.
      for (const alternate of paragraph.alternates) {
        const selected = selectedBranch(alternate);
        alternate.children = alternate.children.filter((c) => c.kind !== 'element' || c.ns !== MC_NAMESPACE || c === selected);
      }
      touched.add(unit.location.part as string);
    }
    for (const part of touched) changed.set(partKey(part), serialize(docs.get(part) as RawDocument));
    const encoder = new TextEncoder();
    const { zip } = docx;
    const kept = (name: string): boolean => name.toLowerCase() === '[content_types].xml' || (isPartName(zipNameToPartName(name)) && !name.includes(':'));
    const entriesOut: ZipWriteEntry[] = zip.entries
      .filter((entry) => kept(entry.name))
      .map((entry) => {
        const xml = changed.get(partKey(zipNameToPartName(entry.name)));
        if (xml !== undefined) return { name: entry.name, data: encoder.encode(xml) };
        const raw = zip.raw(entry);
        return raw === null ? { name: entry.name, data: zip.read(entry) } : { name: entry.name, data: new Uint8Array(0), raw };
      });
    output = writeZip(entriesOut);
  }

  const checked = inspect(output, { limits, delimiters });
  const byEntry = new Map<Entry, TvLocation[]>(entries.map((e) => [e, []]));
  for (const m of matches) byEntry.get(m.entry)?.push({ ...m.unit.location, character: m.start + 1 });
  const reports: ReplacementReport[] = entries.map((entry) => {
    const locations = byEntry.get(entry) ?? [];
    return { find: entry.find, count: locations.length, locations };
  });
  return { document: output, replacements: reports, schema: checked.schema, warnings: checked.warnings };
}
