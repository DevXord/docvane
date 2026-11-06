// Renders the stories of a DOCX template with data. The template tree is not changed while
// rendering: each story is rendered into a new tree that shares the unchanged subtrees of the
// template, so loops never copy the template's bookkeeping, and the output is counted against
// `maxOutputBytes` as it is built (D-026, D-027).
import { DvError } from '../errors';
import type { Expr } from '../expr/ast';
import { evaluate, firstMissing, MissingField, ownValue, truthy } from '../expr/evaluate';
import { ValueError, type Formatting } from '../expr/formatters';
import { limitError, type Limits } from '../limits';
import type { StoryAnalysis, TagRecord } from '../template/analyze';
import type { SectionTree, TreeChild } from '../template/structure';
import { clip } from '../util/clip';
import { suggest } from '../util/suggest';
import { firstInvalidXmlChar } from '../xml/writer';
import { makeElement, prefixOf, serializeInto, type RawDocument, type RawElement, type RawNode } from '../xml/raw-tree';
import { isolateTags, textElement } from './normalize';
import { MC_NAMESPACE, selectedBranch, WML_NAMESPACES } from './paragraphs';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

/** Elements left out of the second and later copies of repeated content (D-027). */
const NOT_IN_COPIES: ReadonlySet<string> = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference']);

/** How a section repeats: what is repeated, in which container. */
interface SectionUnit {
  readonly tree: SectionTree;
  readonly container: RawElement;
  readonly from: number;
  readonly to: number;
  /** true: children from..to are repeated and the tags inside are dropped; false: from and to are dropped and what is between is repeated. */
  readonly inclusive: boolean;
}

/** Everything a render needs, shared by the stories of one document. */
export interface RenderContext {
  readonly limits: Limits;
  readonly formatting: Formatting;
  readonly missing: 'error' | 'empty';
  readonly problems: DvError[];
  iterations: number;
  output: number;
  nextDrawingId: number;
}

const isWml = (e: RawElement, local?: string): boolean => WML_NAMESPACES.has(e.ns) && (local === undefined || e.local === local);

function placement(tag: TagRecord, message: string, hint: string): DvError {
  return new DvError('DV_E_SECTION_PLACEMENT', message, { location: tag.info.location, hint, details: { tag: tag.info.raw } });
}

/** The ancestors of `node`, from the root down to `node` itself. */
function ancestors(node: RawElement): RawElement[] {
  const out: RawElement[] = [];
  for (let n: RawElement | null = node; n !== null; n = n.parent) out.push(n);
  return out.reverse();
}

/** Where a section repeats, from the anchors of its opening and closing tags. */
function unitOf(section: SectionTree, anchors: ReadonlyMap<TagRecord, RawElement>): SectionUnit | DvError {
  const open = anchors.get(section.open) as RawElement;
  const close = anchors.get(section.close) as RawElement;
  const a = ancestors(open);
  const b = ancestors(close);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const container = a[i - 1] as RawElement;
  const x = a[i] as RawElement;
  const y = b[i] as RawElement;
  const from = container.children.indexOf(x);
  const to = container.children.indexOf(y);
  const blockish = (e: RawElement): boolean => isWml(e, 'p') || isWml(e, 'tbl') || isWml(e, 'sdt');
  const where = `{${section.open.info.kind === 'inverted' ? '^' : '#'}${section.open.info.path}}`;
  if (isWml(x, 'tr') && isWml(y, 'tr')) return { tree: section, container, from, to, inclusive: true };
  if (isWml(x, 'tc') && isWml(y, 'tc')) {
    const table = container.parent as RawElement;
    const row = table.children.indexOf(container);
    return { tree: section, container: table, from: row, to: row, inclusive: true };
  }
  if (blockish(x) || blockish(y)) {
    const alone = (tag: TagRecord, element: RawElement): boolean => tag.paragraph.element === element && tag.paragraph.text.trim() === tag.info.raw;
    if (!alone(section.open, x) || !alone(section.close, y)) {
      return placement(
        section.open,
        `The section "${where}" spans several paragraphs, so its opening and closing tags must each be alone in their paragraph.`,
        `Put ${where} and {/${section.open.info.path}} each on a line of their own, or keep the whole section within one paragraph.`,
      );
    }
    return { tree: section, container, from, to, inclusive: false };
  }
  if (x === open && y === close) return { tree: section, container, from, to, inclusive: false };
  return placement(
    section.open,
    `The tags of the section "${where}" are in different parts of a paragraph (for example one inside a hyperlink and one outside).`,
    'Put both tags at the same level: both inside the hyperlink or field, or both outside it.',
  );
}

/** Collects the sections of a tree, outermost first. */
function sectionsOf(children: readonly TreeChild[], out: SectionTree[] = []): SectionTree[] {
  for (const child of children) {
    if ('section' in child) {
      out.push(child.section);
      sectionsOf(child.section.children, out);
    }
  }
  return out;
}

function fullExpr(tag: TagRecord): Expr {
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

/** One story being rendered. */
class StoryRenderer {
  private readonly anchors = new Map<TagRecord, RawElement>();
  private readonly valueAnchors = new Map<RawElement, TagRecord>();
  private readonly droppedAnchors = new Set<RawElement>();
  private readonly units = new Map<RawElement, SectionUnit[]>();
  private readonly prunedAlternates = new Set<RawElement>();
  private readonly sizes = new Map<RawNode, number>();

  constructor(
    private readonly story: StoryAnalysis,
    private readonly ctx: RenderContext,
  ) {}

  /** Normalises the template and finds where each section repeats. Returns problems of placement. */
  prepare(): DvError[] {
    const byParagraph = new Map<object, TagRecord[]>();
    for (const tag of this.story.tags) {
      const list = byParagraph.get(tag.paragraph) ?? [];
      list.push(tag);
      byParagraph.set(tag.paragraph, list);
    }
    for (const paragraph of this.story.paragraphs) {
      const tags = byParagraph.get(paragraph);
      if (tags === undefined) continue;
      for (const [tag, anchor] of isolateTags(paragraph, tags)) this.anchors.set(tag, anchor);
      // A text box with tags is rendered in its selected branch; the other form of the same box would keep the tags.
      for (const alternate of paragraph.alternates) this.prunedAlternates.add(alternate);
    }
    for (const tag of this.story.tags) {
      const anchor = this.anchors.get(tag);
      if (anchor === undefined) continue;
      if (tag.info.kind === 'value') this.valueAnchors.set(anchor, tag);
    }
    const problems: DvError[] = [];
    for (const section of sectionsOf(this.story.tree)) {
      const unit = unitOf(section, this.anchors);
      if (unit instanceof DvError) {
        problems.push(unit);
        continue;
      }
      const list = this.units.get(unit.container) ?? [];
      if (unit.inclusive && list.some((u) => u.inclusive && u.from === unit.from && u.to === unit.to)) {
        problems.push(placement(section.open, `The section "{#${section.open.info.path}}" repeats the same table rows as the section around it.`, 'Move one of the two sections so that each repeats different rows, or join them into one.'));
        continue;
      }
      list.push(unit);
      this.units.set(unit.container, list);
      if (unit.inclusive) {
        this.droppedAnchors.add(this.anchors.get(section.open) as RawElement);
        this.droppedAnchors.add(this.anchors.get(section.close) as RawElement);
      }
    }
    // Outermost first at the same start: the wider range wins.
    for (const list of this.units.values()) list.sort((p, q) => p.from - q.from || q.to - q.from - (p.to - p.from));
    return problems;
  }

  render(data: unknown): RawDocument {
    const { doc } = this.story;
    const root = this.renderElement(doc.root, [data], new Set(), false) as RawElement;
    return { prolog: doc.prolog, root, epilog: doc.epilog };
  }

  private count(node: RawNode): void {
    let size = this.sizes.get(node);
    if (size === undefined) {
      const out: string[] = [];
      serializeInto(node, out);
      size = out.reduce((n, s) => n + s.length, 0);
      this.sizes.set(node, size);
    }
    this.ctx.output += size;
    if (this.ctx.output > this.ctx.limits.maxOutputBytes) {
      throw limitError('maxOutputBytes', this.ctx.limits.maxOutputBytes, `The result would be larger than ${String(this.ctx.limits.maxOutputBytes)} characters of XML.`, { part: this.story.part });
    }
  }

  private problem(error: DvError): void {
    if (this.ctx.problems.length < this.ctx.limits.maxErrors) this.ctx.problems.push(error);
  }

  private missing(tag: TagRecord, path: string, scopes: readonly unknown[]): void {
    if (this.ctx.missing === 'empty') return;
    const first = path.split('.')[0] ?? path;
    const close = suggest(first, availableNames(scopes));
    this.problem(
      new DvError('DV_E_MISSING_FIELD', `The data has no "${clip(path)}", which ${tag.info.raw.length > 60 ? 'a tag' : `"${clip(tag.info.raw)}"`} needs.`, {
        location: tag.info.location,
        hint: `${close.length > 0 ? `Did you mean ${close.map((c) => `"${c}"`).join(' or ')}? ` : ''}Add "${clip(path)}" to the data, give the tag a default (| default("-")), or render with { missing: "empty" }.`,
        details: { path: clip(path), tag: clip(tag.info.raw) },
      }),
    );
  }

  private invalid(tag: TagRecord, message: string, hint: string): void {
    this.problem(new DvError('DV_E_INVALID_VALUE', message, { location: tag.info.location, hint, details: { tag: clip(tag.info.raw) } }));
  }

  /** Evaluates the expression of a tag; problems are recorded and give undefined. */
  private evaluate(tag: TagRecord, scopes: readonly unknown[]): { ok: boolean; value: unknown } {
    try {
      return { ok: true, value: evaluate(fullExpr(tag), scopes, this.ctx.formatting) };
    } catch (error) {
      if (error instanceof MissingField) this.missing(tag, error.path, scopes);
      else if (error instanceof ValueError) this.invalid(tag, `${error.message} (in "${clip(tag.info.raw)}")`, error.hint);
      else throw error;
      return { ok: false, value: undefined };
    }
  }

  /** The text of a value tag, or null when it has a problem. */
  private valueText(tag: TagRecord, scopes: readonly unknown[]): string | null {
    const { ok, value } = this.evaluate(tag, scopes);
    if (!ok) return null;
    if (value === undefined) {
      this.missing(tag, firstMissing(fullExpr(tag), scopes) ?? tag.info.path, scopes);
      return null;
    }
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
    const bad = firstInvalidXmlChar(text);
    if (bad !== -1) {
      this.invalid(
        tag,
        `The value of "${clip(tag.info.raw)}" contains the character U+${(text.codePointAt(bad) ?? 0).toString(16).toUpperCase().padStart(4, '0')} at position ${String(bad + 1)}, which a document cannot hold.`,
        'Remove control characters (other than tab and line breaks) and unpaired surrogates from the data.',
      );
      return null;
    }
    return text;
  }

  /** The runs that show `text` in place of the anchor: line breaks become w:br, tabs w:tab. */
  private valueRuns(anchor: RawElement, text: string): RawElement[] {
    if (text === '') return [];
    const p = prefixOf(anchor.qname);
    const rPr = anchor.children.find((c): c is RawElement => c.kind === 'element' && isWml(c, 'rPr'));
    const t = anchor.children.find((c): c is RawElement => c.kind === 'element' && isWml(c, 't')) as RawElement;
    const run = makeElement(anchor, anchor.open, anchor.close, anchor.attrs);
    const children: RawNode[] = rPr === undefined ? [] : [rPr];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) children.push(makeElement({ ns: anchor.ns, local: 'br', qname: `${p}br` }, `<${p}br/>`, ''));
      line.split('\t').forEach((piece, j) => {
        if (j > 0) children.push(makeElement({ ns: anchor.ns, local: 'tab', qname: `${p}tab` }, `<${p}tab/>`, ''));
        if (piece !== '') children.push(textElement(t, piece));
      });
    });
    run.children = children;
    return [run];
  }

  /** The scopes of each repetition of a section, or an empty list when its content is not shown. */
  private iterations(section: SectionTree, scopes: readonly unknown[]): (readonly unknown[])[] {
    const open = section.open;
    const { ok, value } = this.evaluate(open, scopes);
    if (!ok) return [];
    if (open.info.kind === 'inverted') return truthy(value) ? [] : [scopes];
    if (value === undefined) {
      if (section.kind === 'loop') this.missing(open, firstMissing(fullExpr(open), scopes) ?? open.info.path, scopes);
      return [];
    }
    if (Array.isArray(value)) return value.map((item) => [...scopes, item]);
    return truthy(value) ? [[...scopes, value]] : [];
  }

  private renderElement(e: RawElement, scopes: readonly unknown[], active: ReadonlySet<SectionUnit>, copy: boolean): RawNode | null {
    const valueTag = this.valueAnchors.get(e);
    if (valueTag !== undefined) return null;
    if (this.droppedAnchors.has(e)) return null;
    if (copy && isWml(e) && NOT_IN_COPIES.has(e.local)) return null;
    const units = this.units.get(e);
    const hasWork = units !== undefined || this.containsWork(e);
    if (!hasWork && !copy) {
      this.count(e);
      return e;
    }
    let open = e.open;
    if (copy) {
      if (e.attrs.has(`{${W14}}paraId`) || e.attrs.has(`{${W14}}textId`)) open = open.replace(/\s+[\w.-]+:(?:paraId|textId)="[^"]*"/g, '');
      if (e.ns === WP && e.local === 'docPr' && e.attrs.has('id')) open = open.replace(/(\sid=")[^"]*(")/, `$1${String(this.ctx.nextDrawingId++)}$2`);
    }
    const out = makeElement(e, open, e.close, e.attrs);
    this.ctx.output += open.length + e.close.length;
    out.children = this.renderChildren(e, 0, e.children.length - 1, scopes, active, copy);
    return out;
  }

  /** Whether an element holds anchors or repeated sections below it (computed once per element). */
  private readonly work = new Map<RawElement, boolean>();
  private containsWork(e: RawElement): boolean {
    let known = this.work.get(e);
    if (known !== undefined) return known;
    known = this.valueAnchors.has(e) || this.droppedAnchors.has(e) || this.units.has(e) || this.prunedAlternates.has(e) || e.children.some((c) => c.kind === 'element' && this.containsWork(c));
    this.work.set(e, known);
    return known;
  }

  private renderChildren(container: RawElement, from: number, to: number, scopes: readonly unknown[], active: ReadonlySet<SectionUnit>, copy: boolean): RawNode[] {
    const out: RawNode[] = [];
    const units = this.units.get(container) ?? [];
    const pruned = this.prunedAlternates.has(container) ? selectedBranch(container) : undefined;
    for (let i = from; i <= to; ) {
      const unit = units.find((u) => u.from === i && u.to <= to && !active.has(u));
      if (unit !== undefined) {
        const repeats = this.iterations(unit.tree, scopes);
        const inner = new Set(active).add(unit);
        repeats.forEach((itemScopes, k) => {
          if (++this.ctx.iterations > this.ctx.limits.maxIterations) {
            throw limitError('maxIterations', this.ctx.limits.maxIterations, `Sections repeat their content more than ${String(this.ctx.limits.maxIterations)} times in all.`, unit.tree.open.info.location);
          }
          const a = unit.inclusive ? unit.from : unit.from + 1;
          const b = unit.inclusive ? unit.to : unit.to - 1;
          out.push(...this.renderChildren(container, a, b, itemScopes, inner, copy || k > 0));
        });
        i = unit.to + 1;
        continue;
      }
      const child = container.children[i] as RawNode;
      i++;
      if (child.kind === 'text') {
        this.count(child);
        out.push(child);
        continue;
      }
      if (pruned !== undefined && child.ns === MC_NAMESPACE && child !== pruned) continue;
      const valueTag = this.valueAnchors.get(child);
      if (valueTag !== undefined) {
        const text = this.valueText(valueTag, scopes);
        for (const run of this.valueRuns(child, text ?? '')) {
          this.count(run);
          out.push(run);
        }
        continue;
      }
      const rendered = this.renderElement(child, scopes, active, copy);
      if (rendered !== null) out.push(rendered);
    }
    return out;
  }
}

/** Renders one story; returns the new XML of the part. Problems of data are added to `ctx.problems`. */
export function prepareStory(story: StoryAnalysis, ctx: RenderContext): { problems: DvError[]; render: (data: unknown) => string } {
  const renderer = new StoryRenderer(story, ctx);
  const problems = renderer.prepare();
  return {
    problems,
    render(data) {
      const doc = renderer.render(data);
      const out: string[] = [doc.prolog];
      serializeInto(doc.root, out);
      out.push(doc.epilog);
      return out.join('');
    },
  };
}

/** The largest wp:docPr id in a tree, so that copies of drawings get new ones above it. */
export function maxDrawingId(doc: RawDocument): number {
  let max = 0;
  const work: RawNode[] = [doc.root];
  while (work.length > 0) {
    const node = work.pop() as RawNode;
    if (node.kind !== 'element') continue;
    if (node.ns === WP && node.local === 'docPr') {
      const id = Number(node.attrs.get('id'));
      if (Number.isSafeInteger(id) && id > max) max = id;
    }
    for (const c of node.children) work.push(c);
  }
  return max;
}

