// A tree of an XML part that keeps the bytes of the source: every element holds its start and end
// tags as written, every text node its raw text (entity references, CDATA sections and comments
// included) next to the decoded text. Serialising an unchanged tree gives the source text back
// (after end-of-line normalisation), so a renderer changes only the elements it touches.
//
// Built from the events and spans of the copied XML parser (./parser), so the security
// properties of that parser apply: no DTD, no entities, iterative parsing, depth and length limits.
// This module only arranges the events into a tree; it parses nothing itself (D-023).
import { DvError } from '../errors';
import { normalizeLineEnds, parseXml, type XmlLimits } from './parser';

/** An element of a {@link RawDocument}. */
export interface RawElement {
  readonly kind: 'element';
  readonly ns: string;
  readonly local: string;
  /** The qualified name as written, for example `w:p`. */
  readonly qname: string;
  /** Attributes as the parser reports them: unprefixed by local name, namespaced in Clark notation. */
  readonly attrs: ReadonlyMap<string, string>;
  /** The start tag as written, or the whole tag for an empty-element tag. */
  open: string;
  /** The end tag as written; empty for an empty-element tag. */
  close: string;
  children: RawNode[];
  parent: RawElement | null;
  /** Offset of `<` of the start tag in the source, or -1 for an element made by a renderer. */
  readonly start: number;
}

/** Character data between two tags. */
export interface RawText {
  readonly kind: 'text';
  /** As written, with references, CDATA sections and comments. */
  raw: string;
  /** With references expanded and CDATA included, as the parser reports it. */
  text: string;
  parent: RawElement | null;
  /** Offset of the first character in the source, or -1 for a node made by a renderer. */
  readonly start: number;
}

export type RawNode = RawElement | RawText;

/** A parsed part: what comes before the root element, the root, and what comes after it. */
export interface RawDocument {
  readonly prolog: string;
  readonly root: RawElement;
  readonly epilog: string;
}

/** Parses `xml` into a byte-preserving tree. Throws the errors of `parseXml`. */
export function parseRawTree(xml: string, options: { readonly part: string; readonly limits: XmlLimits & { readonly maxXmlTreeElements?: number } }): RawDocument {
  // Every element and text node stays in memory; a small compressed part could otherwise hold
  // millions of them (D-071).
  const maxNodes = options.limits.maxXmlTreeElements ?? Number.POSITIVE_INFINITY;
  let nodes = 0;
  const count = (): void => {
    if (++nodes > maxNodes) {
      throw new DvError('DV_E_LIMIT_EXCEEDED', 'The part has more XML elements than the limit.', {
        location: { part: options.part },
        hint: `If you trust this file, raise the limit, for example { limits: { maxXmlTreeElements: ${String(maxNodes * 4)} } }.`,
        details: { limit: 'maxXmlTreeElements', value: maxNodes },
      });
    }
  };
  const source = normalizeLineEnds(xml);
  const stack: RawElement[] = [];
  let root: RawElement | undefined;
  let prolog = '';
  let lastEnd = 0;
  let pending = '';

  const flush = (until: number): void => {
    if (until > lastEnd) {
      const raw = source.slice(lastEnd, until);
      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        if (root === undefined) prolog += raw;
      } else {
        count();
        parent.children.push({ kind: 'text', raw, text: pending, parent, start: lastEnd });
      }
    }
    pending = '';
  };

  parseXml(
    source,
    {
      start(ns, local, attrs, span) {
        flush(span.start);
        count();
        const parent = stack[stack.length - 1] ?? null;
        const element: RawElement = { kind: 'element', ns, local, qname: span.qname, attrs, open: source.slice(span.start, span.end), close: '', children: [], parent, start: span.start };
        if (parent === null) root = element;
        else parent.children.push(element);
        stack.push(element);
        lastEnd = span.end;
      },
      end(_ns, _local, span) {
        flush(span.start);
        const element = stack.pop() as RawElement;
        if (!span.empty) element.close = source.slice(span.start, span.end);
        lastEnd = span.end;
      },
      text(value) {
        pending += value;
      },
    },
    options,
  );
  // parseXml rejects a document without a root element.
  return { prolog, root: root as RawElement, epilog: source.slice(lastEnd) };
}

/** Appends the serialisation of `node` to `out`. Iterative, so deep trees do not grow the stack. */
export function serializeInto(node: RawNode, out: string[]): void {
  const work: (RawNode | string)[] = [node];
  while (work.length > 0) {
    const item = work.pop() as RawNode | string;
    if (typeof item === 'string') {
      out.push(item);
    } else if (item.kind === 'text') {
      out.push(item.raw);
    } else {
      out.push(item.open);
      if (item.close !== '') work.push(item.close);
      for (let i = item.children.length - 1; i >= 0; i--) work.push(item.children[i] as RawNode);
    }
  }
}

/** The text of one node and everything inside it. */
export function rawXmlText(node: RawNode): string {
  const out: string[] = [];
  serializeInto(node, out);
  return out.join('');
}

/** The text of a whole document. */
export function serialize(doc: RawDocument): string {
  const out: string[] = [doc.prolog];
  serializeInto(doc.root, out);
  out.push(doc.epilog);
  return out.join('');
}

/** The prefix of a qualified name, with the colon (`w:` for `w:p`), or '' when there is none. */
export function prefixOf(qname: string): string {
  const colon = qname.indexOf(':');
  return colon === -1 ? '' : qname.slice(0, colon + 1);
}

/** A new element without source position. `open` and `close` are written by the caller. */
export function makeElement(model: { readonly ns: string; readonly local: string; readonly qname: string }, open: string, close: string, attrs: ReadonlyMap<string, string> = new Map()): RawElement {
  return { kind: 'element', ns: model.ns, local: model.local, qname: model.qname, attrs, open, close, children: [], parent: null, start: -1 };
}

/** A deep copy of `node` with `parent` set; source positions are kept, so copies still sort by place. */
export function cloneNode(node: RawNode, parent: RawElement | null): RawNode {
  if (node.kind === 'text') return { ...node, parent };
  const copy: RawElement = { ...node, children: [], parent };
  copy.children = node.children.map((child) => cloneNode(child, copy));
  return copy;
}
