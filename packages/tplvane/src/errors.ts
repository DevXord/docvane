// Errors and warnings of tplvane. Modelled on src/errors.ts of DevXord/xlvane at aeaefbc (the
// shape of the error: code, message, location, hint, details, cause, toJSON), rewritten for
// tplvane: `TV_E_*` codes, document locations and aggregated template errors (D-009, D-013).

/** Base URL of the error catalogue. Every code has a heading (and so an anchor) there. */
const DOCS_URL = 'https://github.com/DevXord/tplvane/blob/main/docs/errors.md';

/**
 * Every error code tplvane can throw. Codes are stable: a code is never reused for a different
 * condition. Each one is described in docs/errors.md.
 *
 * @example
 * ```ts
 * import { ERROR_CODES } from 'tplvane';
 * console.log(ERROR_CODES.includes('TV_E_TAG_UNCLOSED')); // true
 * ```
 */
export const ERROR_CODES = [
  'TV_E_INVALID_INPUT',
  'TV_E_INVALID_OPTION',
  'TV_E_LIMIT_EXCEEDED',
  'TV_E_NOT_ZIP',
  'TV_E_UNSUPPORTED_CONTAINER',
  'TV_E_ZIP_CORRUPT',
  'TV_E_ZIP_UNSUPPORTED',
  'TV_E_XML_MALFORMED',
  'TV_E_XML_DTD_FORBIDDEN',
  'TV_E_XML_ENTITY_FORBIDDEN',
  'TV_E_XML_ENCODING',
  'TV_E_PART_MISSING',
  'TV_E_PART_INVALID',
  'TV_E_NOT_SUPPORTED',
  'TV_E_TEMPLATE_INVALID',
  'TV_E_TAG_UNCLOSED',
  'TV_E_TAG_UNOPENED',
  'TV_E_TAG_EMPTY',
  'TV_E_TAG_SYNTAX',
  'TV_E_TAG_FORBIDDEN_NAME',
  'TV_E_SECTION_UNCLOSED',
  'TV_E_SECTION_UNOPENED',
  'TV_E_SECTION_MISMATCH',
  'TV_E_SECTION_PLACEMENT',
  'TV_E_TAG_PLACEMENT',
  'TV_E_TEXT_NOT_FOUND',
  'TV_E_REPLACEMENT_OVERLAP',
  'TV_E_FORMATTER_UNKNOWN',
  'TV_E_FORMATTER_ARGS',
  'TV_E_DATA_INVALID',
  'TV_E_MISSING_FIELD',
  'TV_E_INVALID_VALUE',
  'TV_E_IMAGE_FETCH',
  'TV_E_USAGE',
  'TV_E_FILE_READ',
  'TV_E_FILE_EXISTS',
  'TV_E_FILE_WRITE',
  'TV_E_INTERNAL',
] as const;

/**
 * Every warning code tplvane can report. Warnings never stop the work; they describe something
 * in the template that the caller may want to know about. Each one is described in docs/errors.md.
 *
 * @example
 * ```ts
 * import { WARNING_CODES } from 'tplvane';
 * console.log(WARNING_CODES.includes('TV_W_SCHEMA_CONFLICT')); // true
 * ```
 */
export const WARNING_CODES = ['TV_W_SCHEMA_CONFLICT', 'TV_W_PART_MISSING', 'TV_W_STYLE_MISSING', 'TV_W_DATA_SCHEMA', 'TV_W_FORMULA_NOT_EXTENDED'] as const;

/**
 * A stable error code, see {@link ERROR_CODES}.
 *
 * @example
 * ```ts
 * import { inspect, isTvError, type TvErrorCode } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   const code: TvErrorCode | undefined = isTvError(error) ? error.code : undefined;
 *   console.log(code === 'TV_E_NOT_ZIP' ? 'not a document' : code);
 * }
 * ```
 */
export type TvErrorCode = (typeof ERROR_CODES)[number];

/**
 * A stable warning code, see {@link WARNING_CODES}.
 *
 * @example
 * ```ts
 * import { inspect, type TvWarningCode } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const codes: TvWarningCode[] = inspect(bytes).warnings.map((warning) => warning.code);
 * console.log(codes);
 * ```
 */
export type TvWarningCode = (typeof WARNING_CODES)[number];

/**
 * The kind of text flow a location is in: the main body, a header, a footer, a footnote or an
 * endnote of a document, a slide or its notes in a presentation, or a sheet of a workbook.
 *
 * @example
 * ```ts
 * import type { TvStory } from 'tplvane';
 * const story: TvStory = 'header';
 * console.log(story);
 * ```
 */
export type TvStory = 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'slide' | 'notes' | 'sheet';

/**
 * A container around a place in a document: a table cell, a text box, or a shape of a slide (with
 * its name as the application shows it). Numbers start at 1, as a
 * person counts them; tables and text boxes are counted in the container they are in (the story,
 * a table cell or a text box).
 *
 * @example
 * ```ts
 * import type { TvContainer } from 'tplvane';
 * const cell: TvContainer = { kind: 'table', table: 2, row: 3, cell: 1 };
 * console.log(cell.kind);
 * ```
 */
export type TvContainer =
  | { readonly kind: 'table'; readonly table: number; readonly row: number; readonly cell: number }
  | { readonly kind: 'textBox'; readonly textBox: number }
  | { readonly kind: 'shape'; readonly shape: number; readonly name: string };

/**
 * Where in the input something happened. Only the fields that are known are present. Numbers
 * that a person reads (paragraph, table, row, cell, character) start at 1.
 *
 * @example
 * ```ts
 * import { inspect, isTvError, type TvLocation } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isTvError(error)) {
 *     const where: TvLocation = error.location;
 *     console.log(where.description ?? where.part);
 *   }
 * }
 * ```
 */
export interface TvLocation {
  /** Part inside the package, for example `/word/document.xml`. */
  readonly part?: string;
  /** The text flow the place is in. */
  readonly story?: TvStory;
  /** The slide, counted from 1 in the order of the presentation. */
  readonly slide?: number;
  /** The footnote or endnote, counted in the order of its part (usually the order in the document). */
  readonly note?: number;
  /** The sheet of a workbook, by its name. */
  readonly sheet?: string;
  /** The cell of a sheet, as an A1 reference such as `C5`. */
  readonly cell?: string;
  /** The table cells and text boxes around the place, outermost first. */
  readonly within?: readonly TvContainer[];
  /** The paragraph, counted in the innermost container: the story, a table cell or a text box. */
  readonly paragraph?: number;
  /** The character of the paragraph text where the tag starts. */
  readonly character?: number;
  /** 1-based line inside an XML part. */
  readonly line?: number;
  /** 1-based column inside an XML part. */
  readonly column?: number;
  /** Byte offset in the input file (ZIP structures). */
  readonly offset?: number;
  /** The place in words, for example `body, table 2 row 3 cell 1, paragraph 1` or `sheet Data, cell C5`. */
  readonly description?: string;
}

/**
 * Value types allowed in {@link TvError.details}; everything is JSON-safe.
 *
 * @example
 * ```ts
 * import { inspect, isTvError, type TvDetailValue } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isTvError(error)) {
 *     const tag: TvDetailValue | undefined = error.details['tag'];
 *     console.log(tag);
 *   }
 * }
 * ```
 */
export type TvDetailValue = string | number | boolean | null | readonly string[] | readonly number[];

/**
 * Machine-readable details of an error. Keys are chosen by tplvane, never taken from the file.
 *
 * @example
 * ```ts
 * import { inspect, isTvError, type TvDetails } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isTvError(error)) {
 *     const details: TvDetails = error.details;
 *     console.log(Object.keys(details));
 *   }
 * }
 * ```
 */
export type TvDetails = Readonly<Record<string, TvDetailValue>>;

/**
 * The JSON form of a {@link TvError}, as returned by {@link TvError.toJSON}.
 *
 * @example
 * ```ts
 * import { inspect, isTvError, type TvErrorJSON } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isTvError(error)) {
 *     const json: TvErrorJSON = error.toJSON();
 *     console.log(JSON.stringify(json));
 *   }
 * }
 * ```
 */
export interface TvErrorJSON {
  readonly name: 'TvError';
  readonly code: TvErrorCode;
  readonly message: string;
  readonly location: TvLocation;
  readonly hint: string;
  readonly docsUrl: string;
  readonly details: TvDetails;
  /** The single problems behind `TV_E_TEMPLATE_INVALID` and `TV_E_DATA_INVALID`; empty for other codes. */
  readonly errors: readonly TvErrorJSON[];
}

/**
 * Options for constructing a {@link TvError}.
 *
 * @example
 * ```ts
 * import { TvError, type TvErrorInit } from 'tplvane';
 *
 * const init: TvErrorInit = {
 *   location: { part: '/word/document.xml', paragraph: 2 },
 *   hint: 'Close the tag with "}".',
 *   details: { tag: '{name' },
 * };
 * const error = new TvError('TV_E_TAG_UNCLOSED', 'The tag "{name" is not closed.', init);
 * console.log(error.docsUrl);
 * ```
 */
export interface TvErrorInit {
  /** Where the problem is. */
  readonly location?: TvLocation;
  /** What to do next, phrased as an instruction. */
  readonly hint: string;
  /** Machine-readable details. */
  readonly details?: TvDetails;
  /** The single problems behind an aggregated error (`TV_E_TEMPLATE_INVALID`, `TV_E_DATA_INVALID`). */
  readonly errors?: readonly TvError[];
  /** The underlying error, if any. */
  readonly cause?: unknown;
}

/**
 * The only error type thrown by tplvane for problems with templates, data or options. It says
 * what happened (`message`), where (`location`), what to do next (`hint`) and links to the
 * description of the code (`docsUrl`). `toJSON()` returns the same information as data. When a
 * template has several syntax problems, one `TV_E_TEMPLATE_INVALID` lists them all in `errors`.
 *
 * @example
 * ```ts
 * import { inspect, isTvError } from 'tplvane';
 *
 * try {
 *   inspect(new Uint8Array([1, 2, 3]));
 * } catch (error) {
 *   if (isTvError(error)) console.log(error.code, error.hint); // "TV_E_NOT_ZIP", "..."
 * }
 * ```
 */
export class TvError extends Error {
  override readonly name: 'TvError' = 'TvError';
  /** Stable error code, see docs/errors.md. */
  readonly code: TvErrorCode;
  /** Where the problem is. Empty when the problem is not tied to a place in the file. */
  readonly location: TvLocation;
  /** What to do next. */
  readonly hint: string;
  /** Link to the description of the error code. */
  readonly docsUrl: string;
  /** Machine-readable details. */
  readonly details: TvDetails;
  /** The single problems behind `TV_E_TEMPLATE_INVALID` and `TV_E_DATA_INVALID`; empty for other codes. */
  readonly errors: readonly TvError[];

  constructor(code: TvErrorCode, message: string, init: TvErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = code;
    this.location = { ...init.location };
    this.hint = init.hint;
    this.docsUrl = `${DOCS_URL}#${code.toLowerCase()}`;
    this.details = { ...init.details };
    this.errors = [...(init.errors ?? [])];
  }

  /** Returns the error as plain JSON-safe data. */
  toJSON(): TvErrorJSON {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      location: { ...this.location },
      hint: this.hint,
      docsUrl: this.docsUrl,
      details: { ...this.details },
      errors: this.errors.map((error) => error.toJSON()),
    };
  }
}

/**
 * Returns `true` if `value` is a {@link TvError}.
 *
 * @example
 * ```ts
 * import { isTvError } from 'tplvane';
 * console.log(isTvError(new Error('x'))); // false
 * ```
 */
export function isTvError(value: unknown): value is TvError {
  return value instanceof TvError;
}

/**
 * A warning about the template. Warnings never stop the work.
 *
 * @example
 * ```ts
 * import { inspect, type TvWarning } from 'tplvane';
 *
 * declare const bytes: Uint8Array;
 * const warnings: readonly TvWarning[] = inspect(bytes).warnings;
 * for (const warning of warnings) console.log(warning.code, warning.message);
 * ```
 */
export interface TvWarning {
  readonly code: TvWarningCode;
  readonly message: string;
  readonly location: TvLocation;
  readonly hint: string;
  /** Machine-readable details, for example the path of a field in the data (`pointer`, `dataPath`). */
  readonly details?: TvDetails;
}

/** One error of `code` that lists `problems` in `errors` (render, inspect). @internal */
export function aggregate(code: 'TV_E_TEMPLATE_INVALID' | 'TV_E_DATA_INVALID', problems: readonly TvError[], truncated: boolean): TvError {
  const first = problems[0] as TvError;
  const count = problems.length;
  const what = code === 'TV_E_TEMPLATE_INVALID' ? 'template' : 'data';
  return new TvError(code, count === 1 ? `The ${what} has a problem: ${first.message}` : `The ${what} has ${String(count)}${truncated ? ' or more' : ''} problems. The first: ${first.message}`, {
    location: first.location,
    hint: `Fix the problems listed in "errors"; each one has its place in the template${code === 'TV_E_DATA_INVALID' ? ' and names the field' : ''}. The first: ${first.hint}`,
    details: { count, truncated },
    errors: problems,
  });
}
