// The JSON Schema that inspect infers (docs/syntax.md, "The data schema").
import { describe, expect, it } from 'vitest';
import { inspect, type JsonSchema } from 'docvane';
import { buildDocx, p, table } from '../helpers/docx';

const schemaOf = (...paragraphs: string[]): JsonSchema => inspect(buildDocx({ body: paragraphs.join('') })).schema;
const VALUE = ['string', 'number', 'boolean'];

/** The schema without descriptions, to compare shapes. */
function shape(schema: JsonSchema): unknown {
  const { description: _d, $schema: _s, ...rest } = schema;
  const out: Record<string, unknown> = { ...rest };
  if (schema.properties) out['properties'] = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, shape(v)]));
  if (schema.items) out['items'] = shape(schema.items);
  if (schema.anyOf) out['anyOf'] = schema.anyOf.map(shape);
  return out;
}

describe('inferred schema', () => {
  it('is a JSON Schema 2020-12 object with required values and nested objects', () => {
    const schema = schemaOf(p('{customer.name} {customer.address.city} {total}'));
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(shape(schema)).toEqual({
      type: 'object',
      properties: {
        customer: {
          type: 'object',
          properties: {
            name: { type: VALUE },
            address: { type: 'object', properties: { city: { type: VALUE } }, required: ['city'] },
          },
          required: ['name', 'address'],
        },
        total: { type: VALUE },
      },
      required: ['customer', 'total'],
    });
  });

  it('describes nested loops and conditions', () => {
    const schema = schemaOf(
      p('{#orders}Order {number} for {customer.name}'),
      table([[p('{#lines}{product} {qty} {#discounted}-{/discounted}{^inStock}(backorder){/inStock}'), p('{#tags}{.}{/tags}{/lines}')]]),
      p('{#isVip}VIP{/isVip}{/orders}'),
      p('{^orders}No orders.{/orders}'),
    );
    expect(shape(schema)).toEqual({
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              number: { type: VALUE },
              customer: { type: 'object', properties: { name: { type: VALUE } }, required: ['name'] },
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    product: { type: VALUE },
                    qty: { type: VALUE },
                    discounted: { type: 'boolean' },
                    inStock: { type: 'boolean' },
                    tags: { type: 'array', items: { type: VALUE } },
                  },
                  required: ['product', 'qty', 'tags'],
                },
              },
              isVip: { type: 'boolean' },
            },
            required: ['number', 'customer', 'lines'],
          },
        },
      },
      required: ['orders'],
    });
  });

  it('describes each property with its role and first place', () => {
    const schema = schemaOf(p('{#items}{name}{/items}'), p('{name}'), p('{#items}{name}{/items}'));
    expect(schema.properties?.['items']?.description).toBe('Loop in body, paragraph 1 and 1 more place.');
    expect(schema.properties?.['items']?.items?.properties?.['name']?.description).toBe('Value in body, paragraph 1 and 1 more place.');
    expect(schema.properties?.['name']?.description).toBe('Value in body, paragraph 2.');
  });

  it('lets a value, a loop, an image or Markdown win over a condition on the same name', () => {
    const schema = schemaOf(p('{#name}Dear {/name}{name}'), p('{#logo}{/logo}{%logo}'), p('{^summary}{/summary}{~summary}'), p('{#items}{/items}{#items}{x}{/items}'));
    expect(shape(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: VALUE },
        logo: {},
        summary: { type: 'string' },
        items: { type: 'array', items: { type: 'object', properties: { x: { type: VALUE } }, required: ['x'] } },
      },
      required: ['name', 'logo', 'summary', 'items'],
    });
    expect(schema.properties?.['logo']?.description).toBe('Image in body, paragraph 2 and 1 more place.');
    expect(schema.properties?.['summary']?.description).toBe('Markdown text in body, paragraph 3 and 1 more place.');
  });

  it('keeps a condition used only as a condition optional', () => {
    const schema = schemaOf(p('{#a}x{/a}{^b}y{/b}'));
    expect(shape(schema)).toEqual({ type: 'object', properties: { a: { type: 'boolean' }, b: { type: 'boolean' } } });
  });

  it('merges two loops over the same list', () => {
    const schema = schemaOf(p('{#items}{a}{/items}'), p('{#items}{b}{/items}'));
    expect(shape(schema.properties?.['items'] ?? {})).toEqual({ type: 'array', items: { type: 'object', properties: { a: { type: VALUE }, b: { type: VALUE } }, required: ['a', 'b'] } });
  });

  it('gives anyOf and a warning for uses that do not fit together', () => {
    const result = inspect(buildDocx({ body: p('{items}') + p('{#items}{name}{/items}') + p('{#list}{.}{x}{/list}') }));
    expect(shape(result.schema.properties?.['items'] ?? {})).toEqual({
      anyOf: [{ type: VALUE }, { type: 'array', items: { type: 'object', properties: { name: { type: VALUE } }, required: ['name'] } }],
    });
    expect(shape(result.schema.properties?.['list'] ?? {})).toEqual({
      type: 'array',
      items: { anyOf: [{ type: VALUE }, { type: 'object', properties: { x: { type: VALUE } }, required: ['x'] }] },
    });
    expect(result.warnings.map((w) => [w.code, w.location.description])).toEqual([
      ['DV_W_SCHEMA_CONFLICT', 'body, paragraph 2'],
      ['DV_W_SCHEMA_CONFLICT', 'body, paragraph 3'],
    ]);
    expect(result.warnings[0]?.message).toBe('"items" is used in ways that do not fit together: as a value and as a loop.');
  });

  it('keeps names that are also names of Object.prototype members as plain own properties', () => {
    const schema = schemaOf(p('{toString} {hasOwnProperty.valueOf}'));
    expect(Object.keys(schema.properties ?? {})).toEqual(['toString', 'hasOwnProperty']);
    expect(Object.hasOwn(schema.properties ?? {}, 'toString')).toBe(true);
    expect(JSON.parse(JSON.stringify(schema)).properties.hasOwnProperty.properties.valueOf.type).toEqual(VALUE);
  });

  it('collects the data of all stories into one schema', () => {
    const schema = inspect(buildDocx({ body: p('{a}'), headers: [p('{company.name}')], footnotes: [p('{a}')] })).schema;
    expect(schema.required).toEqual(['a', 'company']);
    expect(schema.properties?.['a']?.description).toBe('Value in body, paragraph 1 and 1 more place.');
  });

  it('reads expressions: compared values are required, tested ones optional, defaults optional', () => {
    const schema = schemaOf(p('{#total > 100 && !isVip}Big order{/total > 100 && !isVip}'), p('{nickname | default("-")} {(status | upper) == "PAID"}'), p('{#a || b}{x}{/a || b}'));
    expect(shape(schema)).toEqual({
      type: 'object',
      properties: {
        total: { type: VALUE },
        isVip: { type: 'boolean' },
        nickname: { type: VALUE },
        status: { type: VALUE },
        a: { type: 'boolean' },
        b: { type: 'boolean' },
        x: { type: VALUE },
      },
      required: ['total', 'status', 'x'],
    });
  });

  it('keeps the tags inside inverted sections and conditions over expressions in the same scope', () => {
    const schema = schemaOf(p('{^isVip}Join for {price}{/isVip}'));
    expect(shape(schema)).toEqual({ type: 'object', properties: { isVip: { type: 'boolean' }, price: { type: VALUE } }, required: ['price'] });
  });
});
