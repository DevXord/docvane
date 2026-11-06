// The grammar of the inside of a tag (docs/syntax.md).
import { describe, expect, it } from 'vitest';
import { parseTag, type ParsedTag, type TagProblem } from '../../packages/docvane/src/template/tag';

const ok = (inner: string): ParsedTag => {
  const result = parseTag(inner);
  if ('code' in result) throw new Error(`${inner}: ${result.code} ${result.message}`);
  return result;
};
const bad = (inner: string): TagProblem => {
  const result = parseTag(inner);
  if (!('code' in result)) throw new Error(`${inner} was accepted`);
  expect(result.message.length).toBeGreaterThan(0);
  expect(result.hint.length).toBeGreaterThan(0);
  return result;
};

describe('parseTag', () => {
  it('reads the six kinds of tags', () => {
    expect(ok('customer.name')).toMatchObject({ kind: 'value', path: 'customer.name', segments: ['customer', 'name'], formatters: [] });
    expect(ok('#items')).toMatchObject({ kind: 'section', path: 'items' });
    expect(ok('^items')).toMatchObject({ kind: 'inverted', path: 'items' });
    expect(ok('/items')).toMatchObject({ kind: 'close', path: 'items' });
    expect(ok('%logo')).toMatchObject({ kind: 'image', path: 'logo' });
    expect(ok('~summary')).toMatchObject({ kind: 'markdown', path: 'summary' });
  });

  it('allows spaces and no-break spaces around every part', () => {
    expect(ok('  customer . name  ')).toMatchObject({ path: 'customer.name' });
    expect(ok('# items')).toMatchObject({ kind: 'section', path: 'items' });
    expect(ok(' total | currency ( "PLN" ) ')).toMatchObject({ path: 'total', formatters: [{ name: 'currency', args: ['PLN'] }] });
  });

  it('reads `.` as the current item', () => {
    expect(ok('.')).toMatchObject({ kind: 'value', path: '.', segments: [] });
    expect(ok('. | upper')).toMatchObject({ path: '.', formatters: [{ name: 'upper', args: [] }] });
  });

  it('accepts Unicode letters, digits and underscores in names', () => {
    expect(ok('klient.imię')).toMatchObject({ segments: ['klient', 'imię'] });
    expect(ok('_private2.Zażółć')).toMatchObject({ segments: ['_private2', 'Zażółć'] });
    expect(ok('顧客.名前')).toMatchObject({ segments: ['顧客', '名前'] });
  });

  it('reads formatters with literal arguments', () => {
    expect(ok('total | currency("PLN")').formatters).toEqual([{ name: 'currency', args: ['PLN'] }]);
    expect(ok('d | date("yyyy-MM-dd") | default("-")').formatters).toEqual([
      { name: 'date', args: ['yyyy-MM-dd'] },
      { name: 'default', args: ['-'] },
    ]);
    expect(ok("x | f(1, -2.5, 3e2, true, false, null, 'a')").formatters).toEqual([{ name: 'f', args: [1, -2.5, 300, true, false, null, 'a'] }]);
    expect(ok('x | f()').formatters).toEqual([{ name: 'f', args: [] }]);
    expect(ok('#items | sort').formatters).toEqual([{ name: 'sort', args: [] }]);
  });

  it('accepts the typographic quotes that word processors put in place of straight ones', () => {
    for (const quoted of ['„PLN”', '“PLN”', '”PLN”', '„PLN“', '‘PLN’', '’PLN’', '‚PLN’', '‚PLN‘']) {
      expect(ok(`total | currency(${quoted})`).formatters, quoted).toEqual([{ name: 'currency', args: ['PLN'] }]);
    }
  });

  it('keeps quotes of the other family and backslash escapes inside strings', () => {
    expect(ok(`x | f("it's")`).formatters[0]?.args).toEqual(["it's"]);
    expect(ok(`x | f('say "hi"')`).formatters[0]?.args).toEqual(['say "hi"']);
    expect(ok(String.raw`x | f("a\"b\\c")`).formatters[0]?.args).toEqual(['a"b\\c']);
  });

  it('rejects empty tags', () => {
    for (const inner of ['', '   ', '#', '^ ', '/', '%', '~']) expect(bad(inner).code, JSON.stringify(inner)).toBe('DV_E_TAG_EMPTY');
  });

  it('rejects names that reach object prototypes, wherever they are', () => {
    for (const inner of ['__proto__', 'a.__proto__', 'constructor', 'x.prototype', '#constructor', '/__proto__', '%prototype', 'x | constructor', 'x | __proto__("a")']) {
      expect(bad(inner).code, inner).toBe('DV_E_TAG_FORBIDDEN_NAME');
    }
    // Only exact segments are forbidden.
    expect(ok('constructors.prototypeName').path).toBe('constructors.prototypeName');
  });

  it('rejects operators with a hint that they are not supported yet', () => {
    for (const inner of ['a > 1', 'a == b', 'a && b', '!a', 'a + 1', '#a > 1', 'a ? b : c']) {
      const problem = bad(inner);
      expect(problem.code, inner).toBe('DV_E_TAG_SYNTAX');
      expect(problem.hint, inner).toMatch(/operator/i);
    }
  });

  it('rejects malformed paths, formatters and arguments, with the position', () => {
    const cases: [string, number][] = [
      ['a.', 2],
      ['.a', 1],
      ['a..b', 2],
      ['a b', 2],
      ['1a', 0],
      ['first-name', 5],
      ['a |', 3],
      ['a | f(', 6],
      ['a | f("x"', 9],
      ['a | f("x" "y")', 10],
      ['a | f(x)', 6],
      ['a | f(1,)', 8],
      ['a | f("unterminated)', 6],
      ['a\tb', 1],
      ['a\nb', 1],
    ];
    for (const [inner, position] of cases) {
      const problem = bad(inner);
      expect(problem.code, inner).toBe('DV_E_TAG_SYNTAX');
      expect(problem.position, inner).toBe(position);
    }
  });

  it('allows only a plain path in image, Markdown and closing tags', () => {
    for (const inner of ['%logo | f', '~summary | f', '/items | sort', '/.']) {
      const problem = bad(inner);
      expect(problem.code, inner).toBe('DV_E_TAG_SYNTAX');
    }
    expect(ok('~.')).toMatchObject({ kind: 'markdown', path: '.' });
    expect(ok('%.')).toMatchObject({ kind: 'image', path: '.' });
  });

  it('rejects a second sigil', () => {
    expect(bad('##items').code).toBe('DV_E_TAG_SYNTAX');
    expect(bad('#/items').code).toBe('DV_E_TAG_SYNTAX');
  });
});
