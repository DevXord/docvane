// A validator for the subset of JSON Schema (draft 2020-12) that `inspect` produces (D-047):
// `type` (one name or a list), `properties`, `required`, `items` and `anyOf`. Other fields are
// allowed and not checked, as `inspect` never restricts them. tplvane writes it itself because
// the package has no dependency for it (CLAUDE.md).
//
// Values are JavaScript values, as `render` takes them: a field is present when it is an own data
// property (getters and inherited properties are missing, as in `render`); a `Date` and bytes
// count as strings (they stand for an ISO 8601 date and an image), a bigint as a number. The walk
// follows the schema, which is finite, so cyclic data cannot make it loop; `maxNodes` bounds the
// work on long lists and `maxIssues` the result.
import { ownValue } from '../expr/evaluate';
import type { JsonSchema, JsonSchemaType } from '../model';
import type { DataPath } from '../util/data-path';

export { dataPathOf, pointerOf } from '../util/data-path';

/** One way the data does not fit the schema. */
export interface SchemaIssue {
  readonly path: DataPath;
  /** `missing`: a required field is absent; `type`: the value is of another kind. */
  readonly kind: 'missing' | 'type';
  /** The kinds the schema allows, in words: `string, number or boolean`. */
  readonly expected: string;
  /** The kind of the value found, for `type`. */
  readonly found?: string;
  /** The schema the value was checked against. */
  readonly schema: JsonSchema;
}

export interface CheckOptions {
  readonly maxIssues?: number;
  readonly maxNodes?: number;
}

/** The JSON kind of a JavaScript value, or `other` for functions and symbols. */
function kindOf(value: unknown): JsonSchemaType | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date || value instanceof Uint8Array || value instanceof ArrayBuffer) return 'string';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'other';
  }
}

function words(list: readonly string[]): string {
  return list.length <= 1 ? (list[0] ?? 'anything') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1] as string}`;
}

/** The kinds a schema allows; an empty list allows anything. */
function typesOf(schema: JsonSchema): readonly string[] {
  if (schema.type !== undefined) return typeof schema.type === 'string' ? [schema.type] : schema.type;
  if (schema.anyOf !== undefined) return [...new Set(schema.anyOf.flatMap((s) => (s.type === undefined ? [] : typeof s.type === 'string' ? [s.type] : s.type)))];
  return [];
}

/** Checks `value` against `schema` and returns the issues, in the order of the schema. */
export function checkSchema(value: unknown, schema: JsonSchema, options: CheckOptions = {}): SchemaIssue[] {
  const maxIssues = options.maxIssues ?? 100;
  let budget = options.maxNodes ?? 1_000_000;
  const issues: SchemaIssue[] = [];

  const walk = (v: unknown, s: JsonSchema, path: DataPath, out: SchemaIssue[]): void => {
    if (out.length >= maxIssues || --budget < 0) return;
    if (s.anyOf !== undefined) {
      for (const option of s.anyOf) {
        const trial: SchemaIssue[] = [];
        walk(v, option, path, trial);
        if (trial.length === 0) return;
      }
      out.push({ path, kind: 'type', expected: words(typesOf(s)), found: kindOf(v), schema: s });
      return;
    }
    const allowed = typesOf(s);
    const kind = kindOf(v);
    if (allowed.length > 0 && !allowed.includes(kind)) {
      out.push({ path, kind: 'type', expected: words(allowed), found: kind, schema: s });
      return;
    }
    if (kind === 'object' && s.properties !== undefined) {
      const required = new Set(s.required ?? []);
      for (const name of Object.keys(s.properties)) {
        const field = ownValue(v, name);
        const fieldSchema = (s.properties as Record<string, JsonSchema>)[name] as JsonSchema;
        if (field === undefined) {
          if (required.has(name) && out.length < maxIssues) out.push({ path: [...path, name], kind: 'missing', expected: words(typesOf(fieldSchema)), schema: fieldSchema });
          continue;
        }
        walk(field, fieldSchema, [...path, name], out);
      }
    }
    if (kind === 'array' && s.items !== undefined) {
      const list = v as readonly unknown[];
      // Items are read as own data properties, as render reads them: a getter is not called (D-071).
      for (let i = 0; i < list.length && out.length < maxIssues && budget > 0; i++) walk(ownValue(list, String(i)), s.items, [...path, i], out);
    }
  };
  walk(value, schema, [], issues);
  return issues;
}
