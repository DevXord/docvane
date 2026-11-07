// Before rendering, every tag is moved into a run of its own, the "anchor": a w:r with the run
// properties of the run where the tag's `{` is, holding one w:t with the tag. Text before and
// after a tag stays in runs with its own properties, so the formatting around tags is kept
// (D-026). Only paragraphs with tags are changed; their runs are first split into runs of one
// child each (w:t, w:tab, w:fldChar, …), then text runs are cut at the edges of tags.
import { escapeText } from '../xml/writer';
import { makeElement, prefixOf, type RawElement, type RawNode } from '../xml/raw-tree';
import type { TagRecord } from '../template/analyze';
import type { ParagraphRecord } from './paragraphs';
import { WML_NAMESPACES } from './paragraphs';

/** The namespaces of runs and their text: WordprocessingML, or DrawingML in presentations. */
export interface TextDialect {
  readonly namespaces: ReadonlySet<string>;
  /** Whether a w:t may carry xml:space="preserve" (WordprocessingML) or not (DrawingML a:t). */
  readonly preserveSpace: boolean;
}

export const WML_DIALECT: TextDialect = { namespaces: WML_NAMESPACES, preserveSpace: true };

const isIn = (d: TextDialect) => (e: RawNode, local: string): e is RawElement => e.kind === 'element' && d.namespaces.has(e.ns) && e.local === local;

/**
 * Collects replacements of nodes and applies them with one pass over the children of each parent,
 * so that a paragraph with many runs is rewritten in linear time (D-062).
 */
class Replacements {
  private readonly byParent = new Map<RawElement, Map<RawNode, readonly RawElement[]>>();

  /** Replaces `node` in its parent by `replacements` at the next flush. */
  add(node: RawElement, replacements: readonly RawElement[]): void {
    const parent = node.parent;
    if (parent === null) return;
    const map = this.byParent.get(parent) ?? new Map<RawNode, readonly RawElement[]>();
    map.set(node, replacements);
    this.byParent.set(parent, map);
  }

  flush(): void {
    for (const [parent, map] of this.byParent) {
      const children: RawNode[] = [];
      for (const child of parent.children) {
        const replacement = map.get(child);
        if (replacement === undefined) {
          children.push(child);
          continue;
        }
        for (const r of replacement) {
          r.parent = parent;
          children.push(r);
        }
      }
      parent.children = children;
    }
    this.byParent.clear();
  }
}

/**
 * A new run with the start and end tags of `run`, a shared copy of its properties, and `content`,
 * which is moved into it (its nodes keep their identity, so records that point to them stay valid).
 */
function runWith(run: RawElement, rPr: RawElement | undefined, content: readonly RawElement[]): RawElement {
  const copy = makeElement(run, run.open.endsWith('/>') ? run.open.replace(/\s*\/>$/, '>') : run.open, run.close === '' ? `</${run.qname}>` : run.close, run.attrs);
  const children: RawNode[] = [];
  if (rPr !== undefined) children.push({ ...rPr, parent: copy });
  for (const c of content) {
    c.parent = copy;
    children.push(c);
  }
  copy.children = children;
  return copy;
}

/** A new w:t with `text`, written like `model`. */
export function textElement(model: RawElement, text: string, dialect: TextDialect = WML_DIALECT): RawElement {
  const p = prefixOf(model.qname);
  const preserve = dialect.preserveSpace && /^\s|\s$|\s\s/.test(text);
  const t = makeElement(model, `<${p}t${preserve ? ' xml:space="preserve"' : ''}>`, `</${p}t>`);
  t.children = [{ kind: 'text', raw: escapeText(text), text, parent: t, start: -1 }];
  return t;
}

/** A text run after splitting: the run, its w:t and the part of the paragraph text it holds. */
interface TextRun {
  readonly run: RawElement;
  readonly start: number;
  readonly end: number;
}

/**
 * Isolates the tags of one paragraph. Returns the anchor run of each tag. The pieces of the record
 * describe the tree before this call; the tree is changed in place.
 */
export function isolateTags(paragraph: ParagraphRecord, tags: readonly TagRecord[], dialect: TextDialect = WML_DIALECT): Map<TagRecord, RawElement> {
  const isWml = isIn(dialect);
  const anchors = new Map<TagRecord, RawElement>();
  if (tags.length === 0) return anchors;

  const replacements = new Replacements();
  // 1. Split every run of the paragraph into runs of one content child each.
  const runs = new Set<RawElement>();
  for (const piece of paragraph.pieces) if (piece.kind === 'text') runs.add(piece.run);
  for (const run of runs) {
    const elements = run.children.filter((c): c is RawElement => c.kind === 'element');
    const rPr = elements.find((c) => isWml(c, 'rPr'));
    const content = elements.filter((c) => c !== rPr);
    if (content.length <= 1) continue;
    replacements.add(
      run,
      content.map((c) => runWith(run, rPr, [c])),
    );
  }
  replacements.flush();

  // 2. Cut text runs at the edges of tags. A w:t can hold several text nodes (around a comment);
  // its pieces are grouped, so that each w:t becomes one or more runs of plain text.
  const cuts = [...new Set(tags.flatMap((tag) => [tag.start, tag.end]))].sort((a, b) => a - b);
  /** The index of the first cut greater than `value`. */
  const firstAbove = (value: number): number => {
    let lo = 0;
    let hi = cuts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cuts[mid] as number) <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const groups = new Map<RawElement, { start: number; end: number; text: string }>();
  for (const piece of paragraph.pieces) {
    if (piece.kind !== 'text') continue;
    const g = groups.get(piece.t);
    if (g === undefined) groups.set(piece.t, { start: piece.textStart, end: piece.textEnd, text: piece.node.text });
    else {
      g.end = piece.textEnd;
      g.text += piece.node.text;
    }
  }
  const textRuns: TextRun[] = [];
  for (const [t, g] of groups) {
    // After step 1 the w:t is the only content of its run; the run is its live parent.
    const run = t.parent as RawElement;
    const points: number[] = [];
    for (let i = firstAbove(g.start); i < cuts.length && (cuts[i] as number) < g.end; i++) points.push(cuts[i] as number);
    if (points.length === 0) {
      textRuns.push({ run, start: g.start, end: g.end });
      continue;
    }
    const rPr = run.children.find((c): c is RawElement => isWml(c, 'rPr'));
    const edges = [g.start, ...points, g.end];
    const parts: RawElement[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const from = edges[i] as number;
      const to = edges[i + 1] as number;
      const part = runWith(run, rPr, [textElement(t, g.text.slice(from - g.start, to - g.start), dialect)]);
      parts.push(part);
      textRuns.push({ run: part, start: from, end: to });
    }
    replacements.add(run, parts);
  }
  replacements.flush();
  textRuns.sort((a, b) => a.start - b.start);
  /** The index of the first text run that starts at or after `value`. */
  const firstRunFrom = (value: number): number => {
    let lo = 0;
    let hi = textRuns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((textRuns[mid] as TextRun).start < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // 3. Each tag now covers whole text runs: the first becomes the anchor, the others go.
  for (const tag of tags) {
    const covered: TextRun[] = [];
    for (let i = firstRunFrom(tag.start); i < textRuns.length && (textRuns[i] as TextRun).end <= tag.end; i++) covered.push(textRuns[i] as TextRun);
    const first = covered[0];
    if (first === undefined) continue;
    const t = first.run.children.find((c): c is RawElement => isWml(c, 't'));
    if (t !== undefined) {
      const fresh = textElement(t, tag.info.raw, dialect);
      fresh.parent = first.run;
      first.run.children[first.run.children.indexOf(t)] = fresh;
    }
    for (const other of covered.slice(1)) {
      const parent = other.run.parent;
      if (parent !== null) parent.children.splice(parent.children.indexOf(other.run), 1);
    }
    anchors.set(tag, first.run);
  }
  return anchors;
}
