// `render`: fills a template with data and returns the new document.
import type { RenderContext } from './docx/render';
import { pruneComments } from './docx/comments';
import { createContext, prepareStories } from './prepare';
import { renderPresentation } from './pptx/assemble';
import { aggregate, TvError, type TvWarning } from './errors';
import { Formatting } from './expr/formatters';
import { checkOptions, delimitersOption } from './inspect';
import type { Limits } from './limits';
import { isPartName, partKey, partNameToZipName, zipNameToPartName } from './opc/part-name';
import { analyzeTemplate, type TemplateAnalysis } from './template/analyze';
import { clip } from './util/clip';
import { writeZip, type ZipWriteEntry } from './zip/writer';
import type { EvalContext } from './template/evaluator';
import { checkSectionWork, applyWorkbook, planWorkbook } from './xlsx/render';

/**
 * Options of {@link render}.
 *
 * @example
 * ```ts
 * import { render, type RenderOptions } from 'tplvane';
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
  /** The strings that start and end a tag, as for {@link inspect}. Default `{` and `}`. */
  readonly delimiters?: { readonly start: string; readonly end: string };
  /** The BCP 47 locale of numbers, currencies and dates, such as `pl-PL`. Default `en-US`. */
  readonly locale?: string;
  /** The IANA time zone in which dates with a time zone are shown, such as `Europe/Warsaw`. Default `UTC`. */
  readonly timeZone?: string;
  /** What a value tag shows when the data has no value for it: `error` (default) reports `TV_E_MISSING_FIELD`, `empty` shows nothing. */
  readonly missing?: 'error' | 'empty';
  /** Called with each warning, for example a style that Markdown needs and the template does not have. */
  readonly onWarning?: (warning: TvWarning) => void;
}

/**
 * Options of {@link renderAsync}: those of {@link render}, and the function that fetches images
 * given as addresses.
 *
 * @example
 * ```ts
 * import { renderAsync, type RenderAsyncOptions } from 'tplvane';
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
   * Fetches the bytes of an image given as an http(s) address. tplvane never connects to anything
   * itself: without this function an address is an error. Called once per distinct address.
   */
  readonly fetchImage?: (url: string) => Promise<Uint8Array | ArrayBuffer>;
}

const OPTION_NAMES: readonly string[] = ['limits', 'delimiters', 'locale', 'timeZone', 'missing', 'onWarning'];
const ASYNC_OPTION_NAMES: readonly string[] = [...OPTION_NAMES, 'fetchImage'];

function option(options: RenderOptions | undefined, name: 'locale' | 'timeZone', fallback: string): string {
  const value: unknown = options?.[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new TvError('TV_E_INVALID_OPTION', `Option "${name}" must be a string.`, { hint: name === 'locale' ? 'Pass a BCP 47 locale such as "pl-PL".' : 'Pass an IANA time zone such as "Europe/Warsaw".', details: { option: name } });
  }
  try {
    if (name === 'locale') Intl.getCanonicalLocales(value);
    else new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch (cause) {
    throw new TvError('TV_E_INVALID_OPTION', `"${clip(value)}" is not a valid ${name === 'locale' ? 'locale' : 'time zone'}.`, {
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
  if (typeof value !== 'function') throw new TvError('TV_E_INVALID_OPTION', `Option "${name}" must be a function.`, { hint: `Pass a function, or leave "${name}" out.`, details: { option: name } });
  return value as T;
}


/** The shared core of render and renderAsync. With `collect`, only collects image addresses. */
/** What a dry run of render found (D-047): the problems of the data, warnings, and the analysis of the template. */
export interface DryRun {
  problems: TvError[];
  warnings: TvWarning[];
  analysis: TemplateAnalysis | null;
  /** The function called, for the messages about options. */
  readonly what: string;
}

/**
 * The shared core of render, renderAsync and validate. With `collect`, only collects image
 * addresses. With `dry`, renders without writing a file: image addresses are accepted unfetched,
 * and the problems of the data go into `dry` instead of being thrown.
 */
function renderCore(template: Uint8Array, data: unknown, options: RenderAsyncOptions | undefined, names: readonly string[], fetched: ReadonlyMap<string, Uint8Array>, collect?: Set<string>, dry?: DryRun): Uint8Array {
  if (!(template instanceof Uint8Array)) {
    throw new TvError('TV_E_INVALID_INPUT', 'The template must be a Uint8Array (a Node.js Buffer is one).', {
      hint: 'Read the file into bytes first, for example render(readFileSync("offer.docx"), data).',
    });
  }
  const limits = checkOptions(options, names, dry?.what ?? 'render');
  const locale = option(options, 'locale', 'en-US');
  const timeZone = option(options, 'timeZone', 'UTC');
  const onWarning = functionOption<(w: TvWarning) => void>(options, 'onWarning');
  const missing = options?.missing ?? 'error';
  if (missing !== 'error' && missing !== 'empty') {
    throw new TvError('TV_E_INVALID_OPTION', 'Option "missing" must be "error" or "empty".', { hint: 'Leave it out to report missing fields, or pass "empty" to show nothing for them.', details: { option: 'missing' } });
  }

  const analysis = analyzeTemplate(template, limits, delimitersOption(options));
  if (dry !== undefined) dry.analysis = analysis;
  if (analysis.workbook !== null) {
    // Workbooks hold no images, so there is nothing for renderAsync to collect.
    if (collect !== undefined && dry === undefined) return new Uint8Array(0);
    const evalCtx: EvalContext = { limits, formatting: new Formatting({ locale, timeZone }), missing, problems: [], iterations: 0, output: 0, scopePaths: new WeakMap() };
    const plan = planWorkbook(analysis.workbook, data, evalCtx);
    // The work of many repeated sections, checked before the dry run of validate returns (D-071).
    checkSectionWork(plan, template.length, limits);
    if (dry !== undefined) {
      dry.problems = evalCtx.problems;
      return new Uint8Array(0);
    }
    if (evalCtx.problems.length > 0) throw aggregate('TV_E_DATA_INVALID', evalCtx.problems, evalCtx.problems.length >= limits.maxErrors);
    return applyWorkbook(template, plan, limits);
  }
  const { zip } = analysis.docx;
  const ctx: RenderContext = createContext(analysis, limits, { locale, timeZone, missing, fetched, collect: dry === undefined ? collect : new Set() });
  const pptx = analysis.docx.format === 'pptx';
  const { prepared, problems: placement } = prepareStories(analysis, ctx);
  if (placement.length > 0) throw aggregate('TV_E_TEMPLATE_INVALID', placement, false);

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
  if (dry !== undefined) {
    dry.problems = ctx.problems;
    dry.warnings = ctx.warnings;
    return new Uint8Array(0);
  }
  // Problems of the data are reported before any image is fetched (D-071).
  if (collect !== undefined && ctx.problems.length === 0) return new Uint8Array(0);
  if (ctx.problems.length > 0) throw aggregate('TV_E_DATA_INVALID', ctx.problems, ctx.problems.length >= limits.maxErrors);

  const extra = ctx.resources.parts();
  const numbering = ctx.numbering.changed();
  if (numbering !== null) {
    changed.set(partKey(numbering.name), numbering.xml);
    partNames.set(partKey(numbering.name), numbering.name);
  }
  for (const [key, part] of extra.changed) {
    changed.set(key, part.xml);
    partNames.set(key, part.name);
  }
  if (!pptx) {
    // Comments of content that was left out go with it (D-073).
    const stories = (): Map<string, string> => new Map(analysis.stories.map((s) => [partKey(s.part), changed.get(partKey(s.part)) ?? analysis.docx.pkg.readXml(s.part) ?? ''] as const));
    for (const [key, part] of pruneComments(analysis.docx.pkg, analysis.docx.main, stories, limits)) {
      changed.set(key, part.xml);
      partNames.set(key, part.name);
    }
  }
  ctx.output += ctx.resources.mediaBytes;
  if (ctx.output > limits.maxOutputBytes) {
    throw new TvError('TV_E_LIMIT_EXCEEDED', `The result would be larger than ${String(limits.maxOutputBytes)} (XML characters and image bytes).`, {
      hint: `If you trust this template and data, raise the limit, for example { limits: { maxOutputBytes: ${String(limits.maxOutputBytes * 4)} } }.`,
      details: { limit: 'maxOutputBytes', value: limits.maxOutputBytes },
    });
  }

  const encoder = new TextEncoder();
  const written = new Set<string>();
  const removed = ctx.resources.removed;
  // Only the parts of the package and its Media Types stream are written: ZIP items whose names
  // are not part names ("../x.xml", "a\\b", "C:/x", folders) are not parts (Part 2 §6.2.2.2) and
  // would be a risk for whoever extracts the result (D-071).
  // A colon is valid in a part name, but on Windows it names a drive or a stream; no part needs one.
  const kept = (name: string): boolean => name.toLowerCase() === '[content_types].xml' || (isPartName(zipNameToPartName(name)) && !name.includes(':'));
  const entries: ZipWriteEntry[] = zip.entries.filter((entry) => kept(entry.name) && !removed.has(partKey(zipNameToPartName(entry.name)))).map((entry) => {
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
 * Throws {@link TvError}: `TV_E_TEMPLATE_INVALID` for problems of the template (the same as
 * {@link inspect} reports, plus `TV_E_SECTION_PLACEMENT`), `TV_E_DATA_INVALID` listing every
 * missing field and invalid value in `errors` (an image given as an address is one: use
 * {@link renderAsync}), `TV_E_LIMIT_EXCEEDED`, and the file errors of `inspect`.
 *
 * @example
 * ```ts
 * import { readFileSync, writeFileSync } from 'node:fs';
 * import { render } from 'tplvane';
 *
 * // The template and image of examples/offer in the tplvane repository.
 * const result = render(readFileSync('offer.docx'), {
 *   logo: readFileSync('logo.png'),
 *   number: '2026/11/001',
 *   customer: { name: 'Anna Nowak', company: 'Nowak Design' },
 *   date: '2026-11-06',
 *   items: [{ name: 'Desk', qty: 1, price: 1200, total: 1200 }],
 *   sum: 1200,
 *   vip: true,
 *   notes: 'We offer **free delivery**.\n\n- Assembly included',
 *   author: 'Jan Kowalski',
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
 * document is rendered as by `render`. tplvane makes no connection itself: without `fetchImage`,
 * an address in the data is reported as `TV_E_INVALID_VALUE`. A failing `fetchImage` gives
 * `TV_E_IMAGE_FETCH` with the address; its bytes are checked like any image.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { renderAsync } from 'tplvane';
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
      throw new TvError('TV_E_LIMIT_EXCEEDED', `The data has more than ${String(limits.maxImages)} image addresses.`, { hint: 'Pass fewer images, or raise limits.maxImages if you trust the data.', details: { limit: 'maxImages', value: limits.maxImages } });
    }
    let total = 0;
    for (const url of urls) {
      let bytes: Uint8Array | ArrayBuffer;
      try {
        bytes = await fetchImage(url);
      } catch (cause) {
        throw new TvError('TV_E_IMAGE_FETCH', `fetchImage failed for "${clip(url)}".`, { hint: 'Check the address and your fetchImage function; the error it threw is in "cause".', details: { url: clip(url) }, cause });
      }
      if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
        throw new TvError('TV_E_IMAGE_FETCH', `fetchImage returned no bytes for "${clip(url)}".`, { hint: 'Return a Uint8Array or an ArrayBuffer from fetchImage.', details: { url: clip(url) } });
      }
      // Each image is checked as it arrives, and all of them together against maxInputBytes, so
      // that many large answers are not all kept before one is refused (D-071).
      if (bytes.byteLength > limits.maxImageBytes) {
        throw new TvError('TV_E_LIMIT_EXCEEDED', `The image fetched from "${clip(url)}" has more than ${String(limits.maxImageBytes)} bytes.`, { hint: 'Use a smaller image, or raise limits.maxImageBytes if you trust the source.', details: { limit: 'maxImageBytes', value: limits.maxImageBytes, url: clip(url) } });
      }
      total += bytes.byteLength;
      if (total > limits.maxInputBytes) {
        throw new TvError('TV_E_LIMIT_EXCEEDED', `The images fetched have more than ${String(limits.maxInputBytes)} bytes in all.`, { hint: 'Use fewer or smaller images, or raise limits.maxInputBytes if you trust the sources.', details: { limit: 'maxInputBytes', value: limits.maxInputBytes } });
      }
      fetched.set(url, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }
  }
  return renderCore(template, data, options, ASYNC_OPTION_NAMES, fetched);
}

/** Renders without writing a file, for validate (D-047). Throws only for problems of the input, the options, the file and the template. */
export function dryRender(template: Uint8Array, data: unknown, options: RenderOptions | undefined, what: string): DryRun {
  if (!(template instanceof Uint8Array)) {
    throw new TvError('TV_E_INVALID_INPUT', 'The template must be a Uint8Array (a Node.js Buffer is one).', {
      hint: `Read the file into bytes first, for example ${what}(readFileSync("offer.docx"), data).`,
    });
  }
  const dry: DryRun = { problems: [], warnings: [], analysis: null, what };
  renderCore(template, data, options, ['limits', 'delimiters', 'locale', 'timeZone', 'missing'], new Map(), undefined, dry);
  return dry;
}
