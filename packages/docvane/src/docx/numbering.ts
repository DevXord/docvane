// New numbering instances for Markdown lists (D-073). Paragraphs in the "List Number" style share
// the numbering of that style (w:num, ECMA-376 Part 1 §17.9), so every list would continue the
// count of the one before it. Each numbered Markdown list gets a w:num of its own, on the same
// abstract numbering, with its first number as the start (w:lvlOverride/w:startOverride). The new
// w:num elements are added to numbering.xml at the end of the existing ones.
import type { ReadLimits } from '../limits';
import type { OpcPackage } from '../opc/package';
import { normalizeLineEnds } from '../xml/parser';
import { parseRawTree, type RawElement } from '../xml/raw-tree';
import { escapeAttr } from '../xml/writer';

const NUMBERING = /\/numbering$/;

/** The numbering part of a document and the instances a render adds to it. */
export class Numbering {
  private readonly part: string | undefined;
  private readonly xml: string;
  private readonly abstractOf = new Map<string, string>();
  private readonly added: string[] = [];
  private next = 1;
  /** Where the new instances go: before w:numIdMacAtCleanup, or before the end tag. */
  private readonly at: number = -1;
  private readonly prefix: string = 'w:';

  constructor(pkg: OpcPackage, main: string, limits: ReadLimits) {
    const rel = pkg.relationships(main).find((r) => !r.external && NUMBERING.test(r.type));
    this.part = rel !== undefined && pkg.hasPart(rel.target) ? rel.target : undefined;
    this.xml = this.part === undefined ? '' : normalizeLineEnds(pkg.readXml(this.part) ?? '');
    if (this.part === undefined || this.xml === '') return;
    const doc = parseRawTree(this.xml, { part: this.part, limits });
    const root = doc.root;
    this.prefix = root.qname.includes(':') ? root.qname.slice(0, root.qname.indexOf(':') + 1) : '';
    let cleanup: RawElement | undefined;
    for (const c of root.children) {
      if (c.kind !== 'element') continue;
      if (c.local === 'num') {
        const id = attr(c, 'numId');
        const abstract = c.children.find((x): x is RawElement => x.kind === 'element' && x.local === 'abstractNumId');
        const abstractId = abstract === undefined ? undefined : attr(abstract, 'val');
        if (id !== undefined && abstractId !== undefined) this.abstractOf.set(id, abstractId);
        if (id !== undefined && Number(id) >= this.next) this.next = Number(id) + 1;
      }
      if (c.local === 'numIdMacAtCleanup') cleanup = c;
    }
    this.at = cleanup !== undefined ? cleanup.start : root.close === '' ? -1 : this.xml.lastIndexOf(root.close);
  }

  /** A new numbering instance like `numId`, starting at `start`; undefined when there is no such numbering. */
  restart(numId: string, start: number): string | undefined {
    const abstract = this.abstractOf.get(numId);
    if (abstract === undefined || this.at < 0) return undefined;
    const id = String(this.next++);
    const p = this.prefix;
    this.added.push(`<${p}num ${p}numId="${id}"><${p}abstractNumId ${p}val="${escapeAttr(abstract)}"/><${p}lvlOverride ${p}ilvl="0"><${p}startOverride ${p}val="${String(Math.max(0, Math.floor(start)))}"/></${p}lvlOverride></${p}num>`);
    return id;
  }

  /** The numbering part with the new instances, or null when none were added. */
  changed(): { readonly name: string; readonly xml: string } | null {
    if (this.part === undefined || this.added.length === 0) return null;
    return { name: this.part, xml: this.xml.slice(0, this.at) + this.added.join('') + this.xml.slice(this.at) };
  }
}

/** An attribute in the WordprocessingML namespace (w:val, w:numId). */
function attr(e: RawElement, local: string): string | undefined {
  for (const [key, value] of e.attrs) if (key === local || key.endsWith(`}${local}`)) return value;
  return undefined;
}
