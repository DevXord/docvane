// Errors and warnings of docvane. Modelled on src/errors.ts of DevXord/xlvane at aeaefbc (the
// shape of the error: code, message, location, hint, details, cause, toJSON), rewritten for
// docvane: `DV_E_*` codes, document locations and aggregated template errors (D-009, D-013).

/** Base URL of the error catalogue. Every code has a heading (and so an anchor) there. */
const DOCS_URL = 'https://github.com/DevXord/docvane/blob/main/docs/errors.md';

/**
 * Every error code docvane can throw. Codes are stable: a code is never reused for a different
 * condition. Each one is described in docs/errors.md.
 *
 * @example
 * ```ts
 * import { ERROR_CODES } from 'docvane';
 * console.log(ERROR_CODES.includes('DV_E_TAG_UNCLOSED')); // true
 * ```
 */
export const ERROR_CODES = [
  'DV_E_INVALID_INPUT',
  'DV_E_INVALID_OPTION',
  'DV_E_LIMIT_EXCEEDED',
  'DV_E_NOT_ZIP',
  'DV_E_UNSUPPORTED_CONTAINER',
  'DV_E_ZIP_CORRUPT',
  'DV_E_ZIP_UNSUPPORTED',
  'DV_E_XML_MALFORMED',
  'DV_E_XML_DTD_FORBIDDEN',
  'DV_E_XML_ENTITY_FORBIDDEN',
  'DV_E_XML_ENCODING',
  'DV_E_PART_MISSING',
  'DV_E_PART_INVALID',
  'DV_E_NOT_SUPPORTED',
  'DV_E_TEMPLATE_INVALID',
  'DV_E_TAG_UNCLOSED',
  'DV_E_TAG_UNOPENED',
  'DV_E_TAG_EMPTY',
  'DV_E_TAG_SYNTAX',
  'DV_E_TAG_FORBIDDEN_NAME',
  'DV_E_SECTION_UNCLOSED',
  'DV_E_SECTION_UNOPENED',
  'DV_E_SECTION_MISMATCH',
  'DV_E_INTERNAL',
] as const;

/**
 * Every warning code docvane can report. Warnings never stop the work; they describe something
 * in the template that the caller may want to know about. Each one is described in docs/errors.md.
 *
 * @example
 * ```ts
 * import { WARNING_CODES } from 'docvane';
 * console.log(WARNING_CODES.includes('DV_W_SCHEMA_CONFLICT')); // true
 * ```
 */
export const WARNING_CODES = ['DV_W_SCHEMA_CONFLICT', 'DV_W_PART_MISSING'] as const;

/**
 * A stable error code, see {@link ERROR_CODES}.
 *
 * @example
 * ```ts
 * import { inspect, isDvError, type DvErrorCode } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   const code: DvErrorCode | undefined = isDvError(error) ? error.code : undefined;
 *   console.log(code === 'DV_E_NOT_ZIP' ? 'not a document' : code);
 * }
 * ```
 */
export type DvErrorCode = (typeof ERROR_CODES)[number];

/**
 * A stable warning code, see {@link WARNING_CODES}.
 *
 * @example
 * ```ts
 * import { inspect, type DvWarningCode } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const codes: DvWarningCode[] = inspect(bytes).warnings.map((warning) => warning.code);
 * console.log(codes);
 * ```
 */
export type DvWarningCode = (typeof WARNING_CODES)[number];

/**
 * The kind of text flow a location is in: the main body, a header, a footer, a footnote or an
 * endnote.
 *
 * @example
 * ```ts
 * import type { DvStory } from 'docvane';
 * const story: DvStory = 'header';
 * console.log(story);
 * ```
 */
export type DvStory = 'body' | 'header' | 'footer' | 'footnote' | 'endnote';

/**
 * A container around a place in a document: a table cell or a text box. Numbers start at 1, as a
 * person counts them; tables and text boxes are counted in the container they are in (the story,
 * a table cell or a text box).
 *
 * @example
 * ```ts
 * import type { DvContainer } from 'docvane';
 * const cell: DvContainer = { kind: 'table', table: 2, row: 3, cell: 1 };
 * console.log(cell.kind);
 * ```
 */
export type DvContainer =
  | { readonly kind: 'table'; readonly table: number; readonly row: number; readonly cell: number }
  | { readonly kind: 'textBox'; readonly textBox: number };

/**
 * Where in the input something happened. Only the fields that are known are present. Numbers
 * that a person reads (paragraph, table, row, cell, character) start at 1.
 *
 * @example
 * ```ts
 * import { inspect, isDvError, type DvLocation } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isDvError(error)) {
 *     const where: DvLocation = error.location;
 *     console.log(where.description ?? where.part);
 *   }
 * }
 * ```
 */
export interface DvLocation {
  /** Part inside the package, for example `/word/document.xml`. */
  readonly part?: string;
  /** The text flow the place is in. */
  readonly story?: DvStory;
  /** The footnote or endnote, counted in the order of its part (usually the order in the document). */
  readonly note?: number;
  /** The table cells and text boxes around the place, outermost first. */
  readonly within?: readonly DvContainer[];
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
  /** The place in words, for example `body, table 2 row 3 cell 1, paragraph 1`. */
  readonly description?: string;
}

/**
 * Value types allowed in {@link DvError.details}; everything is JSON-safe.
 *
 * @example
 * ```ts
 * import { inspect, isDvError, type DvDetailValue } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isDvError(error)) {
 *     const tag: DvDetailValue | undefined = error.details['tag'];
 *     console.log(tag);
 *   }
 * }
 * ```
 */
export type DvDetailValue = string | number | boolean | null | readonly string[] | readonly number[];

/**
 * Machine-readable details of an error. Keys are chosen by docvane, never taken from the file.
 *
 * @example
 * ```ts
 * import { inspect, isDvError, type DvDetails } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isDvError(error)) {
 *     const details: DvDetails = error.details;
 *     console.log(Object.keys(details));
 *   }
 * }
 * ```
 */
export type DvDetails = Readonly<Record<string, DvDetailValue>>;

/**
 * The JSON form of a {@link DvError}, as returned by {@link DvError.toJSON}.
 *
 * @example
 * ```ts
 * import { inspect, isDvError, type DvErrorJSON } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * try {
 *   inspect(bytes);
 * } catch (error) {
 *   if (isDvError(error)) {
 *     const json: DvErrorJSON = error.toJSON();
 *     console.log(JSON.stringify(json));
 *   }
 * }
 * ```
 */
export interface DvErrorJSON {
  readonly name: 'DvError';
  readonly code: DvErrorCode;
  readonly message: string;
  readonly location: DvLocation;
  readonly hint: string;
  readonly docsUrl: string;
  readonly details: DvDetails;
  /** The single problems behind `DV_E_TEMPLATE_INVALID`; empty for other codes. */
  readonly errors: readonly DvErrorJSON[];
}

/**
 * Options for constructing a {@link DvError}.
 *
 * @example
 * ```ts
 * import { DvError, type DvErrorInit } from 'docvane';
 *
 * const init: DvErrorInit = {
 *   location: { part: '/word/document.xml', paragraph: 2 },
 *   hint: 'Close the tag with "}".',
 *   details: { tag: '{name' },
 * };
 * const error = new DvError('DV_E_TAG_UNCLOSED', 'The tag "{name" is not closed.', init);
 * console.log(error.docsUrl);
 * ```
 */
export interface DvErrorInit {
  /** Where the problem is. */
  readonly location?: DvLocation;
  /** What to do next, phrased as an instruction. */
  readonly hint: string;
  /** Machine-readable details. */
  readonly details?: DvDetails;
  /** The single problems behind an aggregated error (`DV_E_TEMPLATE_INVALID`). */
  readonly errors?: readonly DvError[];
  /** The underlying error, if any. */
  readonly cause?: unknown;
}

/**
 * The only error type thrown by docvane for problems with templates, data or options. It says
 * what happened (`message`), where (`location`), what to do next (`hint`) and links to the
 * description of the code (`docsUrl`). `toJSON()` returns the same information as data. When a
 * template has several syntax problems, one `DV_E_TEMPLATE_INVALID` lists them all in `errors`.
 *
 * @example
 * ```ts
 * import { inspect, isDvError } from 'docvane';
 *
 * try {
 *   inspect(new Uint8Array([1, 2, 3]));
 * } catch (error) {
 *   if (isDvError(error)) console.log(error.code, error.hint); // "DV_E_NOT_ZIP", "..."
 * }
 * ```
 */
export class DvError extends Error {
  override readonly name: 'DvError' = 'DvError';
  /** Stable error code, see docs/errors.md. */
  readonly code: DvErrorCode;
  /** Where the problem is. Empty when the problem is not tied to a place in the file. */
  readonly location: DvLocation;
  /** What to do next. */
  readonly hint: string;
  /** Link to the description of the error code. */
  readonly docsUrl: string;
  /** Machine-readable details. */
  readonly details: DvDetails;
  /** The single problems behind `DV_E_TEMPLATE_INVALID`; empty for other codes. */
  readonly errors: readonly DvError[];

  constructor(code: DvErrorCode, message: string, init: DvErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = code;
    this.location = { ...init.location };
    this.hint = init.hint;
    this.docsUrl = `${DOCS_URL}#${code.toLowerCase()}`;
    this.details = { ...init.details };
    this.errors = [...(init.errors ?? [])];
  }

  /** Returns the error as plain JSON-safe data. */
  toJSON(): DvErrorJSON {
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
 * Returns `true` if `value` is a {@link DvError}.
 *
 * @example
 * ```ts
 * import { isDvError } from 'docvane';
 * console.log(isDvError(new Error('x'))); // false
 * ```
 */
export function isDvError(value: unknown): value is DvError {
  return value instanceof DvError;
}

/**
 * A warning about the template. Warnings never stop the work.
 *
 * @example
 * ```ts
 * import { inspect, type DvWarning } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const warnings: readonly DvWarning[] = inspect(bytes).warnings;
 * for (const warning of warnings) console.log(warning.code, warning.message);
 * ```
 */
export interface DvWarning {
  readonly code: DvWarningCode;
  readonly message: string;
  readonly location: DvLocation;
  readonly hint: string;
}
