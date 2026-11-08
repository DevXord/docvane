// validate: data against a template, without writing a file. Its errors are exactly those of
// render (a dry run), with the path of the field in the data; differences from the schema of
// inspect that render does not confirm are warnings (D-047).
import { describe, expect, it } from 'vitest';
import { render, templateSchema, validate, type TvError } from 'tplvane';
import { buildDocx, p, table } from '../helpers/docx';
import { ap, buildPptx, sp } from '../helpers/pptx';
import { buildXlsx } from '../helpers/xlsx';
import { expectDvError } from '../helpers/expect-error';

const offer = (): Uint8Array => buildDocx({ body: p('Dear {customer.name},') + table([[p('{#items}{name}'), p('{qty}{/items}')]]) + p('{#isVip}Thank you.{/isVip}{#vip}{discount}{/vip}') });
const good = { customer: { name: 'Anna' }, items: [{ name: 'Desk', qty: 1 }], vip: [] };
const summary = (errors: readonly TvError[]): unknown[] => errors.map((e) => [e.code, e.details['dataPath'], e.location.description]);

describe('validate', () => {
  it('accepts data that render accepts, and returns the schema of inspect', () => {
    const result = validate(offer(), good);
    expect(result).toMatchObject({ valid: true, errors: [], warnings: [] });
    expect(Object.keys(result.schema.properties ?? {})).toEqual(['customer', 'items', 'isVip', 'vip']);
  });

  it('lists every problem with the path of the field, the place in the template and the fields that are there', () => {
    const result = validate(offer(), { customer: {}, items: [{ name: 'Desk', qty: 1 }, { nme: 'Chair', qty: 4 }], vip: [] });
    expect(result.valid).toBe(false);
    expect(summary(result.errors)).toEqual([
      ['TV_E_MISSING_FIELD', 'customer.name', 'body, paragraph 1'],
      ['TV_E_MISSING_FIELD', 'items[1].name', 'body, table 1 row 1 cell 1, paragraph 1'],
    ]);
    const second = result.errors[1] as TvError;
    expect(second.details).toMatchObject({ pointer: '/items/1/name', available: ['nme', 'qty'] });
    expect(second.hint).toMatch(/Did you mean "nme"\?/);
    expect(second.hint).toMatch(/The data has here: nme, qty/);
  });

  it('gives the path of an invalid value', () => {
    const result = validate(offer(), { ...good, customer: { name: { first: 'Anna' } } });
    expect(result.errors.map((e) => [e.code, e.details['pointer']])).toEqual([['TV_E_INVALID_VALUE', '/customer/name']]);
  });

  it('agrees with render, error for error', () => {
    const data = { customer: {}, items: [{ qty: 1 }] };
    const error = expectDvError(() => render(offer(), data), 'TV_E_DATA_INVALID');
    expect(validate(offer(), data).errors.map((e) => [e.code, e.message, e.details])).toEqual(error.errors.map((e) => [e.code, e.message, e.details]));
  });

  it('warns where the data does not fit the schema but render accepts it', () => {
    // isVip is a condition: render accepts any value; vip has a tag inside, so the schema reads it as a loop.
    const result = validate(offer(), { ...good, isVip: 'yes', vip: { discount: 5 } });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => [w.code, w.details?.['pointer'], w.location.description])).toEqual([
      ['TV_W_DATA_SCHEMA', '/isVip', 'body, paragraph 2'],
      ['TV_W_DATA_SCHEMA', '/vip', 'body, paragraph 2'],
    ]);
  });

  it('warns about fields that a condition shown no time would need', () => {
    const result = validate(buildDocx({ body: p('{#show}{a}{/show}') }), { show: [] });
    expect(result.valid).toBe(true);
    expect(validate(buildDocx({ body: p('{#flag > 1}{a}{/flag > 1}') }), { flag: 0 }).warnings.map((w) => w.details?.['pointer'])).toEqual(['/a']);
  });

  it('follows the options of render: missing "empty" makes a missing value no error, only a warning', () => {
    const result = validate(offer(), { items: [], vip: [] }, { missing: 'empty' });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.details?.['pointer'])).toEqual(['/customer']);
  });

  it('accepts image addresses without fetching them', () => {
    const bytes = buildDocx({ body: p('{%logo}') });
    expect(validate(bytes, { logo: 'https://example.com/logo.png' }).valid).toBe(true);
    expect(validate(bytes, { logo: 'not an image' }).errors.map((e) => e.code)).toEqual(['TV_E_INVALID_VALUE']);
  });

  it('works on presentations and workbooks', () => {
    const pptx = buildPptx([{ shapes: sp('T', ap('{title}')) }]);
    expect(summary(validate(pptx, {}).errors)).toEqual([['TV_E_MISSING_FIELD', 'title', 'slide 1, shape "T", paragraph 1']]);
    const xlsx = buildXlsx({ Data: { A1: '{#items}{name}', B1: '{/items}' } });
    expect(summary(validate(xlsx, { items: [{ name: 'a' }, {}] }).errors)).toEqual([['TV_E_MISSING_FIELD', 'items[1].name', 'sheet Data, cell A1']]);
  });

  it('throws for problems of the template and the file, not of the data', () => {
    expectDvError(() => validate(buildDocx({ body: p('{a') }), {}), 'TV_E_TEMPLATE_INVALID');
    expectDvError(() => validate(new Uint8Array([1]), {}), 'TV_E_NOT_ZIP');
    expectDvError(() => validate(offer(), {}, { fetchImage: () => null } as never), 'TV_E_INVALID_OPTION');
  });
});

describe('templateSchema (Standard Schema)', () => {
  it('validates data as a Standard Schema, with issues and their paths', async () => {
    const schema = templateSchema(offer());
    expect(schema['~standard']).toMatchObject({ version: 1, vendor: 'tplvane' });
    expect(schema.jsonSchema.type).toBe('object');
    expect(await schema['~standard'].validate(good)).toEqual({ value: good });
    const failed = await schema['~standard'].validate({ customer: {}, items: [{ qty: 1 }], vip: [] });
    expect('issues' in failed && failed.issues?.map((i) => [i.message.slice(0, 20), i.path])).toEqual([
      ['The data has no "cus', ['customer', 'name']],
      ['The data has no "nam', ['items', 0, 'name']],
    ]);
  });

  it('passes the options on', async () => {
    const schema = templateSchema(offer(), { missing: 'empty' });
    expect(await schema['~standard'].validate({ items: [], vip: [] })).toEqual({ value: { items: [], vip: [] } });
  });
});
