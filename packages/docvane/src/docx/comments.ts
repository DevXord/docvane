// Comments of removed content (D-073). A section shown no time removes its paragraphs and their
// comment references, but the text of those comments stays in comments.xml, where Word does not
// show it and a reader of the file still finds it. Comments that no story refers to any more are
// left out, with their entries in commentsExtended, commentsIds and commentsExtensible (keyed by
// the w14:paraId of the comment's paragraphs, or by its w16cid durable id).
import type { ReadLimits } from '../limits';
import type { OpcPackage } from '../opc/package';
import { partKey } from '../opc/part-name';
import { normalizeLineEnds } from '../xml/parser';
import { parseRawTree, serialize, type RawElement } from '../xml/raw-tree';

const COMMENTS = /\/comments$/;
const COMMENT_PARTS = /\/(?:commentsExtended|commentsIds|commentsExtensible)$/;

/** An attribute by local name, whatever its namespace. */
function attr(e: RawElement, local: string): string | undefined {
  for (const [key, value] of e.attrs) if (key === local || key.endsWith(`}${local}`)) return value;
  return undefined;
}

function* elements(e: RawElement): Generator<RawElement> {
  for (const c of e.children) {
    if (c.kind !== 'element') continue;
    yield c;
    yield* elements(c);
  }
}

/** `xml` without the children of its root for which `drop` holds; null when there are none. */
function without(xml: string, part: string, limits: ReadLimits, drop: (e: RawElement) => boolean): string | null {
  const doc = parseRawTree(xml, { part, limits });
  const kept = doc.root.children.filter((c) => c.kind !== 'element' || !drop(c));
  if (kept.length === doc.root.children.length) return null;
  doc.root.children = kept;
  // An unchanged tree serialises to its source, so only the dropped elements go.
  return serialize(doc);
}

/**
 * The comments parts of a document without the comments that no story refers to. `stories` gives
 * the final XML of the parts that hold comment references, by partKey; it is called only when the
 * document has comments.
 */
export function pruneComments(pkg: OpcPackage, main: string, stories: () => ReadonlyMap<string, string>, limits: ReadLimits): Map<string, { name: string; xml: string }> {
  const out = new Map<string, { name: string; xml: string }>();
  const rels = pkg.relationships(main);
  const comments = rels.find((r) => !r.external && COMMENTS.test(r.type) && pkg.hasPart(r.target));
  if (comments === undefined) return out;
  const referenced = new Set<string>();
  for (const [key, xml] of stories()) {
    if (!xml.includes('commentReference')) continue;
    for (const e of elements(parseRawTree(normalizeLineEnds(xml), { part: key, limits }).root)) {
      if (e.local === 'commentReference') {
        const id = attr(e, 'id');
        if (id !== undefined) referenced.add(id);
      }
    }
  }
  const xml = normalizeLineEnds(pkg.readXml(comments.target) ?? '');
  const doc = parseRawTree(xml, { part: comments.target, limits });
  const paraIds = new Set<string>();
  const durable = new Set<string>();
  let dropped = false;
  for (const c of doc.root.children) {
    if (c.kind !== 'element' || c.local !== 'comment' || referenced.has(attr(c, 'id') ?? '')) continue;
    dropped = true;
    for (const e of elements(c)) {
      const paraId = e.local === 'p' ? attr(e, 'paraId') : undefined;
      if (paraId !== undefined) paraIds.add(paraId);
    }
    const id = attr(c, 'durableId');
    if (id !== undefined) durable.add(id);
  }
  if (!dropped) return out;
  const pruned = without(xml, comments.target, limits, (e) => e.local === 'comment' && !referenced.has(attr(e, 'id') ?? ''));
  if (pruned !== null) out.set(partKey(comments.target), { name: comments.target, xml: pruned });
  // The parts that extend comments refer to them by the paraId of their last paragraph; the
  // durable ids of commentsIds lead on to commentsExtensible.
  const extensions = rels.filter((r) => !r.external && COMMENT_PARTS.test(r.type) && pkg.hasPart(r.target));
  for (const rel of extensions.filter((r) => !r.type.endsWith('/commentsExtensible'))) {
    const text = normalizeLineEnds(pkg.readXml(rel.target) ?? '');
    const tree = parseRawTree(text, { part: rel.target, limits });
    for (const e of tree.root.children) {
      const id = e.kind === 'element' && paraIds.has(attr(e, 'paraId') ?? '') ? attr(e, 'durableId') : undefined;
      if (id !== undefined) durable.add(id);
    }
    const kept = without(text, rel.target, limits, (e) => paraIds.has(attr(e, 'paraId') ?? ''));
    if (kept !== null) out.set(partKey(rel.target), { name: rel.target, xml: kept });
  }
  for (const rel of extensions.filter((r) => r.type.endsWith('/commentsExtensible'))) {
    const text = normalizeLineEnds(pkg.readXml(rel.target) ?? '');
    const kept = without(text, rel.target, limits, (e) => durable.has(attr(e, 'durableId') ?? ''));
    if (kept !== null) out.set(partKey(rel.target), { name: rel.target, xml: kept });
  }
  return out;
}
