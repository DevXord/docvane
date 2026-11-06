// The grammar of the inside of a tag, the text between `{` and `}` (docs/syntax.md):
//
//   tag       = ws [ sigil ws ] body ws
//   sigil     = "#" | "^" | "/" | "%" | "~"
//   body      = pipe            (value, "#" and "^")
//             | path            ("%" and "~")
//             | logical         ("/": no formatters, not ".")
//   pipe      = logical { ws "|" ws formatter }
//   logical   = and { ws "||" ws and }
//   and       = compare { ws "&&" ws compare }
//   compare   = unary [ ws op ws unary ]          op = "==" | "!=" | "<" | "<=" | ">" | ">="
//   unary     = "!" ws unary | operand
//   operand   = literal | path | "(" ws pipe ws ")"
//   formatter = name [ ws "(" ws [ literal { ws "," ws literal } ws ] ")" ]
//   path      = "." | name { ws "." ws name }
//   literal   = string | number | "true" | "false" | "null"
//   ws        = { " " | U+00A0 }
//
// A hand-written recursive-descent parser over code points. Recursion happens only through
// parentheses and "!", whose nesting is bounded by `maxExpressionDepth` (and never deeper than
// HARD_DEPTH, whatever the limit says, so that the stack cannot overflow). No regular expression
// runs over the tag text except a single-code-point Unicode property test, so the work is linear in
// the length of the tag, which the lexer bounds with `maxTagLength`. There are no function calls,
// no indexing and no arithmetic in the grammar, and names that reach prototypes are refused.
import { canonical, pathsOf, type CompareOp, type Expr } from '../expr/ast';
import type { FormatterArg, FormatterCall, TagKind } from '../model';

/** A tag that follows the grammar. */
export interface ParsedTag {
  readonly kind: TagKind;
  /** The expression before the formatters of the tag. */
  readonly expr: Expr;
  /** The canonical text of `expr`: the path for a plain path, such as `customer.name`, or `.`. */
  readonly path: string;
  /** The names of the path when `expr` is a plain path (empty for "."), otherwise null. */
  readonly segments: readonly string[] | null;
  /** The formatters after the expression, in order. */
  readonly formatters: readonly FormatterCall[];
  /** Every data path the tag reads, formatters' inputs included, in order of first use. */
  readonly paths: readonly string[];
}

/** Why a tag does not follow the grammar. `position` is a UTF-16 index into the inside of the tag. */
export interface TagProblem {
  readonly code: 'DV_E_TAG_EMPTY' | 'DV_E_TAG_SYNTAX' | 'DV_E_TAG_FORBIDDEN_NAME' | 'DV_E_LIMIT_EXCEEDED';
  readonly message: string;
  readonly hint: string;
  readonly position: number;
}

/** Names that would reach object prototypes in JavaScript; never valid as a path segment or formatter. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const SIGILS: ReadonlyMap<string, TagKind> = new Map([
  ['#', 'section'],
  ['^', 'inverted'],
  ['/', 'close'],
  ['%', 'image'],
  ['~', 'markdown'],
]);

/** Characters of operators that the grammar does not have (arithmetic, conditional, indexing, calls). */
const UNSUPPORTED_CHARS = '+-*/%?:[]&=';

/** Nesting of parentheses and "!" that is never exceeded, whatever `maxExpressionDepth` says. */
export const HARD_DEPTH = 256;

/** Quote characters by family: a string opened by one closes at the next of the same family. */
const DOUBLE_QUOTES = '"„“”';
const SINGLE_QUOTES = '\'‘’‚';

const ID_START = /^[\p{ID_Start}_]$/u;
const ID_CONTINUE = /^[\p{ID_Continue}\u200C\u200D]$/u;

class Problem extends Error {
  constructor(
    readonly problem: TagProblem,
  ) {
    super(problem.message);
  }
}

const SYNTAX_HINT = 'Write a value as {name} or {customer.name}, a formatter as {total | currency("PLN")}; see the syntax reference.';
const OPERATOR_HINT =
  'Tags support the operators == != < <= > >= && || ! and parentheses; arithmetic, function calls, [ ] and ?: are not supported. Names may contain letters, digits and _, but not -.';

class Scanner {
  pos = 0;

  constructor(readonly s: string) {}

  get done(): boolean {
    return this.pos >= this.s.length;
  }

  /** The code point at the position, as a string, or '' at the end. */
  peek(): string {
    const cp = this.s.codePointAt(this.pos);
    return cp === undefined ? '' : String.fromCodePoint(cp);
  }

  next(): string {
    const c = this.peek();
    this.pos += c.length;
    return c;
  }

  skipWs(): void {
    while (this.s[this.pos] === ' ' || this.s[this.pos] === '\u00a0') this.pos++;
  }

  fail(message: string, hint = SYNTAX_HINT, at = this.pos): never {
    throw new Problem({ code: 'DV_E_TAG_SYNTAX', message, hint, position: at });
  }

  /** Fails at an unexpected character, with the operator hint when it looks like an operator. */
  unexpected(expected: string): never {
    const c = this.peek();
    if (c === '') this.fail(`The tag ends where ${expected} was expected.`);
    if (c === '\t' || c === '\n' || c === '\r') {
      this.fail('The tag contains a tab or a line break.', 'Keep the whole tag on one line, without tabs; type it again if the document split it.');
    }
    const isOperator = UNSUPPORTED_CHARS.includes(c) || c === '(' || c === '<' || c === '>' || c === '!' || c === '|';
    this.fail(`Unexpected "${c}" where ${expected} was expected.`, isOperator ? OPERATOR_HINT : SYNTAX_HINT);
  }
}

function isIdStart(c: string): boolean {
  return c !== '' && ID_START.test(c);
}

function isIdContinue(c: string): boolean {
  return c !== '' && ID_CONTINUE.test(c);
}

function readName(sc: Scanner, what: string): string {
  const start = sc.pos;
  if (!isIdStart(sc.peek())) sc.unexpected(what);
  sc.next();
  while (isIdContinue(sc.peek())) sc.next();
  const name = sc.s.slice(start, sc.pos);
  if (FORBIDDEN_NAMES.has(name)) {
    throw new Problem({
      code: 'DV_E_TAG_FORBIDDEN_NAME',
      message: `"${name}" cannot be used as a name in a tag.`,
      hint: 'The names __proto__, constructor and prototype are reserved because they reach the internals of JavaScript objects. Rename the field in the template and in the data.',
      position: start,
    });
  }
  return name;
}

function readPath(sc: Scanner, allowCurrent: boolean): string[] {
  if (sc.peek() === '.') {
    if (!allowCurrent) sc.fail('"." (the current item) cannot be used here.', 'Close a section with its name, for example {/items}.');
    sc.next();
    return [];
  }
  const segments = [readName(sc, 'a name')];
  for (;;) {
    const save = sc.pos;
    sc.skipWs();
    if (sc.peek() !== '.') {
      sc.pos = save;
      return segments;
    }
    sc.next();
    sc.skipWs();
    segments.push(readName(sc, 'a name after "."'));
  }
}

function readString(sc: Scanner): string {
  const start = sc.pos;
  const open = sc.next();
  const family = DOUBLE_QUOTES.includes(open) ? DOUBLE_QUOTES : SINGLE_QUOTES;
  let out = '';
  for (;;) {
    if (sc.done) sc.fail('A string in the tag is not closed.', 'End the string with the same kind of quote that starts it, for example "PLN".', start);
    const c = sc.next();
    if (family.includes(c)) return out;
    if (c === '\\') {
      if (sc.done) sc.fail('A string in the tag is not closed.', 'End the string with the same kind of quote that starts it, for example "PLN".', start);
      out += sc.next();
      continue;
    }
    out += c;
  }
}

function readNumber(sc: Scanner): number {
  const start = sc.pos;
  const digits = (): number => {
    const from = sc.pos;
    while (sc.peek() >= '0' && sc.peek() <= '9') sc.next();
    return sc.pos - from;
  };
  if (sc.peek() === '-') sc.next();
  if (sc.peek() === '0') sc.next();
  else if (digits() === 0) sc.unexpected('a number');
  if (sc.peek() === '.') {
    sc.next();
    if (digits() === 0) sc.unexpected('a digit');
  }
  if (sc.peek() === 'e' || sc.peek() === 'E') {
    sc.next();
    if (sc.peek() === '+' || sc.peek() === '-') sc.next();
    if (digits() === 0) sc.unexpected('a digit');
  }
  const value = Number(sc.s.slice(start, sc.pos));
  if (!Number.isFinite(value)) sc.fail('A number in the tag is too large.', 'Use a number between -1e308 and 1e308.', start);
  return value;
}

function readLiteral(sc: Scanner): FormatterArg {
  const c = sc.peek();
  if (DOUBLE_QUOTES.includes(c) || SINGLE_QUOTES.includes(c)) return readString(sc);
  if (c === '-' || (c >= '0' && c <= '9')) return readNumber(sc);
  if (isIdStart(c)) {
    const start = sc.pos;
    while (isIdContinue(sc.peek())) sc.next();
    const word = sc.s.slice(start, sc.pos);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    sc.fail(`"${word}" is not a value an argument can have.`, 'Arguments of formatters are strings in quotes, numbers, true, false or null, for example currency("PLN").', start);
  }
  return sc.unexpected('a string, a number, true, false or null');
}

function readFormatter(sc: Scanner): FormatterCall {
  const name = readName(sc, 'the name of a formatter after "|"');
  const save = sc.pos;
  sc.skipWs();
  if (sc.peek() !== '(') {
    sc.pos = save;
    return { name, args: [] };
  }
  sc.next();
  sc.skipWs();
  const args: FormatterArg[] = [];
  if (sc.peek() === ')') {
    sc.next();
    return { name, args };
  }
  for (;;) {
    args.push(readLiteral(sc));
    sc.skipWs();
    const c = sc.peek();
    if (c === ')') {
      sc.next();
      return { name, args };
    }
    if (c !== ',') sc.unexpected('"," or ")"');
    sc.next();
    sc.skipWs();
  }
}

const COMPARE_OPS: readonly CompareOp[] = ['==', '!=', '<=', '>=', '<', '>'];

class ExprParser {
  private depth = 0;

  constructor(
    private readonly sc: Scanner,
    private readonly maxDepth: number,
  ) {}

  private enter(): void {
    this.depth++;
    if (this.depth > this.maxDepth || this.depth > HARD_DEPTH) {
      throw new Problem({
        code: 'DV_E_LIMIT_EXCEEDED',
        message: `The expression is nested more than ${String(Math.min(this.maxDepth, HARD_DEPTH))} levels deep.`,
        hint: 'Use fewer parentheses and "!". If you trust this template, raise limits.maxExpressionDepth.',
        position: this.sc.pos,
      });
    }
  }

  /** Tries `token` after optional spaces; leaves the position unchanged when it is not there. */
  private take(token: string, notFollowedBy = ''): boolean {
    const save = this.sc.pos;
    this.sc.skipWs();
    const s = this.sc.s;
    if (s.startsWith(token, this.sc.pos) && (notFollowedBy === '' || !notFollowedBy.includes(s[this.sc.pos + token.length] ?? '\0'))) {
      this.sc.pos += token.length;
      this.sc.skipWs();
      return true;
    }
    this.sc.pos = save;
    return false;
  }

  pipe(): Expr {
    const e = this.logical();
    const formatters: FormatterCall[] = [];
    while (this.take('|', '|')) formatters.push(readFormatter(this.sc));
    return formatters.length === 0 ? e : { t: 'pipe', e, formatters };
  }

  logical(): Expr {
    let l = this.and();
    while (this.take('||')) l = { t: 'or', l, r: this.and() };
    return l;
  }

  private and(): Expr {
    let l = this.compare();
    while (this.take('&&')) l = { t: 'and', l, r: this.compare() };
    return l;
  }

  private operator(): CompareOp | null {
    const save = this.sc.pos;
    this.sc.skipWs();
    const s = this.sc.s;
    for (const op of COMPARE_OPS) {
      if (s.startsWith(op, this.sc.pos)) {
        this.sc.pos += op.length;
        this.sc.skipWs();
        return op;
      }
    }
    if (s[this.sc.pos] === '=') this.sc.fail('"=" is not an operator.', 'Compare with "==", for example {#status == "paid"}.');
    this.sc.pos = save;
    return null;
  }

  private compare(): Expr {
    const l = this.unary();
    const op = this.operator();
    if (op === null) return l;
    const r = this.unary();
    const at = this.sc.pos;
    if (this.operator() !== null) this.sc.fail('Comparisons cannot be chained.', 'Join two comparisons with &&, for example {#a > 1 && a < 9}.', at);
    return { t: 'compare', op, l, r };
  }

  private unary(): Expr {
    const sc = this.sc;
    if (sc.peek() === '!' && sc.s[sc.pos + 1] !== '=') {
      sc.next();
      sc.skipWs();
      this.enter();
      const e = this.unary();
      this.depth--;
      return { t: 'not', e };
    }
    return this.operand();
  }

  private operand(): Expr {
    const sc = this.sc;
    const c = sc.peek();
    if (c === '(') {
      sc.next();
      sc.skipWs();
      this.enter();
      const e = this.pipe();
      sc.skipWs();
      if (sc.peek() !== ')') sc.unexpected('")"');
      sc.next();
      this.depth--;
      return e;
    }
    if (DOUBLE_QUOTES.includes(c) || SINGLE_QUOTES.includes(c) || c === '-' || (c >= '0' && c <= '9')) return { t: 'literal', value: readLiteral(sc) };
    if (isIdStart(c)) {
      const save = sc.pos;
      while (isIdContinue(sc.peek())) sc.next();
      const word = sc.s.slice(save, sc.pos);
      if (word === 'true' || word === 'false' || word === 'null') return { t: 'literal', value: word === 'null' ? null : word === 'true' };
      sc.pos = save;
    }
    return { t: 'path', segments: readPath(sc, true) };
  }
}

/**
 * Parses the inside of a tag. Never throws: a tag that breaks the grammar, or nests deeper than
 * `maxDepth`, gives a {@link TagProblem}.
 */
export function parseTag(inner: string, maxDepth: number = 32): ParsedTag | TagProblem {
  const sc = new Scanner(inner);
  try {
    sc.skipWs();
    const kind = SIGILS.get(sc.peek()) ?? 'value';
    if (kind !== 'value') {
      sc.next();
      sc.skipWs();
    }
    if (sc.done) {
      return {
        code: 'DV_E_TAG_EMPTY',
        message: kind === 'value' ? 'The tag is empty.' : 'The tag has no name.',
        hint: 'Write a name between the braces, for example {customer.name}, or delete the braces if they are meant as text.',
        position: sc.pos,
      };
    }
    const parser = new ExprParser(sc, maxDepth);
    let full: Expr;
    if (kind === 'image' || kind === 'markdown') {
      full = { t: 'path', segments: readPath(sc, true) };
    } else if (kind === 'close') {
      if (sc.peek() === '.') readPath(sc, false);
      full = parser.logical();
    } else {
      full = parser.pipe();
    }
    sc.skipWs();
    if (!sc.done) {
      if (kind !== 'value' && kind !== 'section' && kind !== 'inverted' && sc.peek() === '|' && inner[sc.pos + 1] !== '|') {
        sc.fail(
          kind === 'close' ? 'A closing tag cannot have formatters.' : 'Image and Markdown tags cannot have formatters.',
          kind === 'close' ? 'Close the section with its name only, for example {/items}.' : 'Write only the name, for example {%logo} or {~summary}.',
        );
      }
      sc.unexpected(full.t === 'path' && full.segments.length > 0 ? '".", an operator, "|" or the end of the tag' : 'an operator, "|" or the end of the tag');
    }
    const expr = full.t === 'pipe' ? full.e : full;
    const formatters = full.t === 'pipe' ? full.formatters : [];
    return { kind, expr, path: canonical(expr), segments: expr.t === 'path' ? expr.segments : null, formatters, paths: pathsOf(full) };
  } catch (error) {
    if (error instanceof Problem) return error.problem;
    throw error;
  }
}
