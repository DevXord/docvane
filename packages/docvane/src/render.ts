// `render`: fills a template with data and returns the new document.
import { maxDrawingId, prepareStory, textWidthOf, type RenderContext } from './docx/render';
import { Resources } from './docx/resources';
import { renderPresentation } from './pptx/assemble';
import { SlideRenderer } from './pptx/render';
import type { PreparedStory } from './docx/render';
import type { StoryAnalysis } from './template/analyze';
import { readStyles } from './docx/styles';
import { DvError, type DvWarning } from './errors';
import { Formatting } from './expr/formatters';
import { checkOptions } from './inspect';
import type { Limits } from './limits';
import { partKey, partNameToZipName, zipNameToPartName } from './opc/part-name';
import { analyzeTemplate } from './template/analyze';
import { clip } from './util/clip';
import { writeZip, type ZipWriteEntry } from './zip/writer';
import type { EvalContext } from './template/evaluator';
import { applyWorkbook, planWorkbook } from './xlsx/render';

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
  /** Called with each warning, for example a style that Markdown needs and the template does not have. */
  readonly onWarning?: (warning: DvWarning) => void;
}

/**
 * Options of {@link renderAsync}: those of {@link render}, and the function that fetches images
 * given as addresses.
 *
 * @example
 * ```ts
 * import { renderAsync, type RenderAsyncOptions } from 'docvane';
 *
 * declare const template: Uint8Array;
 * const allowed = new Set(['https://cdn.example.com/logo.png']);
 * const options: RenderAsyncOptions = {
 *   async fetchImage(url) {
 *     if (!allowed.has(url)) throw new Error(`not allowed: ${url}`);
 *     return new Uint8Array(await (await fetch(url)).arrayBuffer());
 *   },
 * };
 * const result = await renderAsync(template, { logo: 'https://cdn.example.com/logo.png' }, options);
 * console.log(result.length);
 * ```
 */
export interface RenderAsyncOptions extends RenderOptions {
  /**
   * Fetches the bytes of an image given as an http(s) address. docvane never connects to anything
   * itself: without this function an address is an error. Called once per distinct address.
   */
  readonly fetchImage?: (url: string) => Promise<Uint8Array | ArrayBuffer>;
}

const OPTION_NAMES: readonly string[] = ['limits', 'locale', 'timeZone', 'missing', 'onWarning'];
const ASYNC_OPTION_NAMES: readonly string[] = [...OPTION_NAMES, 'fetchImage'];

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

function functionOption<T>(options: RenderAsyncOptions | undefined, name: 'onWarning' | 'fetchImage'): T | undefined {
  const value: unknown = options?.[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'function') throw new DvError('DV_E_INVALID_OPTION', `Option "${name}" must be a function.`, { hint: `Pass a function, or leave "${name}" out.`, details: { option: name } });
  return value as T;
}

function aggregate(code: 'DV_E_TEMPLATE_INVALID' | 'DV_E_DATA_INVALID', problems: readonly DvError[], truncated: boolean): DvError {
  const first = problems[0] as DvError;
  const count = problems.length;
  const what = code === 'DV_E_TEMPLATE_INVALID' ? 'template' : 'data';
  return new DvError(code, count === 1 ? `The ${what} has a problem: ${first.message}` : `The ${what} has ${String(count)}${truncated ? ' or more' : ''} problems. The first: ${first.message}`, {
    location: first.location,
    hint: `Fix the problems listed in "errors"; each one has its place in the template${code === 'DV_E_DATA_INVALID' ? ' and names the field' : ''}. The first: ${first.hint}`,
    details: { count, truncated },
    errors: problems,
  });
}

/** The shared core of render and renderAsync. With `collect`, only collects image addresses. */
function renderCore(template: Uint8Array, data: unknown, options: RenderAsyncOptions | undefined, names: readonly string[], fetched: ReadonlyMap<string, Uint8Array>, collect?: Set<string>): Uint8Array {
  if (!(template instanceof Uint8Array)) {
    throw new DvError('DV_E_INVALID_INPUT', 'The template must be a Uint8Array (a Node.js Buffer is one).', {
      hint: 'Read the file into bytes first, for example render(readFileSync("offer.docx"), data).',
    });
  }
  const limits = checkOptions(options, names, 'render');
  const locale = option(options, 'locale', 'en-US');
  const timeZone = option(options, 'timeZone', 'UTC');
  const onWarning = functionOption<(w: DvWarning) => void>(options, 'onWarning');
  const missing = options?.missing ?? 'error';
  if (missing !== 'error' && missing !== 'empty') {
    throw new DvError('DV_E_INVALID_OPTION', 'Option "missing" must be "error" or "empty".', { hint: 'Leave it out to report missing fields, or pass "empty" to show nothing for them.', details: { option: 'missing' } });
  }

  const analysis = analyzeTemplate(template, limits);
  if (analysis.workbook !== null) {
    // Workbooks hold no images, so there is nothing for renderAsync to collect.
    if (collect !== undefined) return new Uint8Array(0);
    const evalCtx: EvalContext = { limits, formatting: new Formatting({ locale, timeZone }), missing, problems: [], iterations: 0, output: 0 };
    const plan = planWorkbook(analysis.workbook, data, evalCtx);
    if (evalCtx.problems.length > 0) throw aggregate('DV_E_DATA_INVALID', evalCtx.problems, evalCtx.problems.length >= limits.maxErrors);
    return applyWorkbook(template, plan, limits);
  }
  const { zip, pkg, main } = analysis.docx;
  const mainStory = analysis.stories.find((s) => s.story === 'body');
  const ctx: RenderContext = {
    limits,
    formatting: new Formatting({ locale, timeZone }),
    missing,
    problems: [],
    iterations: 0,
    output: 0,
    nextDrawingId: Math.max(0, ...analysis.stories.map((s) => maxDrawingId(s.doc))) + 1,
    resources: new Resources(pkg, zip, limits, analysis.docx.format === 'pptx' ? '/ppt/media/' : '/word/media/'),
    styles: readStyles(pkg, main, limits),
    textWidth: mainStory === undefined ? 16 * 360000 : textWidthOf(mainStory.doc),
    fetched,
    collect,
    warnings: [],
  };
  const pptx = analysis.docx.format === 'pptx';
  const prepared = new Map<StoryAnalysis, PreparedStory>();
  for (const story of analysis.stories) prepared.set(story, pptx ? prepareStory(story, ctx, (s, c) => new SlideRenderer(s, c), analysis.droppedShapes) : prepareStory(story, ctx));
  const placement = [...prepared.values()].flatMap((p) => p.problems);
  if (placement.length > 0) throw aggregate('DV_E_TEMPLATE_INVALID', placement, false);

  const changed = new Map<string, string>();
  const partNames = new Map<string, string>();
  if (pptx) {
    for (const [part, xml] of renderPresentation(analysis, ctx, prepared, data)) {
      changed.set(partKey(part), xml);
      partNames.set(partKey(part), part);
    }
  } else {
    for (const [story, p] of prepared) {
      if (story.tags.length === 0) continue;
      changed.set(partKey(story.part), p.render([data]));
    }
  }
  if (collect !== undefined) return new Uint8Array(0);
  if (ctx.problems.length > 0) throw aggregate('DV_E_DATA_INVALID', ctx.problems, ctx.problems.length >= limits.maxErrors);

  const extra = ctx.resources.parts();
  for (const [key, part] of extra.changed) {
    changed.set(key, part.xml);
    partNames.set(key, part.name);
  }
  ctx.output += ctx.resources.mediaBytes;
  if (ctx.output > limits.maxOutputBytes) {
    throw new DvError('DV_E_LIMIT_EXCEEDED', `The result would be larger than ${String(limits.maxOutputBytes)} (XML characters and image bytes).`, {
      hint: `If you trust this template and data, raise the limit, for example { limits: { maxOutputBytes: ${String(limits.maxOutputBytes * 4)} } }.`,
      details: { limit: 'maxOutputBytes', value: limits.maxOutputBytes },
    });
  }

  const encoder = new TextEncoder();
  const written = new Set<string>();
  const removed = ctx.resources.removed;
  const entries: ZipWriteEntry[] = zip.entries.filter((entry) => !removed.has(partKey(zipNameToPartName(entry.name)))).map((entry) => {
    const partName = zipNameToPartName(entry.name);
    const name = /^[\x20-\x7e]*$/.test(entry.name) ? entry.name : (partNameToZipName(partName) ?? entry.name);
    const key = partKey(partName);
    written.add(key);
    const xml = changed.get(key);
    if (xml !== undefined) return { name, data: encoder.encode(xml) };
    const raw = zip.raw(entry);
    return raw === null ? { name, data: zip.read(entry) } : { name, data: new Uint8Array(0), raw };
  });
  // New Relationships parts, then the media.
  for (const [key, xml] of changed) {
    if (written.has(key)) continue;
    const name = partNameToZipName(partNames.get(key) ?? key);
    if (name !== null) entries.push({ name, data: encoder.encode(xml) });
  }
  for (const [partName, bytes] of extra.added) {
    const name = partNameToZipName(partName);
    if (name !== null) entries.push({ name, data: bytes });
  }
  for (const warning of ctx.warnings) onWarning?.(warning);
  return writeZip(entries);
}

/**
 * Fills a template with data and returns the new file, in the format of the template (DOCX, PPTX
 * or XLSX).
 *
 * Values are written with the formatting of the tag's first character; `{#list}…{/list}` repeats
 * its content for each item (within a paragraph, over paragraphs, table rows or ranges of rows);
 * `{#flag}…{/flag}` and `{^flag}…{/flag}` show content by the truth of a value; expressions and
 * formatters work as described in the syntax reference. `{%logo}` inserts an image given as bytes
 * or a data URL, `{~summary}` Markdown with the template's heading and list styles, and
 * `{site | link}` a hyperlink. In a workbook, a cell that holds one value tag gets the type of the
 * value, a section over cells of different rows repeats those rows with their formulas, and ranges
 * that end on the last repeated row grow to the last copy. Template and data are untrusted: every
 * value is escaped, nothing in the template can run code, nothing is downloaded, and the output is
 * limited.
 *
 * Throws {@link DvError}: `DV_E_TEMPLATE_INVALID` for problems of the template (the same as
 * {@link inspect} reports, plus `DV_E_SECTION_PLACEMENT`), `DV_E_DATA_INVALID` listing every
 * missing field and invalid value in `errors` (an image given as an address is one: use
 * {@link renderAsync}), `DV_E_LIMIT_EXCEEDED`, and the file errors of `inspect`.
 *
 * @example
 * ```ts
 * import { readFileSync, writeFileSync } from 'node:fs';
 * import { render } from 'docvane';
 *
 * const result = render(readFileSync('offer.docx'), {
 *   customer: { name: 'Anna Nowak' },
 *   items: [{ name: 'Desk', price: 1200 }, { name: 'Chair', price: 350 }],
 *   logo: readFileSync('logo.png'),
 *   summary: 'We offer **free delivery**.\n\n- Desk\n- Chair',
 * }, { locale: 'pl-PL' });
 * writeFileSync('offer-anna.docx', result);
 *
 * // The same call fills a workbook: one row per item, and the totals below follow.
 * writeFileSync('prices.xlsx', render(readFileSync('prices-template.xlsx'), { items: [{ name: 'Desk', price: 1200 }] }));
 * ```
 */
export function render(template: Uint8Array, data: unknown, options?: RenderOptions): Uint8Array {
  return renderCore(template, data, options, OPTION_NAMES, new Map());
}

/**
 * Like {@link render}, but images given as http(s) addresses are fetched first with
 * `options.fetchImage`, a function you pass and control, once per distinct address; then the
 * document is rendered as by `render`. docvane makes no connection itself: without `fetchImage`,
 * an address in the data is reported as `DV_E_INVALID_VALUE`. A failing `fetchImage` gives
 * `DV_E_IMAGE_FETCH` with the address; its bytes are checked like any image.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { renderAsync } from 'docvane';
 *
 * const result = await renderAsync(readFileSync('offer.docx'), { logo: 'https://cdn.example.com/logo.png' }, {
 *   async fetchImage(url) {
 *     if (!url.startsWith('https://cdn.example.com/')) throw new Error('address not allowed');
 *     return new Uint8Array(await (await fetch(url)).arrayBuffer());
 *   },
 * });
 * console.log(result.length);
 * ```
 */
export async function renderAsync(template: Uint8Array, data: unknown, options?: RenderAsyncOptions): Promise<Uint8Array> {
  const fetchImage = functionOption<(url: string) => Promise<Uint8Array | ArrayBuffer>>(options, 'fetchImage');
  const fetched = new Map<string, Uint8Array>();
  if (fetchImage !== undefined) {
    const urls = new Set<string>();
    renderCore(template, data, options, ASYNC_OPTION_NAMES, fetched, urls);
    const limits = checkOptions(options, ASYNC_OPTION_NAMES, 'render');
    if (urls.size > limits.maxImages) {
      throw new DvError('DV_E_LIMIT_EXCEEDED', `The data has more than ${String(limits.maxImages)} image addresses.`, { hint: 'Pass fewer images, or raise limits.maxImages if you trust the data.', details: { limit: 'maxImages', value: limits.maxImages } });
    }
    for (const url of urls) {
      let bytes: Uint8Array | ArrayBuffer;
      try {
        bytes = await fetchImage(url);
      } catch (cause) {
        throw new DvError('DV_E_IMAGE_FETCH', `fetchImage failed for "${clip(url)}".`, { hint: 'Check the address and your fetchImage function; the error it threw is in "cause".', details: { url: clip(url) }, cause });
      }
      if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
        throw new DvError('DV_E_IMAGE_FETCH', `fetchImage returned no bytes for "${clip(url)}".`, { hint: 'Return a Uint8Array or an ArrayBuffer from fetchImage.', details: { url: clip(url) } });
      }
      fetched.set(url, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }
  }
  return renderCore(template, data, options, ASYNC_OPTION_NAMES, fetched);
}
