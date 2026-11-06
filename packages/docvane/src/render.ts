// `render`: fills a template with data and returns the new document.
import { maxDrawingId, prepareStory, type RenderContext } from './docx/render';
import { DvError } from './errors';
import { Formatting } from './expr/formatters';
import { checkOptions } from './inspect';
import type { Limits } from './limits';
import { partKey, partNameToZipName, zipNameToPartName } from './opc/part-name';
import { analyzeTemplate } from './template/analyze';
import { clip } from './util/clip';
import { writeZip, type ZipWriteEntry } from './zip/writer';

/**
 * Options of {@link render}.
 *
 * @example
 * ```ts
 * import { render, type RenderOptions } from 'docvane';
 *
 * declare const template: Uint8Array;
 * const options: RenderOptions = { locale: 'pl-PL', timeZone: 'Europe/Warsaw', missing: 'error' };
 * const result: Uint8Array = render(template, { total: 1234.5 }, options);
 * console.log(result.length);
 * ```
 */
export interface RenderOptions {
  /** Changes some of the {@link Limits}; the others keep their defaults. */
  readonly limits?: Partial<Limits>;
  /** The BCP 47 locale of numbers, currencies and dates, such as `pl-PL`. Default `en-US`. */
  readonly locale?: string;
  /** The IANA time zone in which dates with a time zone are shown, such as `Europe/Warsaw`. Default `UTC`. */
  readonly timeZone?: string;
  /** What a value tag shows when the data has no value for it: `error` (default) reports `DV_E_MISSING_FIELD`, `empty` shows nothing. */
  readonly missing?: 'error' | 'empty';
}

const OPTION_NAMES: readonly string[] = ['limits', 'locale', 'timeZone', 'missing'];

function option(options: RenderOptions | undefined, name: 'locale' | 'timeZone', fallback: string): string {
  const value: unknown = options?.[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new DvError('DV_E_INVALID_OPTION', `Option "${name}" must be a string.`, { hint: name === 'locale' ? 'Pass a BCP 47 locale such as "pl-PL".' : 'Pass an IANA time zone such as "Europe/Warsaw".', details: { option: name } });
  }
  try {
    if (name === 'locale') Intl.getCanonicalLocales(value);
    else new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch (cause) {
    throw new DvError('DV_E_INVALID_OPTION', `"${clip(value)}" is not a valid ${name === 'locale' ? 'locale' : 'time zone'}.`, {
      hint: name === 'locale' ? 'Pass a BCP 47 locale such as "pl-PL" or "en-US".' : 'Pass an IANA time zone such as "Europe/Warsaw" or "UTC".',
      details: { option: name },
      cause,
    });
  }
  return value;
}

/**
 * Fills a template with data and returns the new document, as the bytes of a DOCX file.
 *
 * Values are written with the formatting of the tag's first character; `{#list}…{/list}` repeats
 * its content for each item (within a paragraph, over paragraphs, table rows or ranges of rows);
 * `{#flag}…{/flag}` and `{^flag}…{/flag}` show content by the truth of a value; expressions and
 * formatters work as described in the syntax reference. Template and data are untrusted: every
 * value is escaped, nothing in the template can run code, and the output is limited.
 *
 * Throws {@link DvError}: `DV_E_TEMPLATE_INVALID` for problems of the template (the same as
 * {@link inspect} reports, plus `DV_E_SECTION_PLACEMENT`), `DV_E_DATA_INVALID` listing every
 * missing field and invalid value in `errors`, `DV_E_NOT_SUPPORTED` for image and Markdown tags
 * (not rendered yet), `DV_E_LIMIT_EXCEEDED`, and the file errors of `inspect`.
 *
 * @example
 * ```ts
 * import { readFileSync, writeFileSync } from 'node:fs';
 * import { render } from 'docvane';
 *
 * const result = render(readFileSync('offer.docx'), {
 *   customer: { name: 'Anna Nowak' },
 *   items: [{ name: 'Desk', price: 1200 }, { name: 'Chair', price: 350 }],
 * }, { locale: 'pl-PL' });
 * writeFileSync('offer-anna.docx', result);
 * ```
 */
export function render(template: Uint8Array, data: unknown, options?: RenderOptions): Uint8Array {
  if (!(template instanceof Uint8Array)) {
    throw new DvError('DV_E_INVALID_INPUT', 'The template must be a Uint8Array (a Node.js Buffer is one).', {
      hint: 'Read the file into bytes first, for example render(readFileSync("offer.docx"), data).',
    });
  }
  const limits = checkOptions(options, OPTION_NAMES, 'render');
  const locale = option(options, 'locale', 'en-US');
  const timeZone = option(options, 'timeZone', 'UTC');
  const missing = options?.missing ?? 'error';
  if (missing !== 'error' && missing !== 'empty') {
    throw new DvError('DV_E_INVALID_OPTION', 'Option "missing" must be "error" or "empty".', { hint: 'Leave it out to report missing fields, or pass "empty" to show nothing for them.', details: { option: 'missing' } });
  }

  const analysis = analyzeTemplate(template, limits);
  for (const story of analysis.stories) {
    const unsupported = story.tags.find((t) => t.info.kind === 'image' || t.info.kind === 'markdown');
    if (unsupported !== undefined) {
      throw new DvError('DV_E_NOT_SUPPORTED', `${unsupported.info.kind === 'image' ? 'Image' : 'Markdown'} tags such as "${clip(unsupported.info.raw)}" cannot be rendered yet.`, {
        location: unsupported.info.location,
        hint: 'Remove the tag for now; images and Markdown come in a later version. inspect reads such tags already.',
        details: { tag: clip(unsupported.info.raw) },
      });
    }
  }

  const ctx: RenderContext = {
    limits,
    formatting: new Formatting({ locale, timeZone }),
    missing,
    problems: [],
    iterations: 0,
    output: 0,
    nextDrawingId: Math.max(0, ...analysis.stories.map((s) => maxDrawingId(s.doc))) + 1,
  };
  const prepared = analysis.stories.map((story) => ({ story, ...prepareStory(story, ctx) }));
  const placement = prepared.flatMap((p) => p.problems);
  if (placement.length > 0) {
    const first = placement[0] as DvError;
    throw new DvError('DV_E_TEMPLATE_INVALID', placement.length === 1 ? `The template has a problem: ${first.message}` : `The template has ${String(placement.length)} problems. The first: ${first.message}`, {
      location: first.location,
      hint: `Fix the problems listed in "errors". The first: ${first.hint}`,
      details: { count: placement.length, truncated: false },
      errors: placement,
    });
  }

  const changed = new Map<string, string>();
  for (const { story, render: renderStory } of prepared) {
    if (story.tags.length === 0) continue;
    changed.set(partKey(story.part), renderStory(data));
  }
  if (ctx.problems.length > 0) {
    const first = ctx.problems[0] as DvError;
    const count = ctx.problems.length;
    const truncated = count >= limits.maxErrors;
    throw new DvError('DV_E_DATA_INVALID', count === 1 ? `The data has a problem: ${first.message}` : `The data has ${String(count)}${truncated ? ' or more' : ''} problems. The first: ${first.message}`, {
      location: first.location,
      hint: `Fix the problems listed in "errors"; each one names the field and its place in the template. The first: ${first.hint}`,
      details: { count, truncated },
      errors: ctx.problems,
    });
  }

  const encoder = new TextEncoder();
  const { zip } = analysis.docx;
  const entries: ZipWriteEntry[] = zip.entries.map((entry) => {
    const partName = zipNameToPartName(entry.name);
    const name = /^[\x20-\x7e]*$/.test(entry.name) ? entry.name : (partNameToZipName(partName) ?? entry.name);
    const xml = changed.get(partKey(partName));
    if (xml !== undefined) return { name, data: encoder.encode(xml) };
    const raw = zip.raw(entry);
    return raw === null ? { name, data: zip.read(entry) } : { name, data: new Uint8Array(0), raw };
  });
  return writeZip(entries);
}
