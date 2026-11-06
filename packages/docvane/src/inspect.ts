// `inspect`: the tags, sections and data schema of a template, without data.
import { DvError } from './errors';
import { resolveLimits, type Limits } from './limits';
import type { InspectResult, SectionNode, TagInfo } from './model';
import { inferSchema } from './schema';
import { analyzeTemplate } from './template/analyze';
import { toSectionNode } from './template/structure';
import { clip } from './util/clip';

/**
 * Options of {@link inspect}.
 *
 * @example
 * ```ts
 * import { inspect, type InspectOptions } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const options: InspectOptions = { limits: { maxTags: 10_000 } };
 * console.log(inspect(bytes, options).tags.length);
 * ```
 */
export interface InspectOptions {
  /** Changes some of the {@link Limits}; the others keep their defaults. */
  readonly limits?: Partial<Limits>;
}

const OPTION_NAMES: readonly string[] = ['limits'];

/** Validates the options shared by inspect and render, and returns the limits. */
export function checkOptions(options: unknown, names: readonly string[] = OPTION_NAMES, what = 'inspect'): Limits {
  if (options === undefined) return resolveLimits(undefined);
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new DvError('DV_E_INVALID_OPTION', `The options of ${what} must be an object.`, {
      hint: 'Pass an object such as { limits: { maxTags: 1000 } }, or no options.',
    });
  }
  for (const key of Object.keys(options)) {
    if (!names.includes(key)) {
      throw new DvError('DV_E_INVALID_OPTION', `Unknown option "${clip(key)}".`, {
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
 * body, tables, text boxes, headers, footers, footnotes and endnotes. Nothing is rendered.
 *
 * Throws {@link DvError}: `DV_E_TEMPLATE_INVALID` lists every problem with a tag or section in
 * `errors` (up to `limits.maxErrors`), each with its code, place and hint;
 * `DV_E_NOT_SUPPORTED` for formats other than Word; ZIP, XML, package and limit errors for
 * damaged or hostile files.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { inspect } from 'docvane';
 *
 * const result = inspect(readFileSync('offer.docx'));
 * for (const tag of result.tags) console.log(tag.raw, '-', tag.location.description);
 * console.log(JSON.stringify(result.schema, null, 2));
 * ```
 */
export function inspect(template: Uint8Array, options?: InspectOptions): InspectResult {
  if (!(template instanceof Uint8Array)) {
    throw new DvError('DV_E_INVALID_INPUT', 'The template must be a Uint8Array (a Node.js Buffer is one).', {
      hint: 'Read the file into bytes first, for example inspect(readFileSync("offer.docx")) or inspect(new Uint8Array(await file.arrayBuffer())).',
    });
  }
  const limits = checkOptions(options);
  const analysis = analyzeTemplate(template, limits);
  const tags: TagInfo[] = [];
  const sections: SectionNode[] = [];
  for (const story of analysis.stories) {
    tags.push(...story.tags.map((t) => t.info));
    for (const child of story.tree) if ('section' in child) sections.push(toSectionNode(child.section));
  }
  const { schema, warnings } = inferSchema(analysis.stories.map((s) => s.tree));
  return { format: 'docx', tags, sections, schema, warnings: [...analysis.docx.warnings, ...warnings] };
}
