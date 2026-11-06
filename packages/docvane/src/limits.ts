// Copied from DevXord/xlvane packages/xlvane/src/limits.ts at aeaefbc (unchanged since ada547b),
// adapted for docvane (D-009, D-014): DvError and DV_E_* codes; the spreadsheet limits
// (`maxCells`, `maxSharedStringChars`) and their checks left out; template limits added next to
// the read limits, so one `limits` option covers both.
import { DvError, type DvLocation } from './errors';
import { suggest } from './util/suggest';

/**
 * Resource limits applied while reading a file. Every limit protects against a class of
 * malicious or broken input (zip bombs, deeply nested XML). Exceeding a limit throws
 * `DV_E_LIMIT_EXCEEDED`; the error's `details.limit` names the limit. Any limit can be set to
 * `Infinity` to switch it off.
 *
 * @example
 * ```ts
 * import { inspect, type ReadLimits } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const limits: Partial<ReadLimits> = { maxInputBytes: Infinity };
 * console.log(inspect(bytes, { limits }).tags.length);
 * ```
 */
export interface ReadLimits {
  /** Maximum size of the input file in bytes. Default 256 MiB. */
  readonly maxInputBytes: number;
  /** Maximum number of entries in the ZIP central directory. Default 10 000. */
  readonly maxEntries: number;
  /** Maximum decompressed size of one ZIP entry, measured while decompressing. Default 256 MiB. */
  readonly maxEntryBytes: number;
  /** Maximum decompressed size of all entries read from one file. Default 512 MiB. */
  readonly maxTotalBytes: number;
  /** Maximum ratio of decompressed to compressed size of one entry. Default 200. */
  readonly maxCompressionRatio: number;
  /** The compression ratio is checked only once an entry has produced this many bytes. Default 1 MiB. */
  readonly compressionRatioMinBytes: number;
  /** Maximum element nesting depth in an XML part. Default 128. */
  readonly maxXmlDepth: number;
  /** Maximum number of attributes on one XML element. Default 256. */
  readonly maxXmlAttributes: number;
  /** Maximum length of an XML element or attribute name. Default 1 024 characters. */
  readonly maxXmlNameLength: number;
  /** Maximum length of one XML text node, attribute value, comment or processing instruction. Default 8 Mi characters. */
  readonly maxXmlTextLength: number;
  /** Maximum number of elements plus attributes in a part that is parsed into a tree (relationships, content types). Default 1 000 000. */
  readonly maxXmlTreeElements: number;
}

/**
 * Limits on the template itself. Like {@link ReadLimits}, exceeding one throws
 * `DV_E_LIMIT_EXCEEDED` and any of them can be set to `Infinity`.
 *
 * @example
 * ```ts
 * import { inspect, type TemplateLimits } from 'docvane';
 *
 * declare const bytes: Uint8Array;
 * const limits: Partial<TemplateLimits> = { maxTags: 1000 };
 * console.log(inspect(bytes, { limits }).tags.length);
 * ```
 */
export interface TemplateLimits {
  /** Maximum length of one tag, braces included, in UTF-16 code units. Default 1 024. */
  readonly maxTagLength: number;
  /** Maximum number of tags in the template. Default 100 000. */
  readonly maxTags: number;
  /** Maximum nesting depth of sections (loops and conditions). Default 32. */
  readonly maxSectionDepth: number;
  /** Most template problems collected into one `DV_E_TEMPLATE_INVALID` before reading stops. Default 100. */
  readonly maxErrors: number;
}

/**
 * All limits: those of reading the file and those of the template.
 *
 * @example
 * ```ts
 * import { DEFAULT_LIMITS, type Limits } from 'docvane';
 * const limits: Limits = { ...DEFAULT_LIMITS, maxTags: 500 };
 * console.log(limits.maxTags);
 * ```
 */
export interface Limits extends ReadLimits, TemplateLimits {}

const MiB = 1024 * 1024;

/**
 * The default {@link Limits}. Frozen; pass `{ limits: { ... } }` to change individual values.
 *
 * @example
 * ```ts
 * import { DEFAULT_LIMITS } from 'docvane';
 * console.log(DEFAULT_LIMITS.maxEntries, DEFAULT_LIMITS.maxTagLength); // 10000 1024
 * ```
 */
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxInputBytes: 256 * MiB,
  maxEntries: 10_000,
  maxEntryBytes: 256 * MiB,
  maxTotalBytes: 512 * MiB,
  maxCompressionRatio: 200,
  compressionRatioMinBytes: 1 * MiB,
  maxXmlDepth: 128,
  maxXmlAttributes: 256,
  maxXmlNameLength: 1024,
  maxXmlTextLength: 8 * MiB,
  maxXmlTreeElements: 1_000_000,
  maxTagLength: 1024,
  maxTags: 100_000,
  maxSectionDepth: 32,
  maxErrors: 100,
});

const LIMIT_NAMES = Object.keys(DEFAULT_LIMITS) as (keyof Limits)[];

/**
 * Validates user-supplied limits and merges them over the defaults. Only own, known keys are
 * read, so keys such as `__proto__` cannot change anything; unknown keys are rejected.
 */
export function resolveLimits(input: unknown): Limits {
  const limits: Record<keyof Limits, number> = { ...DEFAULT_LIMITS };
  if (input === undefined) return limits;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DvError('DV_E_INVALID_OPTION', `Option "limits" must be an object, got ${describe(input)}.`, {
      hint: 'Pass an object such as { limits: { maxEntries: 10000 } }, or leave "limits" out to use the defaults.',
    });
  }
  for (const key of Object.keys(input)) {
    if (!(LIMIT_NAMES as string[]).includes(key)) {
      const close = suggest(key, LIMIT_NAMES);
      throw new DvError('DV_E_INVALID_OPTION', `Unknown limit "${key}".`, {
        hint:
          close.length > 0
            ? `Did you mean ${close.map((c) => `"${c}"`).join(' or ')}? Known limits: ${LIMIT_NAMES.join(', ')}.`
            : `Known limits: ${LIMIT_NAMES.join(', ')}.`,
        details: { option: key, known: LIMIT_NAMES },
      });
    }
  }
  for (const name of LIMIT_NAMES) {
    if (!Object.hasOwn(input, name)) continue;
    const value: unknown = (input as Record<string, unknown>)[name];
    limits[name] = validate(name, value);
  }
  return limits;
}

function validate(name: keyof Limits, value: unknown): number {
  const isRatio = name === 'maxCompressionRatio';
  const valid =
    typeof value === 'number' &&
    (value === Number.POSITIVE_INFINITY ||
      (isRatio ? Number.isFinite(value) && value >= 1 : Number.isSafeInteger(value) && value > 0));
  if (!valid) {
    throw new DvError(
      'DV_E_INVALID_OPTION',
      isRatio
        ? `Limit "${name}" must be a number of at least 1 or Infinity, got ${describe(value)}.`
        : `Limit "${name}" must be a whole number greater than 0 or Infinity, got ${describe(value)}.`,
      {
        hint: `Pass for example { limits: { ${name}: ${String(DEFAULT_LIMITS[name])} } }, or leave it out to use the default.`,
        details: { option: name },
      },
    );
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === 'object' || typeof value === 'function') return `a value of type ${typeof value}`;
  return String(value);
}

/** A `DV_E_LIMIT_EXCEEDED` error for `limit`, with the hint used by every template limit check. */
export function limitError(limit: keyof Limits, value: number, message: string, location: DvLocation = {}): DvError {
  return new DvError('DV_E_LIMIT_EXCEEDED', message, {
    location,
    hint: `If you trust this template, raise the limit, for example { limits: { ${limit}: ${String(Number.isFinite(value) ? value * 4 : value)} } }.`,
    details: { limit, value },
  });
}
