// `preview`: the text of a document, a presentation or a workbook, to check a result without an
// office application. Documents and presentations are read with the same text model as `inspect`;
// workbooks through xlvane.
import { readWorkbook, type Cell } from 'xlvane';
import { openDocx, type StoryPart } from './docx/package';
import { walkParagraphs } from './docx/paragraphs';
import { TvError } from './errors';
import { limitError } from './limits';
import { checkOptions, type InspectOptions } from './inspect';
import type { TemplateFormat } from './model';
import { walkSlideParagraphs } from './pptx/paragraphs';
import { parseRawTree } from './xml/raw-tree';
import { viaXlvane } from './xlsx/errors';
import { xlvaneLimits } from './xlsx/analyze';

/**
 * One part of a {@link PreviewResult}: a story of a document, a slide or its notes, or a sheet.
 *
 * @example
 * ```ts
 * import { preview, type PreviewPart } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const first: PreviewPart | undefined = preview(bytes).parts[0];
 * console.log(first?.name, first?.lines.length);
 * ```
 */
export interface PreviewPart {
  /** The part in words: `body`, `header /word/header1.xml`, `footnotes`, `slide 2`, `slide 2 notes`, `sheet Data`. */
  readonly name: string;
  /** Paragraphs of a document or slide; rows of a sheet, with cells separated by tabs. */
  readonly lines: readonly string[];
}

/**
 * The result of {@link preview}.
 *
 * @example
 * ```ts
 * import { preview, type PreviewResult } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const result: PreviewResult = preview(bytes);
 * console.log(result.format, result.parts.map((part) => part.name));
 * ```
 */
export interface PreviewResult {
  readonly format: TemplateFormat;
  readonly parts: readonly PreviewPart[];
  /** Every part as `== name` followed by its lines, each line ending with a line feed. */
  readonly text: string;
}

const OBJECT = '￼';

/** The name of a story in {@link preview} (and in the `where` of makeTemplate): `body`, `header /word/header1.xml`, `footnotes`, `slide 2`, `slide 2 notes`. */
export function storyName(story: StoryPart): string {
  if (story.story === 'slide') return `slide ${String(story.slide ?? 0)}`;
  if (story.story === 'notes') return `slide ${String(story.slide ?? 0)} notes`;
  if (story.story === 'header' || story.story === 'footer') return `${story.story} ${story.part}`;
  if (story.story === 'footnote' || story.story === 'endnote') return `${story.story}s`;
  return story.story;
}

function cellText(cell: Cell): string {
  if (cell.formula !== null && cell.type === 'empty') return `=${cell.formula.text ?? ''}`;
  const v = cell.value;
  if (v === null) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace(/\.000$/, '');
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/**
 * Returns the text of a Word document, a PowerPoint presentation or an Excel workbook, part by part:
 * the paragraphs of the body, headers, footers and notes of a document (tables cell by cell);
 * the paragraphs of each slide and its notes; the rows of each sheet with cells separated by tabs,
 * dates as ISO 8601 text, and formulas without a stored result (as `render` writes them) as
 * `=formula`. Pictures and other objects in text show as `[object]`. Use it to check a rendered
 * result without an office application.
 *
 * Throws {@link TvError} for input that is not such a file, as {@link inspect} does.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { preview } from 'tplvane';
 *
 * console.log(preview(readFileSync('offer-filled.docx')).text);
 * ```
 */
export function preview(document: Uint8Array, options?: InspectOptions): PreviewResult {
  if (!(document instanceof Uint8Array)) {
    throw new TvError('TV_E_INVALID_INPUT', 'The document must be a Uint8Array (a Node.js Buffer is one).', {
      hint: 'Read the file into bytes first, for example preview(readFileSync("offer-filled.docx")).',
    });
  }
  const limits = checkOptions(options, ['limits'], 'preview');
  const docx = openDocx(document, limits);
  const parts: PreviewPart[] = [];
  // The text is counted against maxOutputBytes as it grows: a workbook can name a cell in its last
  // column or row, which would otherwise pad the text with millions of tabs or lines (D-071).
  let size = 0;
  const add = (n: number): void => {
    size += n;
    if (size > limits.maxOutputBytes) throw limitError('maxOutputBytes', limits.maxOutputBytes, `The text would be longer than ${String(limits.maxOutputBytes)} characters.`);
  };
  if (docx.format === 'xlsx') {
    const workbook = viaXlvane(() => readWorkbook(document, { limits: xlvaneLimits(limits) }), 'Reading the workbook failed');
    for (const sheet of workbook.sheets) {
      if (sheet.kind !== 'worksheet') continue;
      const lines: string[] = [];
      for (const row of sheet.rows()) {
        const first = row[0];
        if (first === undefined) continue;
        while (lines.length < first.row - 1) {
          add(1);
          lines.push('');
        }
        const cells: string[] = [];
        for (const cell of row) {
          while (cells.length < cell.col - 1) {
            add(1);
            cells.push('');
          }
          const text = cellText(cell);
          add(text.length + 1);
          cells.push(text);
        }
        while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        lines.push(cells.join('\t'));
      }
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      parts.push({ name: `sheet ${sheet.name}`, lines });
    }
  } else {
    for (const story of docx.stories) {
      const xml = docx.pkg.readXml(story.part);
      if (xml === undefined) continue;
      const doc = parseRawTree(xml, { part: story.part, limits });
      const paragraphs = docx.format === 'pptx' ? walkSlideParagraphs(doc, { part: story.part, story: story.story, slide: story.slide ?? 0 }) : walkParagraphs(doc, story);
      const name = storyName(story);
      const lines = paragraphs.map((p) => p.text.split(OBJECT).join('[object]'));
      for (const line of lines) add(line.length + 1);
      parts.push({ name, lines });
    }
  }
  const text = parts.map((part) => `== ${part.name}\n${part.lines.map((l) => `${l}\n`).join('')}`).join('');
  return { format: docx.format, parts, text };
}
