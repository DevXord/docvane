// The allow-listed formatters (docs/syntax.md, "Formatters"). Templates can call these and nothing
// else: the list is a Map, so names such as "toString" or "constructor" are not in it, and the
// arguments are literals, so they are checked when the template is read, before any data is seen.
// Numbers, currencies and dates are formatted with Intl, in the locale and time zone of the
// render options (D-025).
import type { FormatterArg, FormatterCall } from '../model';
import { checkLinkUrl } from '../docx/urls';
import { suggest } from '../util/suggest';

/** Locale and time zone that formatters use. */
export interface FormatContext {
  readonly locale: string;
  readonly timeZone: string;
}

/** Thrown by a formatter for a value it cannot format; becomes DV_E_INVALID_VALUE with the tag's place. */
export class ValueError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** The result of the `link` formatter: the renderer writes it as a hyperlink. */
export class LinkValue {
  constructor(
    readonly url: string,
    readonly text: string,
  ) {}
}

/** Why a formatter call in a template is not valid. */
export interface FormatterProblem {
  readonly code: 'DV_E_FORMATTER_UNKNOWN' | 'DV_E_FORMATTER_ARGS';
  readonly message: string;
  readonly hint: string;
}

type ParamType = 'string' | 'integer' | 'any';

interface Param {
  readonly name: string;
  readonly type: ParamType;
  readonly optional?: boolean;
}

interface Spec {
  readonly params: readonly Param[];
  readonly usage: string;
  /** Checks the arguments beyond their types; returns a message, or null when they are fine. */
  readonly check?: (args: readonly FormatterArg[]) => string | null;
  readonly apply: (value: unknown, args: readonly FormatterArg[], ctx: Formatting) => unknown;
}

const DATE_STYLES: ReadonlySet<string> = new Set(['short', 'medium', 'long', 'full']);
const MAX_DECIMALS = 20;

/** Intl objects are costly to create, so a render keeps them. */
export class Formatting {
  private readonly cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

  constructor(readonly ctx: FormatContext) {}

  number(options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const key = `n${JSON.stringify(options)}`;
    let f = this.cache.get(key);
    if (f === undefined) {
      // No sign for zero: -0.4 rounded to "0" is not "-0" (D-071).
      f = new Intl.NumberFormat(this.ctx.locale, { signDisplay: 'negative', ...options });
      this.cache.set(key, f);
    }
    return f as Intl.NumberFormat;
  }

  date(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `d${locale}${JSON.stringify(options)}`;
    let f = this.cache.get(key);
    if (f === undefined) {
      f = new Intl.DateTimeFormat(locale, options);
      this.cache.set(key, f);
    }
    return f as Intl.DateTimeFormat;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (value instanceof Date) return 'a date';
  if (typeof value === 'string') return `the text ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  if (typeof value === 'object') return 'an object';
  return `${typeof value} ${String(value)}`;
}

/** Text formatters accept strings, numbers and booleans; missing and null values pass through. */
function text(op: (s: string, ctx: Formatting) => string, name: string): Spec['apply'] {
  return (value, _args, ctx) => {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') return op(value, ctx);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return op(String(value), ctx);
    throw new ValueError(`${name} cannot format ${describe(value)}.`, `Pass text, a number or true/false to ${name}.`);
  };
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new ValueError(`${name} needs a number, but the value is ${describe(value)}.`, 'Pass a number in the data, for example 1234.5, not text such as "1234,50".');
}

function decimals(args: readonly FormatterArg[], at: number): Intl.NumberFormatOptions {
  const d = args[at];
  return typeof d === 'number' ? { minimumFractionDigits: d, maximumFractionDigits: d } : {};
}

const checkDecimals =
  (at: number) =>
  (args: readonly FormatterArg[]): string | null => {
    const d = args[at];
    return typeof d === 'number' && (d < 0 || d > MAX_DECIMALS) ? `The number of decimals must be from 0 to ${String(MAX_DECIMALS)}.` : null;
  };

// ISO 8601 calendar dates and times as JSON and most systems write them (D-025).
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** The instant of a date value, and the time zone to show it in. Times without an offset are shown as written. */
function toInstant(value: unknown, ctx: Formatting): { time: number; timeZone: string } {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) throw new ValueError('date cannot format an invalid Date.', 'Pass a valid Date or an ISO 8601 text such as "2026-11-06".');
    return { time, timeZone: ctx.ctx.timeZone };
  }
  if (typeof value === 'string') {
    const m = ISO.exec(value);
    if (m !== null) {
      const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', offset] = m;
      const ms = Number(frac.padEnd(3, '0').slice(0, 3));
      // setUTCFullYear, because Date.UTC reads the years 0 to 99 as 1900 to 1999 (D-071).
      const day = new Date(Date.UTC(2000, 0, 1, Number(h), Number(mi), Number(s), ms));
      day.setUTCFullYear(Number(y), Number(mo) - 1, Number(d));
      const local = day.getTime();
      const check = new Date(local);
      const valid =
        check.getUTCFullYear() === Number(y) && check.getUTCMonth() === Number(mo) - 1 && check.getUTCDate() === Number(d) && check.getUTCHours() === Number(h) && check.getUTCMinutes() === Number(mi) && check.getUTCSeconds() === Number(s);
      if (valid) {
        if (offset === undefined) return { time: local, timeZone: 'UTC' };
        if (offset === 'Z') return { time: local, timeZone: ctx.ctx.timeZone };
        if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59) throw new ValueError(`date cannot format ${describe(value)}: the time zone offset is not valid.`, 'Use an offset such as +01:00 or -05:30.');
        const sign = offset.startsWith('-') ? -1 : 1;
        const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6));
        return { time: local - sign * minutes * 60_000, timeZone: ctx.ctx.timeZone };
      }
    }
  }
  throw new ValueError(`date cannot format ${describe(value)}.`, 'Pass a Date or an ISO 8601 text such as "2026-11-06" or "2026-11-06T14:30:00Z".');
}

/** A token of a date pattern: a field such as `yyyy`, or literal text. */
type PatternToken = { readonly field: string } | { readonly literal: string };

const PATTERN_FIELDS: ReadonlySet<string> = new Set(['yyyy', 'yy', 'MMMM', 'MMM', 'MM', 'M', 'dd', 'd', 'HH', 'H', 'mm', 'ss']);

/** Splits a date pattern into tokens, or returns a message for a pattern that is not valid. */
export function parseDatePattern(pattern: string): PatternToken[] | string {
  const out: PatternToken[] = [];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i] as string;
    if (c === "'") {
      let literal = '';
      i++;
      for (;;) {
        if (i >= pattern.length) return 'A quote in the date pattern is not closed.';
        if (pattern[i] === "'") {
          if (pattern[i + 1] === "'") {
            literal += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        literal += pattern[i];
        i++;
      }
      out.push({ literal: literal === '' ? "'" : literal });
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      let j = i;
      while (pattern[j] === c) j++;
      const run = pattern.slice(i, j);
      if (!PATTERN_FIELDS.has(run)) return `"${run}" is not a field of a date pattern.`;
      out.push({ field: run });
      i = j;
      continue;
    }
    out.push({ literal: c });
    i++;
  }
  return out;
}

function formatPattern(tokens: readonly PatternToken[], time: number, timeZone: string, ctx: Formatting): string {
  const parts = new Map<string, string>();
  for (const p of ctx.date('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(time)) {
    parts.set(p.type, p.value);
  }
  const num = (type: string): number => Number(parts.get(type) ?? '0');
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  const monthName = (width: 'long' | 'short'): string => {
    // The month as it is written next to a day ("6 listopada" in Polish), not on its own.
    const formatted = ctx.date(ctx.ctx.locale, { timeZone, day: 'numeric', month: width }).formatToParts(time);
    return formatted.find((p) => p.type === 'month')?.value ?? '';
  };
  return tokens
    .map((token) => {
      if ('literal' in token) return token.literal;
      switch (token.field) {
        case 'yyyy':
          return pad(num('year'), 4);
        case 'yy':
          return pad(num('year') % 100, 2);
        case 'MMMM':
          return monthName('long');
        case 'MMM':
          return monthName('short');
        case 'MM':
          return pad(num('month'), 2);
        case 'M':
          return String(num('month'));
        case 'dd':
          return pad(num('day'), 2);
        case 'd':
          return String(num('day'));
        case 'HH':
          return pad(num('hour'), 2);
        case 'H':
          return String(num('hour'));
        case 'mm':
          return pad(num('minute'), 2);
        default:
          return pad(num('second'), 2);
      }
    })
    .join('');
}

const FORMATTERS: ReadonlyMap<string, Spec> = new Map<string, Spec>([
  [
    'link',
    {
      params: [{ name: 'text', type: 'string', optional: true }],
      usage: 'link or link("Our website")',
      apply: (value, args) => {
        if (value === undefined || value === null) return value;
        if (typeof value !== 'string') throw new ValueError(`link needs an address as text, but the value is ${describe(value)}.`, 'Pass an address such as "https://example.com" or "mailto:office@example.com".');
        const problem = checkLinkUrl(value);
        if (problem !== null) throw new ValueError(`"${value.length > 60 ? `${value.slice(0, 60)}…` : value}" cannot be a link: ${problem}`, 'Use an absolute http, https or mailto address, such as "https://example.com".');
        return new LinkValue(value, typeof args[0] === 'string' ? args[0] : value);
      },
    },
  ],
  ['upper', { params: [], usage: 'upper', apply: text((s, ctx) => s.toLocaleUpperCase(ctx.ctx.locale), 'upper') }],
  ['lower', { params: [], usage: 'lower', apply: text((s, ctx) => s.toLocaleLowerCase(ctx.ctx.locale), 'lower') }],
  [
    'capitalize',
    {
      params: [],
      usage: 'capitalize',
      apply: text((s, ctx) => {
        const first = s.codePointAt(0);
        if (first === undefined) return s;
        const head = String.fromCodePoint(first);
        return head.toLocaleUpperCase(ctx.ctx.locale) + s.slice(head.length);
      }, 'capitalize'),
    },
  ],
  ['trim', { params: [], usage: 'trim', apply: text((s) => s.trim(), 'trim') }],
  [
    'default',
    {
      params: [{ name: 'value', type: 'any' }],
      usage: 'default("-")',
      apply: (value, args) => (value === undefined || value === null || value === '' ? args[0] : value),
    },
  ],
  [
    'number',
    {
      params: [{ name: 'decimals', type: 'integer', optional: true }],
      usage: 'number or number(2)',
      check: checkDecimals(0),
      apply: (value, args, ctx) => (value === undefined || value === null ? value : ctx.number(decimals(args, 0)).format(finiteNumber(value, 'number'))),
    },
  ],
  [
    'percent',
    {
      params: [{ name: 'decimals', type: 'integer', optional: true }],
      usage: 'percent or percent(1)',
      check: checkDecimals(0),
      apply: (value, args, ctx) => (value === undefined || value === null ? value : ctx.number({ style: 'percent', ...decimals(args, 0) }).format(finiteNumber(value, 'percent'))),
    },
  ],
  [
    'currency',
    {
      params: [
        { name: 'code', type: 'string' },
        { name: 'decimals', type: 'integer', optional: true },
      ],
      usage: 'currency("PLN") or currency("EUR", 0)',
      check: (args) => (/^[A-Za-z]{3}$/.test(String(args[0])) ? checkDecimals(1)(args) : 'The currency must be a three-letter ISO 4217 code, such as "PLN", "EUR" or "USD".'),
      apply: (value, args, ctx) =>
        value === undefined || value === null ? value : ctx.number({ style: 'currency', currency: String(args[0]).toUpperCase(), ...decimals(args, 1) }).format(finiteNumber(value, 'currency')),
    },
  ],
  [
    'date',
    {
      params: [{ name: 'format', type: 'string', optional: true }],
      usage: 'date, date("long") or date("dd.MM.yyyy")',
      check: (args) => {
        const format = args[0];
        if (typeof format !== 'string' || DATE_STYLES.has(format)) return null;
        const tokens = parseDatePattern(format);
        return typeof tokens === 'string' ? `${tokens} Use short, medium, long or full, or a pattern of yyyy, yy, MMMM, MMM, MM, M, dd, d, HH, H, mm and ss, with text in 'quotes'.` : null;
      },
      apply: (value, args, ctx) => {
        if (value === undefined || value === null) return value;
        const { time, timeZone } = toInstant(value, ctx);
        const format = typeof args[0] === 'string' ? args[0] : 'medium';
        if (DATE_STYLES.has(format)) return ctx.date(ctx.ctx.locale, { dateStyle: format as 'short', timeZone }).format(time);
        return formatPattern(parseDatePattern(format) as PatternToken[], time, timeZone, ctx);
      },
    },
  ],
]);

/** The names of the formatters, for messages. */
export const FORMATTER_NAMES: readonly string[] = [...FORMATTERS.keys()];

function typeOk(type: ParamType, value: FormatterArg): boolean {
  if (type === 'any') return true;
  if (type === 'string') return typeof value === 'string';
  return typeof value === 'number' && Number.isInteger(value);
}

/** Checks a formatter call of a template: the name is allowed and the arguments fit. */
export function checkFormatter(call: FormatterCall): FormatterProblem | null {
  const spec = FORMATTERS.get(call.name);
  if (spec === undefined) {
    const close = suggest(call.name, FORMATTER_NAMES);
    return {
      code: 'DV_E_FORMATTER_UNKNOWN',
      message: `There is no formatter "${call.name}".`,
      hint: `${close.length > 0 ? `Did you mean ${close.map((c) => `"${c}"`).join(' or ')}? ` : ''}The formatters are ${FORMATTER_NAMES.join(', ')}.`,
    };
  }
  const required = spec.params.filter((p) => p.optional !== true).length;
  const bad = (message: string): FormatterProblem => ({ code: 'DV_E_FORMATTER_ARGS', message, hint: `Write it as ${spec.usage}.` });
  if (call.args.length < required || call.args.length > spec.params.length) {
    return bad(`${call.name} takes ${required === spec.params.length ? String(required) : `${String(required)} to ${String(spec.params.length)}`} argument${spec.params.length === 1 ? '' : 's'}, not ${String(call.args.length)}.`);
  }
  for (let i = 0; i < call.args.length; i++) {
    const param = spec.params[i] as Param;
    if (!typeOk(param.type, call.args[i] as FormatterArg)) return bad(`The ${param.name} of ${call.name} must be ${param.type === 'string' ? 'a string in quotes' : 'a whole number'}.`);
  }
  const message = spec.check?.(call.args) ?? null;
  return message === null ? null : bad(message);
}

/** Applies a formatter that {@link checkFormatter} accepted. Throws {@link ValueError} for a value it cannot format. */
export function applyFormatter(call: FormatterCall, value: unknown, ctx: Formatting): unknown {
  return (FORMATTERS.get(call.name) as Spec).apply(value, call.args, ctx);
}
