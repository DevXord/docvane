// The validator of the JSON Schema subset that inspect produces (D-047): types, required fields,
// items, anyOf, JavaScript values that JSON has no type for, and its budgets.
import { describe, expect, it } from 'vitest';
import type { JsonSchema } from 'docvane';
import { checkSchema, dataPathOf, pointerOf } from '../../packages/docvane/src/validate/json-schema';

const VALUE: JsonSchema = { type: ['string', 'number', 'boolean'] };
const schema: JsonSchema = {
  type: 'object',
  properties: {
    customer: { type: 'object', properties: { name: VALUE }, required: ['name'] },
    items: { type: 'array', items: { type: 'object', properties: { name: VALUE, qty: VALUE }, required: ['name'] } },
    tags: { type: 'array', items: VALUE },
    isVip: { type: 'boolean' },
    logo: { anyOf: [{ type: 'string' }, { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] }] },
  },
  required: ['customer', 'items'],
};
const issues = (value: unknown): [string, string, string][] => checkSchema(value, schema).map((i) => [pointerOf(i.path), i.kind, i.expected]);

describe('checkSchema', () => {
  it('accepts data that fits, with fields the schema does not name', () => {
    expect(issues({ customer: { name: 'Anna', extra: 1 }, items: [{ name: 'Desk', qty: 2 }], tags: ['a', 1, true], isVip: false, logo: 'data:...', more: {} })).toEqual([]);
  });

  it('reports missing required fields and wrong types, with JSON Pointer paths', () => {
    expect(issues({ customer: {}, items: [{ name: 'A' }, { qty: 1 }, 'x'], tags: [{}], isVip: 'yes' })).toEqual([
      ['/customer/name', 'missing', 'string, number or boolean'],
      ['/items/1/name', 'missing', 'string, number or boolean'],
      ['/items/2', 'type', 'object'],
      ['/tags/0', 'type', 'string, number or boolean'],
      ['/isVip', 'type', 'boolean'],
    ]);
    expect(issues(null)).toEqual([['', 'type', 'object']]);
    expect(issues({ customer: { name: 'A' } })).toEqual([['/items', 'missing', 'array']]);
  });

  it('counts only own data properties as present, as render does', () => {
    const proto = { name: 'inherited' };
    const getter = Object.defineProperty({}, 'name', { get: () => 'x', enumerable: true });
    expect(issues({ customer: Object.create(proto) as object, items: [getter] })).toEqual([
      ['/customer/name', 'missing', 'string, number or boolean'],
      ['/items/0/name', 'missing', 'string, number or boolean'],
    ]);
  });

  it('takes a Date and bytes as strings and a bigint as a number', () => {
    expect(issues({ customer: { name: new Date() }, items: [{ name: 12n }], logo: { data: new Uint8Array(2) } })).toEqual([]);
  });

  it('reports anyOf as one issue when no option fits', () => {
    expect(issues({ customer: { name: 'A' }, items: [], logo: { width: 3 } })).toEqual([['/logo', 'type', 'string or object']]);
  });

  it('stops at maxIssues and within the node budget', () => {
    const many = { customer: { name: 'A' }, items: Array.from({ length: 1000 }, () => ({})) };
    expect(checkSchema(many, schema, { maxIssues: 5 })).toHaveLength(5);
    expect(checkSchema({ customer: { name: 'A' }, items: Array.from({ length: 1000 }, () => 1) }, schema, { maxNodes: 10 }).length).toBeLessThanOrEqual(10);
  });

  it('does not loop on cyclic data: it follows the schema, which is finite', () => {
    const customer: Record<string, unknown> = { name: 'A' };
    customer['self'] = customer;
    expect(issues({ customer, items: [] })).toEqual([]);
  });

  it('writes paths as JSON Pointers and as data paths', () => {
    expect(pointerOf(['items', 1, 'a/b~c'])).toBe('/items/1/a~1b~0c');
    expect(dataPathOf(['items', 1, 'name'])).toBe('items[1].name');
    expect(dataPathOf([])).toBe('');
  });
});
