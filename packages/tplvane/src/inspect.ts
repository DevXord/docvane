// `inspect`: the tags, sections and data schema of a template, without data.
import { TvError } from './errors';
import { resolveLimits, type Limits } from './limits';
import type { InspectResult, SectionNode, TagInfo } from './model';
import { inferSchema } from './schema';
import { analyzeTemplate } from './template/analyze';
import { DEFAULT_DELIMITERS, delimiterProblem, type Delimiters } from './template/lexer';
import { toSectionNode } from './template/structure';
import { clip } from './util/clip';

/**
 * Options of {@link inspect}.
 *
 * @example
 * ```ts
 * import { inspect, type InspectOptions } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const options: InspectOptions = { limits: { maxTags: 10_000 } };
 * console.log(inspect(bytes, options).tags.length);
 * ```
 */
export interface InspectOptions {
  /** Changes some of the {@link Limits}; the others keep their defaults. */
  readonly limits?: Partial<Limits>;
  /**
   * The strings that start and end a tag, for example `{ start: '{{', end: '}}' }` or
   * `{ start: '[[', end: ']]' }`. Default `{` and `}`. A template can also change them with a tag
   * such as `{=[[ ]]=}`.
   */
  readonly delimiters?: { readonly start: string; readonly end: string };
}

const OPTION_NAMES: readonly string[] = ['limits', 'delimiters'];

/** The `delimiters` option, checked. */
export function delimitersOption(options: unknown): Delimiters {
  const value: unknown = options === null || typeof options !== 'object' ? undefined : (options as { delimiters?: unknown }).delimiters;
  if (value === undefined) return DEFAULT_DELIMITERS;
  const start = value !== null && typeof value === 'object' ? (value as { start?: unknown }).start : undefined;
  const end = value !== null && typeof value === 'object' ? (value as { end?: unknown }).end : undefined;
  if (typeof start !== 'string' || typeof end !== 'string') {
    throw new TvError('TV_E_INVALID_OPTION', 'Option "delimiters" must be an object with "start" and "end" strings.', { hint: "Pass for example { delimiters: { start: '{{', end: '}}' } }.", details: { option: 'delimiters' } });
  }
  const problem = delimiterProblem({ start, end });
  if (problem !== null) throw new TvError('TV_E_INVALID_OPTION', `Option "delimiters" is not valid: ${problem}.`, { hint: "Use two different strings without spaces, such as { start: '[[', end: ']]' }.", details: { option: 'delimiters' } });
  return { start, end };
}

/** Validates the options shared by inspect and render, and returns the limits. */
export function checkOptions(options: unknown, names: readonly string[] = OPTION_NAMES, what = 'inspect'): Limits {
  if (options === undefined) return resolveLimits(undefined);
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TvError('TV_E_INVALID_OPTION', `The options of ${what} must be an object.`, {
      hint: 'Pass an object such as { limits: { maxTags: 1000 } }, or no options.',
    });
  }
  for (const key of Object.keys(options)) {
    if (!names.includes(key)) {
      throw new TvError('TV_E_INVALID_OPTION', `Unknown option "${clip(key)}".`, {
        hint: `Known options: ${names.join(', ')}.`,
        details: { option: clip(key), known: names },
      });
    }
  }
  return resolveLimits((options as { limits?: unknown }).limits);
}

/**
 * Reads a template and returns its tags, its sections (loops and conditions) and the JSON Schema
 * of the data it needs. Tags are found however the word processor split their text, in the main
 * body, tables, text boxes, headers, footers, footnotes and endnotes of a document, in the shapes,
 * tables and notes of a presentation, and in the text cells of every sheet of a workbook. Nothing
 * is rendered.
 *
 * Throws {@link TvError}: `TV_E_TEMPLATE_INVALID` lists every problem with a tag or section in
 * `errors` (up to `limits.maxErrors`), each with its code, place and hint;
 * `TV_E_NOT_SUPPORTED` for other formats; ZIP, XML, package and limit errors for damaged or
 * hostile files.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { inspect } from 'tplvane';
 *
 * const result = inspect(readFileSync('offer.docx'));
 * for (const tag of result.tags) console.log(tag.raw, '-', tag.location.description);
 * console.log(JSON.stringify(result.schema, null, 2));
 * ```
 */
export function inspect(template: Uint8Array, options?: InspectOptions): InspectResult {
  if (!(template instanceof Uint8Array)) {
    throw new TvError('TV_E_INVALID_INPUT', 'The template must be a Uint8Array (a Node.js Buffer is one).', {
      hint: 'Read the file into bytes first, for example inspect(readFileSync("offer.docx")) or inspect(new Uint8Array(await file.arrayBuffer())).',
    });
  }
  const limits = checkOptions(options);
  const analysis = analyzeTemplate(template, limits, delimitersOption(options));
  const tags: TagInfo[] = [];
  const sections: SectionNode[] = [];
  for (const tag of analysis.tags) tags.push(tag.info);
  for (const tree of analysis.trees) for (const child of tree) if ('section' in child) sections.push(toSectionNode(child.section));
  const { schema, warnings } = inferSchema(analysis.trees);
  return { format: analysis.docx.format, tags, sections, schema, warnings: [...analysis.docx.warnings, ...warnings] };
}
