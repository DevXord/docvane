// The styles of a template, found by name. Markdown and links use the template's own styles
// ("heading 1", "List Bullet", "Hyperlink"), never styles of tplvane (plan, phase 3). Styles are
// matched by their w:name, ignoring letter case: LibreOffice 24.2 writes "Heading 1" with the
// styleId "Heading1", and the styleId can differ between applications and languages, while the
// names of built-in styles are fixed (F-016; to be checked in Word).
import type { OpcPackage } from '../opc/package';
import type { ReadLimits } from '../limits';
import { parseXmlTree } from '../xml/tree';
import { WML_NAMESPACES } from './paragraphs';

export interface StyleRef {
  readonly id: string;
  readonly type: string;
  /** The numbering of a paragraph style (w:pPr/w:numPr/w:numId), if it has one. */
  readonly numId?: string;
}

/** Styles by lower-case name. */
export type Styles = ReadonlyMap<string, StyleRef>;

const STRICT_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships/styles';
const TRANSITIONAL_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** Reads the styles part of the main document; an empty map when there is none. */
export function readStyles(pkg: OpcPackage, main: string, limits: ReadLimits): Styles {
  const rel = pkg.relationships(main).find((r) => !r.external && (r.type === TRANSITIONAL_REL || r.type === STRICT_REL));
  const xml = rel === undefined ? undefined : pkg.readXml(rel.target);
  const out = new Map<string, StyleRef>();
  if (xml === undefined || rel === undefined) return out;
  const root = parseXmlTree(xml, { part: rel.target, limits });
  for (const style of root.children) {
    if (!WML_NAMESPACES.has(style.ns) || style.local !== 'style') continue;
    const id = style.attrs.get(`{${style.ns}}styleId`);
    const type = style.attrs.get(`{${style.ns}}type`) ?? 'paragraph';
    const nameElement = style.children.find((c) => WML_NAMESPACES.has(c.ns) && c.local === 'name');
    const name = nameElement?.attrs.get(`{${style.ns}}val`);
    if (id === undefined || name === undefined) continue;
    const key = name.toLowerCase();
    const pPr = style.children.find((c) => WML_NAMESPACES.has(c.ns) && c.local === 'pPr');
    const numPr = pPr?.children.find((c) => WML_NAMESPACES.has(c.ns) && c.local === 'numPr');
    const numId = numPr?.children.find((c) => WML_NAMESPACES.has(c.ns) && c.local === 'numId')?.attrs.get(`{${style.ns}}val`);
    if (!out.has(key)) out.set(key, numId === undefined ? { id, type } : { id, type, numId });
  }
  return out;
}

/** A style of the given type by name, or undefined. */
export function styleNamed(styles: Styles, name: string, type: 'paragraph' | 'character'): StyleRef | undefined {
  const style = styles.get(name.toLowerCase());
  return style !== undefined && style.type === type ? style : undefined;
}
