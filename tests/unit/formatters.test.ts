// The allow-listed formatters (docs/syntax.md, "Formatters"). Results of Intl are compared with
// Intl on the same machine, because the ICU data of Node.js versions differ in details.
import { describe, expect, it } from 'vitest';
import { render } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { bodyText } from '../helpers/read-docx';

const one = (tag: string, data: unknown, options = {}): string => bodyText(render(buildDocx({ body: p(tag) }), data, options))[0] ?? '';
const nf = (locale: string, o: Intl.NumberFormatOptions = {}) => new Intl.NumberFormat(locale, o);

describe('formatters', () => {
  it('change letter case and trim, locale-aware', () => {
    expect(one('{a | upper}|{a | lower}|{a | capitalize}|{b | trim}', { a: 'żółW', b: '  x  ' })).toBe('ŻÓŁW|żółw|ŻółW|x');
    expect(one('{a | upper}', { a: 'i' }, { locale: 'tr-TR' })).toBe('i'.toLocaleUpperCase('tr-TR'));
    expect(one('{n | upper}', { n: 12 })).toBe('12');
  });

  it('default replaces missing, null and empty values', () => {
    expect(one('{a | default("-")}{b | default("-")}{c | default("-")}{d | default("-")}{e | default(0)}', { b: null, c: '', d: 'x' })).toBe('---x0');
    expect(one('{a | upper | default("none")}', {})).toBe('none');
  });

  it('format numbers, percentages and currencies in the locale', () => {
    expect(one('{n | number}', { n: 1234567.891 }, { locale: 'pl-PL' })).toBe(nf('pl-PL').format(1234567.891));
    expect(one('{n | number(2)}', { n: 1234.5 }, { locale: 'en-US' })).toBe(nf('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234.5));
    expect(one('{n | percent}', { n: 0.256 })).toBe(nf('en-US', { style: 'percent' }).format(0.256));
    expect(one('{n | percent(1)}', { n: 0.256 }, { locale: 'pl-PL' })).toBe(nf('pl-PL', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(0.256));
    expect(one('{n | currency("PLN")}', { n: 1234.5 }, { locale: 'pl-PL' })).toBe(nf('pl-PL', { style: 'currency', currency: 'PLN' }).format(1234.5));
    expect(one('{n | currency(„eur”, 0)}', { n: 99.5 })).toBe(nf('en-US', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(99.5));
  });

  it('format dates with Intl styles, in the time zone of the options', () => {
    const at = new Date('2026-11-06T23:30:00Z');
    const style = (locale: string, dateStyle: 'short' | 'long', timeZone: string) => new Intl.DateTimeFormat(locale, { dateStyle, timeZone }).format(at);
    expect(one('{d | date("long")}', { d: at }, { locale: 'pl-PL', timeZone: 'Europe/Warsaw' })).toBe(style('pl-PL', 'long', 'Europe/Warsaw'));
    expect(one('{d | date("short")}', { d: '2026-11-06T23:30:00Z' })).toBe(style('en-US', 'short', 'UTC'));
    expect(one('{d | date}', { d: '2026-11-06' })).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 6)));
  });

  it('format dates with a pattern', () => {
    expect(one('{d | date("yyyy-MM-dd HH:mm:ss")}', { d: '2026-03-04T05:06:07Z' })).toBe('2026-03-04 05:06:07');
    expect(one('{d | date("d.M.yy H:mm")}', { d: '2026-03-04T05:06:07Z' })).toBe('4.3.26 5:06');
    expect(one("{d | date(\"'Day' dd, 'o''clock' HH\")}", { d: '2026-03-04T05:06:07Z' })).toBe("Day 04, o'clock 05");
    // Times with an offset are shown in the time zone of the options; times without one as written.
    expect(one('{d | date("dd HH:mm")}', { d: '2026-11-06T23:30:00Z' }, { timeZone: 'Europe/Warsaw' })).toBe('07 00:30');
    expect(one('{d | date("dd HH:mm")}', { d: '2026-11-06T23:30:00' }, { timeZone: 'Europe/Warsaw' })).toBe('06 23:30');
    expect(one('{d | date("HH:mm")}', { d: '2026-11-06T10:00:00+02:00' })).toBe('08:00');
  });

  it('write month names as they stand next to a day', () => {
    const at = Date.UTC(2026, 10, 6);
    const month = (locale: string, width: 'long' | 'short') => new Intl.DateTimeFormat(locale, { day: 'numeric', month: width, timeZone: 'UTC' }).formatToParts(at).find((x) => x.type === 'month')?.value;
    expect(one('{d | date("d MMMM yyyy")}', { d: '2026-11-06' }, { locale: 'pl-PL' })).toBe(`6 ${String(month('pl-PL', 'long'))} 2026`);
    expect(one('{d | date("MMM d")}', { d: '2026-11-06' })).toBe(`${String(month('en-US', 'short'))} 6`);
  });

  it('refuse values they cannot format', () => {
    for (const [tag, value] of [
      ['{x | number}', '12'],
      ['{x | currency("PLN")}', Number.NaN],
      ['{x | date}', '2026-02-30'],
      ['{x | date}', 'yesterday'],
      ['{x | date}', new Date('nope')],
      ['{x | upper}', { a: 1 }],
    ] as const) {
      const error = expectDvError(() => render(buildDocx({ body: p(tag) }), { x: value }), 'TV_E_DATA_INVALID');
      expect(error.errors[0]?.code, tag).toBe('TV_E_INVALID_VALUE');
    }
  });

  it('refuse wrong arguments when the template is read', () => {
    for (const tag of ['{x | currency}', '{x | currency("PLNN")}', '{x | number(21)}', '{x | number(1.5)}', '{x | upper(1)}', '{x | date("yyyy-QQ")}', "{x | date(\"'open\")}", '{x | default}']) {
      const error = expectDvError(() => render(buildDocx({ body: p(tag) }), { x: 1 }), 'TV_E_TEMPLATE_INVALID');
      expect(error.errors[0]?.code, tag).toBe('TV_E_FORMATTER_ARGS');
      expect(error.errors[0]?.hint, tag).toMatch(/Write it as/);
    }
  });
});
