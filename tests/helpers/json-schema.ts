// A validator for the JSON Schema subset of the CLI's --json documentation (docs/cli-json.md in
// the package): type, properties, required, additionalProperties, items, enum, const, oneOf,
// anyOf, minimum, pattern and $ref to $defs (also in a sibling file). For tests only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Schema = Record<string, unknown>;

export class SchemaSet {
  private readonly files = new Map<string, Schema>();

  constructor(private readonly dir: string) {}

  private file(name: string): Schema {
    let s = this.files.get(name);
    if (s === undefined) {
      s = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Schema;
      this.files.set(name, s);
    }
    return s;
  }

  /** The problems of `value` against the schema file `name`; empty when it fits. */
  check(name: string, value: unknown): string[] {
    const out: string[] = [];
    this.walk(value, this.file(name), name, '$', out);
    return out;
  }

  /** The problems of `value` against a schema given by reference, such as `common.schema.json#/$defs/errorEnvelope`. */
  checkRef(ref: string, value: unknown): string[] {
    const out: string[] = [];
    const r = this.resolve(ref, ref.split('#')[0] as string);
    this.walk(value, r.schema, r.file, '$', out);
    return out;
  }

  private resolve(ref: string, file: string): { schema: Schema; file: string } {
    const [path, pointer] = ref.split('#') as [string, string | undefined];
    const target = path === '' ? file : path;
    let node: unknown = this.file(target);
    for (const part of (pointer ?? '').split('/').filter((p) => p !== '')) node = (node as Schema)[part];
    if (node === undefined) throw new Error(`unresolved $ref ${ref} in ${file}`);
    return { schema: node as Schema, file: target };
  }

  private walk(v: unknown, s: Schema, file: string, at: string, out: string[]): void {
    if (typeof s['$ref'] === 'string') {
      const r = this.resolve(s['$ref'], file);
      this.walk(v, r.schema, r.file, at, out);
      return;
    }
    const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    if (s['type'] !== undefined) {
      const types = Array.isArray(s['type']) ? (s['type'] as string[]) : [s['type'] as string];
      if (!types.includes(kind) && !(kind === 'number' && types.includes('integer') && Number.isInteger(v))) {
        out.push(`${at}: expected ${types.join('|')}, found ${kind}`);
        return;
      }
    }
    if ('const' in s && JSON.stringify(s['const']) !== JSON.stringify(v)) out.push(`${at}: expected ${JSON.stringify(s['const'])}`);
    if (Array.isArray(s['enum']) && !(s['enum'] as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(v))) out.push(`${at}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s['enum'])}`);
    if (typeof s['minimum'] === 'number' && typeof v === 'number' && v < s['minimum']) out.push(`${at}: below ${String(s['minimum'])}`);
    if (typeof s['pattern'] === 'string' && typeof v === 'string' && !new RegExp(s['pattern']).test(v)) out.push(`${at}: does not match ${s['pattern']}`);
    for (const key of ['oneOf', 'anyOf'] as const) {
      const options = s[key] as Schema[] | undefined;
      if (options === undefined) continue;
      const fits = options.filter((o) => {
        const trial: string[] = [];
        this.walk(v, o, file, at, trial);
        return trial.length === 0;
      }).length;
      if (key === 'oneOf' ? fits !== 1 : fits === 0) out.push(`${at}: fits ${String(fits)} of the ${key} options`);
    }
    if (kind === 'object') {
      const obj = v as Record<string, unknown>;
      const props = (s['properties'] ?? {}) as Record<string, Schema>;
      for (const r of (s['required'] ?? []) as string[]) if (!(r in obj)) out.push(`${at}: missing ${r}`);
      for (const [k, val] of Object.entries(obj)) {
        if (props[k] !== undefined) this.walk(val, props[k] as Schema, file, `${at}.${k}`, out);
        else if (s['additionalProperties'] === false) out.push(`${at}: unexpected field ${k}`);
        else if (typeof s['additionalProperties'] === 'object') this.walk(val, s['additionalProperties'] as Schema, file, `${at}.${k}`, out);
      }
    }
    if (kind === 'array' && s['items'] !== undefined) (v as unknown[]).forEach((item, i) => this.walk(item, s['items'] as Schema, file, `${at}[${String(i)}]`, out));
  }
}
