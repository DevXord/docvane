// `validate` and `templateSchema`: check data against a template without writing a file (D-047).
// The errors are those of a dry run of render, so validate and render never disagree; the data
// is also checked against the JSON Schema of inspect, and what the schema finds that render does
// not confirm becomes a DV_W_DATA_SCHEMA warning.
import type { StandardSchemaV1 } from 'xlvane';
import type { DvError, DvWarning } from './errors';
import type { JsonSchema } from './model';
import { dryRender, type RenderOptions } from './render';
import { inferSchema } from './schema';
import { clip } from './util/clip';
import { dataPathOf, pointerOf } from './util/data-path';
import { checkSchema, type SchemaIssue } from './validate/json-schema';

/**
 * Options of {@link validate}: those of `render` that change what is an error.
 *
 * @example
 * ```ts
 * import { validate, type ValidateOptions } from 'docvane';
 *
 * declare const template: Uint8Array;
 * const options: ValidateOptions = { missing: 'empty', locale: 'pl-PL' };
 * console.log(validate(template, {}, options).valid);
 * ```
 */
export type ValidateOptions = Pick<RenderOptions, 'limits' | 'delimiters' | 'locale' | 'timeZone' | 'missing'>;

/**
 * The result of {@link validate}.
 *
 * @example
 * ```ts
 * import { validate, type ValidateResult } from 'docvane';
 *
 * declare const template: Uint8Array;
 * const result: ValidateResult = validate(template, { customer: { name: 'Anna' } });
 * for (const error of result.errors) console.log(error.code, error.details['dataPath'], error.location.description);
 * ```
 */
export interface ValidateResult {
  /** Whether `render` would accept the data: `errors` is empty. */
  readonly valid: boolean;
  /**
   * The problems of the data, as `render` would report them in `DV_E_DATA_INVALID`:
   * `DV_E_MISSING_FIELD` and `DV_E_INVALID_VALUE`, each with its place in the template and, in
   * `details`, the path of the field in the data (`dataPath`, `pointer`).
   */
  readonly errors: readonly DvError[];
  /**
   * `DV_W_DATA_SCHEMA` where the data does not fit the schema but render accepts it (a field in a
   * section not shown, a condition that is not a boolean), and warnings of rendering.
   */
  readonly warnings: readonly DvWarning[];
  /** The JSON Schema of the data, as `inspect` returns it. */
  readonly schema: JsonSchema;
}

function schemaWarning(issue: SchemaIssue, where: DvWarning['location']): DvWarning {
  const path = dataPathOf(issue.path);
  const name = path === '' ? 'The data' : `"${clip(path)}"`;
  const message =
    issue.kind === 'missing'
      ? `${name} is missing; the schema of the template needs it (${issue.expected}), but render does not use it with this data.`
      : `${name} is ${issue.found === 'null' ? 'null' : `a ${issue.found ?? 'value'}`}, but the schema of the template expects ${issue.expected}; render accepts it with this data.`;
  return {
    code: 'DV_W_DATA_SCHEMA',
    message,
    location: where,
    hint:
      issue.kind === 'missing'
        ? 'Nothing fails now. Add the field if the section that uses it can be shown with other data.'
        : 'Nothing fails now. Pass the kind the schema names, so that the data also fits other templates and tools that read the schema.',
    details: { pointer: clip(pointerOf(issue.path)), dataPath: clip(path), kind: issue.kind, expected: issue.expected },
  };
}

/**
 * Checks data against a template without writing a file. `errors` are exactly the problems that
 * {@link render} would report for this data (a dry run, with the same options), each with the place
 * of its tag in the template, the path of the field in the data (`details.dataPath` such as
 * `items[1].name`, `details.pointer` such as `/items/1/name`) and, for a missing field, the fields
 * that are there (`details.available`). The data is also checked against the JSON Schema that
 * {@link inspect} returns; what does not fit it but does not fail render is a `DV_W_DATA_SCHEMA`
 * warning. Images given as addresses are not fetched and count as valid.
 *
 * Throws {@link DvError} only for problems of the input, the options, the file and the template
 * (`DV_E_TEMPLATE_INVALID` and the file errors of `inspect`), and for limits.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { validate } from 'docvane';
 *
 * const result = validate(readFileSync('offer.docx'), { customer: {}, items: [{ name: 'Desk' }] });
 * if (!result.valid) {
 *   for (const error of result.errors) console.log(`${String(error.details['dataPath'])}: ${error.message} ${error.hint}`);
 * }
 * ```
 */
export function validate(template: Uint8Array, data: unknown, options?: ValidateOptions): ValidateResult {
  const dry = dryRender(template, data, options, 'validate');
  const analysis = dry.analysis;
  const { schema, locations } = inferSchema(analysis === null ? [] : analysis.trees);
  const errors = dry.problems;
  const confirmed = new Set(errors.map((e) => e.details['pointer']).filter((p): p is string => typeof p === 'string'));
  const covered = (pointer: string): boolean => {
    for (const p of confirmed) if (p === pointer || p.startsWith(`${pointer}/`) || pointer.startsWith(`${p}/`)) return true;
    return false;
  };
  const limits = { maxIssues: options?.limits?.maxErrors ?? 100 };
  const warnings: DvWarning[] = [];
  for (const issue of checkSchema(data, schema, limits)) {
    if (covered(pointerOf(issue.path))) continue;
    warnings.push(schemaWarning(issue, locations.get(issue.schema) ?? {}));
  }
  warnings.push(...dry.warnings);
  return { valid: errors.length === 0, errors, warnings, schema };
}

/**
 * A template as a Standard Schema (https://standardschema.dev), for libraries that accept one:
 * `'~standard'.validate` checks data as {@link validate} does and gives its errors as issues with
 * the path of the field. `jsonSchema` is the schema that {@link inspect} returns. The template is
 * read again on every validation.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { templateSchema } from 'docvane';
 *
 * const schema = templateSchema(readFileSync('offer.docx'));
 * const result = await schema['~standard'].validate({ customer: { name: 'Anna' } });
 * if (result.issues) for (const issue of result.issues) console.log(issue.path, issue.message);
 * ```
 */
export interface TemplateSchema extends StandardSchemaV1<unknown, unknown> {
  /** The JSON Schema of the data, as `inspect` returns it. */
  readonly jsonSchema: JsonSchema;
}

/**
 * Returns the template as a {@link TemplateSchema}: a Standard Schema of its data with the JSON
 * Schema of {@link inspect}. Problems of the template are thrown here, at once.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { templateSchema } from 'docvane';
 *
 * const schema = templateSchema(readFileSync('offer.docx'), { missing: 'empty' });
 * console.log(schema['~standard'].vendor, Object.keys(schema.jsonSchema.properties ?? {}));
 * ```
 */
export function templateSchema(template: Uint8Array, options?: ValidateOptions): TemplateSchema {
  const { schema } = validate(template, undefined, options);
  return {
    jsonSchema: schema,
    '~standard': {
      version: 1,
      vendor: 'docvane',
      validate(value: unknown): StandardSchemaV1.Result<unknown> {
        const result = validate(template, value, options);
        if (result.valid) return { value };
        return {
          issues: result.errors.map((e) => {
            const pointer = e.details['pointer'];
            return { message: `${e.message} ${e.hint}`, ...(typeof pointer === 'string' && pointer !== '' ? { path: pointer.slice(1).split('/').map(decodeSegment) } : {}) };
          }),
        };
      },
    },
  };
}

/** A segment of a JSON Pointer as a key: digits are list indexes. */
function decodeSegment(segment: string): string | number {
  const text = segment.replace(/~1/g, '/').replace(/~0/g, '~');
  return /^(0|[1-9][0-9]{0,8})$/.test(text) ? Number(text) : text;
}
