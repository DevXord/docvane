// Evaluates tags against the data: values, the repetitions of sections, and the problems they
// have (missing fields, values that cannot be written). Documents, presentations and workbooks
// all render through it, so a tag means the same in every format.
import { DvError } from '../errors';
import type { Expr } from '../expr/ast';
import { evaluate, firstMissing, MissingField, ownValue, truthy } from '../expr/evaluate';
import { LinkValue, ValueError, type Formatting } from '../expr/formatters';
import { limitError, type Limits } from '../limits';
import { clip } from '../util/clip';
import { suggest } from '../util/suggest';
import { firstInvalidXmlChar } from '../xml/writer';
import type { TagRecord } from './analyze';
import type { SectionTree } from './structure';
import { dataPathOf, pointerOf, type DataPath } from '../util/data-path';

/** What evaluation needs from a rendering: limits, formatting and where problems go. */
export interface EvalContext {
  readonly limits: Limits;
  readonly formatting: Formatting;
  readonly missing: 'error' | 'empty';
  readonly problems: DvError[];
  iterations: number;
  output: number;
  /**
   * The place in the data of every scope of a list of scopes, by the list (D-047): for the root
   * `[data]` nothing is stored and its path is empty. Shared by the renderers of one rendering.
   */
  readonly scopePaths: WeakMap<readonly unknown[], readonly DataPath[]>;
}


/** The paths of each scope of `scopes`. */
function pathsOf(ctx: EvalContext, scopes: readonly unknown[]): readonly DataPath[] {
  return ctx.scopePaths.get(scopes) ?? scopes.map(() => []);
}

/** The index of the scope where `first` is found (the innermost with it as an own data field), or the innermost scope. */
function scopeOf(scopes: readonly unknown[], first: string | undefined): number {
  if (first !== undefined) {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scope = scopes[i];
      if (scope !== null && typeof scope === 'object' && ownValue(scope, first) !== undefined) return i;
    }
  }
  return scopes.length - 1;
}

/**
 * Where a path of a tag is in the data: the path up to its first missing field, and the names that
 * the object holding that missing field offers (none when nothing is missing).
 */
export function locateInData(ctx: EvalContext, scopes: readonly unknown[], segments: readonly string[]): { path: DataPath; available: string[] } {
  const at = scopeOf(scopes, segments[0]);
  const path: (string | number)[] = [...(pathsOf(ctx, scopes)[at] ?? [])];
  let holder: unknown = scopes[at];
  for (const name of segments) {
    path.push(name);
    const next = ownValue(holder, name);
    if (next === undefined) return { path, available: namesOf(holder) };
    holder = next;
  }
  return { path, available: [] };
}

/** The names of the own data fields of an object, up to 20. */
function namesOf(obj: unknown): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const names: string[] = [];
  for (const key of Object.keys(obj)) {
    if (ownValue(obj, key) === undefined) continue;
    names.push(key);
    if (names.length >= 20) break;
  }
  return names;
}

/** The expression of a tag with its formatters. */
export function fullExpr(tag: TagRecord): Expr {
  return tag.parsed.formatters.length === 0 ? tag.parsed.expr : { t: 'pipe', e: tag.parsed.expr, formatters: tag.parsed.formatters };
}

/** The names that the data offers at this point, for "did you mean" hints. */
function availableNames(scopes: readonly unknown[]): string[] {
  const names: string[] = [];
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) continue;
    for (const key of Object.keys(scope)) if (!names.includes(key) && ownValue(scope, key) !== undefined) names.push(key);
    if (names.length > 200) break;
  }
  return names;
}

/** Evaluates tags; each format's renderer extends it. */
export class TagEvaluator {
  constructor(protected readonly ctx: EvalContext) {}

  protected problem(error: DvError): void {
    if (this.ctx.problems.length < this.ctx.limits.maxErrors) this.ctx.problems.push(error);
  }

  protected missing(tag: TagRecord, path: string, scopes: readonly unknown[]): void {
    if (this.ctx.missing === 'empty') return;
    const where = locateInData(this.ctx, scopes, path === '.' ? [] : path.split('.'));
    // Suggest names for the field that is missing: among the names of its object, or, for the
    // first name of the path, among the names of every scope.
    const missingName = String(where.path[where.path.length - 1] ?? path);
    const first = path.split('.')[0] ?? path;
    const firstMissing = !scopes.some((scope) => ownValue(scope, first) !== undefined);
    const close = suggest(missingName, firstMissing ? availableNames(scopes) : where.available);
    const here = where.available.length > 0 ? ` The data has here: ${where.available.map(clip).join(', ')}.` : '';
    this.problem(
      new DvError('DV_E_MISSING_FIELD', `The data has no "${clip(path)}", which ${tag.info.raw.length > 60 ? 'a tag' : `"${clip(tag.info.raw)}"`} needs.`, {
        location: tag.info.location,
        hint: `${close.length > 0 ? `Did you mean ${close.map((c) => `"${c}"`).join(' or ')}? ` : ''}Add "${clip(path)}" to the data, give the tag a default (| default("-")), or render with { missing: "empty" }.${here}`,
        details: { path: clip(path), tag: clip(tag.info.raw), dataPath: clip(dataPathOf(where.path)), pointer: clip(pointerOf(where.path)), available: where.available.map(clip) },
      }),
    );
  }

  /** The tag last evaluated and its scopes, to give problems found afterwards the place of the value in the data. */
  private current: { tag: TagRecord; scopes: readonly unknown[] } | null = null;

  protected invalid(tag: TagRecord, message: string, hint: string): void {
    const segments = tag.parsed.segments;
    const place =
      this.current !== null && this.current.tag === tag && segments !== null
        ? (() => {
            const { path } = locateInData(this.ctx, this.current.scopes, segments);
            return { dataPath: clip(dataPathOf(path)), pointer: clip(pointerOf(path)) };
          })()
        : {};
    this.problem(new DvError('DV_E_INVALID_VALUE', message, { location: tag.info.location, hint, details: { tag: clip(tag.info.raw), ...place } }));
  }

  /** Evaluates the expression of a tag; problems are recorded and give undefined. */
  protected evaluate(tag: TagRecord, scopes: readonly unknown[]): { ok: boolean; value: unknown } {
    this.current = { tag, scopes };
    try {
      return { ok: true, value: evaluate(fullExpr(tag), scopes, this.ctx.formatting) };
    } catch (error) {
      if (error instanceof MissingField) this.missing(tag, error.path, scopes);
      else if (error instanceof ValueError) this.invalid(tag, `${error.message} (in "${clip(tag.info.raw)}")`, error.hint);
      else throw error;
      return { ok: false, value: undefined };
    }
  }

  /** The text of a value tag (or a link from the link formatter), or null when it has a problem. */
  protected valueText(tag: TagRecord, scopes: readonly unknown[]): string | LinkValue | null {
    const { ok, value } = this.evaluate(tag, scopes);
    if (!ok) return null;
    if (value === undefined) {
      this.missing(tag, firstMissing(fullExpr(tag), scopes) ?? tag.info.path, scopes);
      return null;
    }
    if (value instanceof LinkValue) return this.checkText(tag, value.text) === null ? null : value;
    let text: string;
    if (value === null) text = '';
    else if (typeof value === 'string') text = value;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        this.invalid(tag, `The value of "${clip(tag.info.raw)}" is ${String(value)}, which cannot be written.`, 'Pass a finite number.');
        return null;
      }
      text = String(value);
    } else if (typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
    else {
      const what = Array.isArray(value) ? 'a list' : value instanceof Date ? 'a date' : typeof value === 'object' ? 'an object' : `a ${typeof value}`;
      this.invalid(
        tag,
        `The value of "${clip(tag.info.raw)}" is ${what}, which cannot be written as text.`,
        Array.isArray(value) ? `Use a section to repeat the list: {#${tag.info.path}}…{/${tag.info.path}}.` : value instanceof Date ? `Format it with a formatter, for example {${tag.info.path} | date("long")}.` : 'Write one of its fields, for example {customer.name} instead of {customer}.',
      );
      return null;
    }
    return this.checkText(tag, text);
  }

  /** `text` when a document can hold all its characters; otherwise records a problem and gives null. */
  protected checkText(tag: TagRecord, text: string): string | null {
    const bad = firstInvalidXmlChar(text);
    if (bad === -1) return text;
    this.invalid(
      tag,
      `The value of "${clip(tag.info.raw)}" contains the character U+${(text.codePointAt(bad) ?? 0).toString(16).toUpperCase().padStart(4, '0')} at position ${String(bad + 1)}, which a document cannot hold.`,
      'Remove control characters (other than tab and line breaks) and unpaired surrogates from the data.',
    );
    return null;
  }

  /** The scopes of each repetition of a section, or an empty list when its content is not shown. */
  protected iterations(section: SectionTree, scopes: readonly unknown[]): (readonly unknown[])[] {
    const open = section.open;
    const { ok, value } = this.evaluate(open, scopes);
    if (!ok) return [];
    if (open.info.kind === 'inverted') return truthy(value) ? [] : [scopes];
    if (value === undefined) {
      if (section.kind === 'loop') this.missing(open, firstMissing(fullExpr(open), scopes) ?? open.info.path, scopes);
      return [];
    }
    // Each new list of scopes remembers where its innermost scope is in the data.
    const parents = pathsOf(this.ctx, scopes);
    const segments = open.parsed.segments;
    const base: DataPath = segments === null ? (parents[parents.length - 1] ?? []) : [...(parents[scopeOf(scopes, segments[0])] ?? []), ...segments];
    const scoped = (item: unknown, path: DataPath): readonly unknown[] => {
      const next = [...scopes, item];
      this.ctx.scopePaths.set(next, [...parents, path]);
      return next;
    };
    if (Array.isArray(value)) {
      // The budget is checked before any repetition is built (D-062), and items are read as own data properties.
      if (this.ctx.iterations + value.length > this.ctx.limits.maxIterations) {
        throw limitError('maxIterations', this.ctx.limits.maxIterations, `Sections repeat their content more than ${String(this.ctx.limits.maxIterations)} times in all.`, open.info.location);
      }
      const out: (readonly unknown[])[] = [];
      for (let i = 0; i < value.length; i++) out.push(scoped(ownValue(value, String(i)), [...base, i]));
      return out;
    }
    return truthy(value) ? [scoped(value, base)] : [];
  }
}
