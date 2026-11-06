// CLAUDE.md: the expression engine has no eval and no new Function, no access to prototypes, only
// allow-listed formatters, and limits; every safeguard has a test. Templates and data are untrusted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspect, render } from 'docvane';
import { buildDocx, p } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { bodyText } from '../helpers/read-docx';

const doc = (...paragraphs: string[]): Uint8Array => buildDocx({ body: paragraphs.map((x) => p(x)).join('') });
const SRC = fileURLToPath(new URL('../../packages/docvane/src', import.meta.url));

describe('template injection', () => {
  it.each([
    ['{constructor.constructor("return process")()}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{a.constructor}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{__proto__.polluted}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{x.prototype}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{#__proto__}{/__proto__}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{a["constructor"]}', 'DV_E_TAG_SYNTAX'],
    ['{a[0]}', 'DV_E_TAG_SYNTAX'],
    ['{toString()}', 'DV_E_TAG_SYNTAX'],
    ['{a.b()}', 'DV_E_TAG_SYNTAX'],
    ['{(a)(b)}', 'DV_E_TAG_SYNTAX'],
    ['{a = 1}', 'DV_E_TAG_SYNTAX'],
    ['{a + "x"}', 'DV_E_TAG_SYNTAX'],
    ['{`a`}', 'DV_E_TAG_SYNTAX'],
    ['{`${a}`}', 'DV_E_TAG_UNCLOSED'],
    ['{x | toString}', 'DV_E_FORMATTER_UNKNOWN'],
    ['{x | valueOf}', 'DV_E_FORMATTER_UNKNOWN'],
    ['{x | hasOwnProperty("a")}', 'DV_E_FORMATTER_UNKNOWN'],
    ['{x | constructor}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{x | __proto__}', 'DV_E_TAG_FORBIDDEN_NAME'],
    ['{x | eval("1")}', 'DV_E_FORMATTER_UNKNOWN'],
  ])('%s is refused before any data is read', (tag, code) => {
    const error = expectDvError(() => render(doc(tag), {}), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors[0]?.code).toBe(code);
    expect(expectDvError(() => inspect(doc(tag)), 'DV_E_TEMPLATE_INVALID').errors[0]?.code).toBe(code);
  });

  it('reads only own data properties: inherited ones are missing', () => {
    class Customer {
      get secret(): string {
        return 'from a getter';
      }
    }
    const proto = { inherited: 'from the prototype' };
    const data = Object.assign(Object.create(proto) as object, { name: 'Anna' });
    expect(bodyText(render(doc('{name}'), data))).toEqual(['Anna']);
    expectDvError(() => render(doc('{inherited}'), data), 'DV_E_DATA_INVALID');
    expectDvError(() => render(doc('{toString}'), {}), 'DV_E_DATA_INVALID');
    expectDvError(() => render(doc('{c.secret}'), { c: new Customer() }), 'DV_E_DATA_INVALID');
  });

  it('never calls getters of the data', () => {
    let called = 0;
    const data = {
      get name(): string {
        called++;
        return 'x';
      },
    };
    expectDvError(() => render(doc('{name}'), data), 'DV_E_DATA_INVALID');
    expect(called).toBe(0);
  });

  it('does not let data with a __proto__ key reach anything', () => {
    const data = JSON.parse('{"__proto__": {"polluted": "yes"}, "a": "ok"}') as object;
    expect(bodyText(render(doc('{a}'), data))).toEqual(['ok']);
    expectDvError(() => render(doc('{polluted}'), data), 'DV_E_DATA_INVALID');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('does not write functions or symbols from the data', () => {
    const error = expectDvError(() => render(doc('{f}'), { f: () => 'source code' }), 'DV_E_DATA_INVALID');
    expect(error.errors[0]?.code).toBe('DV_E_INVALID_VALUE');
  });

  it('escapes values that look like XML or tags', () => {
    const value = '<w:r><w:t>x</w:t></w:r> {other} &amp; ]]>';
    expect(bodyText(render(doc('{v}'), { v: value, other: 'NO' }))).toEqual([value]);
  });

  it('limits the depth of expressions', () => {
    const deep = `{${'('.repeat(40)}a${')'.repeat(40)}}`;
    const error = expectDvError(() => render(doc(deep), { a: 1 }), 'DV_E_TEMPLATE_INVALID');
    expect(error.errors[0]).toMatchObject({ code: 'DV_E_LIMIT_EXCEEDED', details: { limit: 'maxExpressionDepth' } });
    expect(bodyText(render(doc(deep), { a: 1 }, { limits: { maxExpressionDepth: 40 } }))).toEqual(['1']);
  });

  it('the sources have no eval, no new Function and no dynamic import', () => {
    const files = ['template/tag.ts', 'expr/ast.ts', 'expr/evaluate.ts', 'expr/formatters.ts', 'docx/render.ts', 'docx/normalize.ts', 'render.ts'];
    for (const file of files) {
      // Comments may name what is forbidden; the code may not use it.
      const source = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|import\s*\(/);
    }
  });
});
