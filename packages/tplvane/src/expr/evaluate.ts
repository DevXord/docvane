// Evaluates expressions against the data, by walking the expression tree: there is no eval, no
// new Function and no other way to run code from a template. Data is read only through own data
// properties (Object.getOwnPropertyDescriptor), so getters are never called and nothing is read
// from prototypes; names that reach prototypes are already refused by the parser (D-024).
import type { Expr } from './ast';
import { applyFormatter, ValueError, type Formatting } from './formatters';

/** Thrown when an expression needs a value that the data does not have. */
export class MissingField extends Error {
  constructor(readonly path: string) {
    super(`missing ${path}`);
  }
}

/** The value of an own data property, or undefined. Getters are not called. */
export function ownValue(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d !== undefined && 'value' in d ? d.value : undefined;
}

/** Whether `obj` has `key` as an own data property. */
function hasOwnValue(obj: unknown, key: string): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d !== undefined && 'value' in d;
}

/**
 * Looks a path up in the scopes, innermost first: the first name is searched in each scope
 * outwards, the rest only below where it was found. Returns undefined when it is missing.
 */
export function lookup(scopes: readonly unknown[], segments: readonly string[]): unknown {
  if (segments.length === 0) return scopes[scopes.length - 1];
  const first = segments[0] as string;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!hasOwnValue(scope, first)) continue;
    let value = ownValue(scope, first);
    for (let j = 1; j < segments.length; j++) {
      value = ownValue(value, segments[j] as string);
      if (value === undefined) return undefined;
    }
    return value;
  }
  return undefined;
}

/** The truth of a value in sections and logical operators. */
export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function kind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : typeof value;
}

/**
 * Evaluates `e`. A missing path gives undefined, except where the value must exist (an operand
 * of a comparison), where it throws {@link MissingField}. Formatters throw ValueError.
 */
export function evaluate(e: Expr, scopes: readonly unknown[], fmt: Formatting): unknown {
  switch (e.t) {
    case 'literal':
      return e.value;
    case 'path':
      return lookup(scopes, e.segments);
    case 'not':
      return !truthy(evaluate(e.e, scopes, fmt));
    case 'and': {
      const l = evaluate(e.l, scopes, fmt);
      return truthy(l) ? evaluate(e.r, scopes, fmt) : l;
    }
    case 'or': {
      const l = evaluate(e.l, scopes, fmt);
      return truthy(l) ? l : evaluate(e.r, scopes, fmt);
    }
    case 'compare': {
      const l = operand(e.l, scopes, fmt);
      const r = operand(e.r, scopes, fmt);
      switch (e.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        default: {
          const numbers = typeof l === 'number' && typeof r === 'number';
          const strings = typeof l === 'string' && typeof r === 'string';
          if (!numbers && !strings) {
            throw new ValueError(`"${e.op}" compares two numbers or two texts, not ${kind(l)} and ${kind(r)}.`, 'Make both sides numbers (or both texts) in the data, or compare with == instead.');
          }
          const a = l as number | string;
          const b = r as number | string;
          return e.op === '<' ? a < b : e.op === '<=' ? a <= b : e.op === '>' ? a > b : a >= b;
        }
      }
    }
    case 'pipe': {
      let value = evaluate(e.e, scopes, fmt);
      for (const f of e.formatters) value = applyFormatter(f, value, fmt);
      return value;
    }
  }
}

function operand(e: Expr, scopes: readonly unknown[], fmt: Formatting): unknown {
  const value = evaluate(e, scopes, fmt);
  if (value === undefined) {
    const missing = firstMissing(e, scopes);
    throw new MissingField(missing ?? '?');
  }
  return value;
}

/** The first path of `e` that the data does not have. */
export function firstMissing(e: Expr, scopes: readonly unknown[]): string | null {
  switch (e.t) {
    case 'path':
      return lookup(scopes, e.segments) === undefined ? (e.segments.length === 0 ? '.' : e.segments.join('.')) : null;
    case 'not':
    case 'pipe':
      return firstMissing(e.e, scopes);
    case 'and':
    case 'or':
    case 'compare':
      return firstMissing(e.l, scopes) ?? firstMissing(e.r, scopes);
    default:
      return null;
  }
}
