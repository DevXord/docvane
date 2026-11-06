// `inspect`: the tags, sections and data schema of a template, without data.
import { openDocx } from './docx/package';
import { readParagraphs } from './docx/paragraphs';
import { DvError, type DvLocation, type DvWarning } from './errors';
import { limitError, resolveLimits, type Limits } from './limits';
import type { InspectResult, SectionNode, TagInfo } from './model';
import { inferSchema } from './schema';
import { lexText, type LexProblem } from './template/lexer';
import { buildTree, toSectionNode, type TreeChild } from './template/structure';
import { parseTag } from './template/tag';
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

function lexProblem(problem: LexProblem, location: DvLocation, limits: Limits): DvError {
  switch (problem.code) {
    case 'DV_E_TAG_UNCLOSED':
      return new DvError('DV_E_TAG_UNCLOSED', `The tag "${problem.raw}" is not closed.`, {
        location,
        hint: 'End the tag with "}". A tag must start and end in the same paragraph and cannot contain another "{"; braces are reserved for tags.',
        details: { tag: problem.raw },
      });
    case 'DV_E_TAG_UNOPENED':
      return new DvError('DV_E_TAG_UNOPENED', 'The text has a "}" without a "{" before it.', {
        location,
        hint: 'Delete the "}" or add the missing "{"; braces are reserved for tags. A tag must start and end in the same paragraph.',
        details: { tag: problem.raw },
      });
    case 'DV_E_LIMIT_EXCEEDED':
      return limitError('maxTagLength', limits.maxTagLength, `The tag "${clip(problem.raw.slice(0, 40))}" is longer than ${String(limits.maxTagLength)} characters.`, location);
  }
}

function checkOptions(options: unknown): Limits {
  if (options === undefined) return resolveLimits(undefined);
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new DvError('DV_E_INVALID_OPTION', 'The options of inspect must be an object.', {
      hint: 'Pass an object such as { limits: { maxTags: 1000 } }, or no options.',
    });
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_NAMES.includes(key)) {
      throw new DvError('DV_E_INVALID_OPTION', `Unknown option "${clip(key)}".`, {
        hint: `Known options: ${OPTION_NAMES.join(', ')}.`,
        details: { option: clip(key), known: OPTION_NAMES },
      });
    }
  }
  return resolveLimits((options as InspectOptions).limits);
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
  const docx = openDocx(template, limits);
  const problems: DvError[] = [];
  const tags: TagInfo[] = [];
  const parts: TreeChild[][] = [];
  const sections: SectionNode[] = [];
  const full = (): boolean => problems.length >= limits.maxErrors;
  const report = (error: DvError): void => {
    if (!full()) problems.push(error);
  };

  for (const { part, story } of docx.stories) {
    if (full()) break;
    const xml = docx.pkg.readXml(part);
    if (xml === undefined) continue;
    const partTags: { tag: TagInfo; at: number }[] = [];
    for (const paragraph of readParagraphs(xml, { part, story, limits })) {
      if (full()) break;
      const lexed = lexText(paragraph.text, limits.maxTagLength, limits.maxErrors - problems.length);
      const at = (offset: number): DvLocation => ({ ...paragraph.location, character: offset + 1 });
      for (const problem of lexed.problems) report(lexProblem(problem, at(problem.start), limits));
      for (const raw of lexed.tags) {
        if (tags.length + partTags.length >= limits.maxTags) {
          throw limitError('maxTags', limits.maxTags, `The template has more than ${String(limits.maxTags)} tags.`, at(raw.start));
        }
        const parsed = parseTag(raw.inner);
        if ('code' in parsed) {
          report(
            new DvError(parsed.code, `${parsed.message} (in "${clip(raw.raw)}")`, {
              location: at(raw.start),
              hint: parsed.hint,
              details: { tag: clip(raw.raw), position: parsed.position + 2 },
            }),
          );
          continue;
        }
        partTags.push({ tag: { kind: parsed.kind, raw: raw.raw, path: parsed.path, formatters: parsed.formatters, location: at(raw.start) }, at: paragraph.xmlOffset(raw.start) });
      }
    }
    // Paragraphs of text boxes sit inside other paragraphs: order the tags by where they are in the XML.
    partTags.sort((a, b) => a.at - b.at);
    const ordered = partTags.map((t) => t.tag);
    tags.push(...ordered);
    const tree = buildTree(ordered, limits);
    for (const problem of tree.problems) report(problem);
    parts.push(tree.children);
    for (const child of tree.children) if ('section' in child) sections.push(toSectionNode(child.section));
  }

  if (problems.length > 0) {
    const first = problems[0] as DvError;
    const count = problems.length;
    throw new DvError(
      'DV_E_TEMPLATE_INVALID',
      count === 1 ? `The template has a problem: ${first.message}` : `The template has ${String(count)}${full() ? ' or more' : ''} problems. The first: ${first.message}`,
      {
        location: first.location,
        hint: `Fix the problems listed in "errors"; each one has its place in the document and a hint. The first: ${first.hint}`,
        details: { count, truncated: full() },
        errors: problems,
      },
    );
  }

  const { schema, warnings } = inferSchema(parts);
  const allWarnings: DvWarning[] = [...docx.warnings, ...warnings];
  return { format: 'docx', tags, sections, schema, warnings: allWarnings };
}
