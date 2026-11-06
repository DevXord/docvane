// The expression tree of a tag (docs/syntax.md, "Expressions") and its canonical text.
import type { FormatterArg, FormatterCall } from '../model';

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

/** An expression. Nothing in it can call a function other than an allow-listed formatter. */
export type Expr =
  | { readonly t: 'literal'; readonly value: FormatterArg }
  | { readonly t: 'path'; readonly segments: readonly string[] }
  | { readonly t: 'not'; readonly e: Expr }
  | { readonly t: 'and' | 'or'; readonly l: Expr; readonly r: Expr }
  | { readonly t: 'compare'; readonly op: CompareOp; readonly l: Expr; readonly r: Expr }
  | { readonly t: 'pipe'; readonly e: Expr; readonly formatters: readonly FormatterCall[] };

const PRECEDENCE: Readonly<Record<Expr['t'], number>> = { pipe: 0, or: 1, and: 2, compare: 3, not: 4, literal: 5, path: 5 };

function literalText(value: FormatterArg): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** The text of a formatter call, with arguments in canonical form. */
export function formatterText(f: FormatterCall): string {
  return f.args.length === 0 ? f.name : `${f.name}(${f.args.map(literalText).join(', ')})`;
}

/**
 * The canonical text of an expression: single spaces around operators, straight double quotes,
 * parentheses only where precedence needs them. Two tags with the same canonical text mean the
 * same thing, which is how a closing tag finds its section.
 */
export function canonical(e: Expr): string {
  const wrap = (child: Expr, min: number): string => (PRECEDENCE[child.t] < min ? `(${canonical(child)})` : canonical(child));
  switch (e.t) {
    case 'literal':
      return literalText(e.value);
    case 'path':
      return e.segments.length === 0 ? '.' : e.segments.join('.');
    case 'not':
      return `!${wrap(e.e, PRECEDENCE.not)}`;
    case 'and':
    case 'or':
      return `${wrap(e.l, PRECEDENCE[e.t])} ${e.t === 'and' ? '&&' : '||'} ${wrap(e.r, PRECEDENCE[e.t] + 1)}`;
    case 'compare':
      return `${wrap(e.l, PRECEDENCE.not)} ${e.op} ${wrap(e.r, PRECEDENCE.not)}`;
    case 'pipe':
      return `${wrap(e.e, PRECEDENCE.or)} | ${e.formatters.map(formatterText).join(' | ')}`;
  }
}

/** Every data path the expression reads, as text, in order of first use. */
export function pathsOf(e: Expr): string[] {
  const out: string[] = [];
  const walk = (x: Expr): void => {
    switch (x.t) {
      case 'path': {
        const text = x.segments.length === 0 ? '.' : x.segments.join('.');
        if (!out.includes(text)) out.push(text);
        return;
      }
      case 'not':
      case 'pipe':
        walk(x.e);
        return;
      case 'and':
      case 'or':
      case 'compare':
        walk(x.l);
        walk(x.r);
        return;
      case 'literal':
    }
  };
  walk(e);
  return out;
}

/** Every formatter call in the expression, nested ones included. */
export function formattersOf(e: Expr): FormatterCall[] {
  const out: FormatterCall[] = [];
  const walk = (x: Expr): void => {
    switch (x.t) {
      case 'pipe':
        walk(x.e);
        out.push(...x.formatters);
        return;
      case 'not':
        walk(x.e);
        return;
      case 'and':
      case 'or':
      case 'compare':
        walk(x.l);
        walk(x.r);
        return;
      default:
    }
  };
  walk(e);
  return out;
}
