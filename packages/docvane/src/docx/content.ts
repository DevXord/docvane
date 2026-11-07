// WordprocessingML written by the renderer: runs with text, hyperlinks, inline pictures and
// paragraphs. The shapes follow what LibreOffice 24.2 writes (F-015) and are checked by opening the
// results in LibreOffice (npm run test:libreoffice). Every text and attribute value is escaped.
import type { RawElement, RawNode, RawText } from '../xml/raw-tree';
import { serializeInto } from '../xml/raw-tree';
import { escapeAttr, escapeText } from '../xml/writer';
import { WML_NAMESPACES } from './paragraphs';
import { TRANSITIONAL, type Vocabulary } from '../opc/conformance';


/** A node that is written as it is: for content made by the renderer. */
export function rawXml(xml: string): RawText {
  return { kind: 'text', raw: xml, text: '', parent: null, start: -1 };
}

function serialize(node: RawNode): string {
  const out: string[] = [];
  serializeInto(node, out);
  return out.join('');
}

const isWml = (n: RawNode, local: string): n is RawElement => n.kind === 'element' && WML_NAMESPACES.has(n.ns) && n.local === local;

/** Run formatting to add on top of the formatting of the tag. */
export interface RunStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** The styleId of a character style, which replaces any style of the tag. */
  readonly rStyle?: string;
}

/**
 * The w:rPr for a run: the properties of the tag's run (`base`) with `style` applied. w:rStyle comes
 * first, w:b and w:i after w:rStyle and w:rFonts, as LibreOffice writes them.
 */
export function runProperties(p: string, base: RawElement | undefined, style: RunStyle = {}): string {
  const children = (base?.children ?? []).filter((c): c is RawElement => c.kind === 'element');
  const drop = (c: RawElement): boolean =>
    (style.rStyle !== undefined && isWml(c, 'rStyle')) || (style.bold === true && (isWml(c, 'b') || isWml(c, 'bCs'))) || (style.italic === true && (isWml(c, 'i') || isWml(c, 'iCs')));
  const kept = children.filter((c) => !drop(c));
  const head: string[] = [];
  const rest: string[] = [];
  for (const c of kept) (isWml(c, 'rStyle') || isWml(c, 'rFonts') ? head : rest).push(serialize(c));
  const added = [...(style.bold === true ? [`<${p}b/><${p}bCs/>`] : []), ...(style.italic === true ? [`<${p}i/><${p}iCs/>`] : [])];
  const rStyle = style.rStyle === undefined ? [] : [`<${p}rStyle ${p}val="${escapeAttr(style.rStyle)}"/>`];
  const inner = [...rStyle, ...head, ...added, ...rest].join('');
  return inner === '' ? '' : `<${p}rPr>${inner}</${p}rPr>`;
}

/** The w:t, w:tab and w:br elements for a text: tabs and line breaks become elements. */
export function textContent(p: string, text: string): string {
  const out: string[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      if (i > 0) out.push(`<${p}br/>`);
      line.split('\t').forEach((piece, j) => {
        if (j > 0) out.push(`<${p}tab/>`);
        if (piece !== '') out.push(`<${p}t${/^\s|\s$|\s\s/.test(piece) ? ' xml:space="preserve"' : ''}>${escapeText(piece)}</${p}t>`);
      });
    });
  return out.join('');
}

/** A run with the start tag of `model` (the tag's run), properties and text. */
export function runXml(model: RawElement, rPr: string, text: string, breakBefore = false): string {
  const p = model.qname.includes(':') ? model.qname.slice(0, model.qname.indexOf(':') + 1) : '';
  const open = model.open.endsWith('/>') ? `<${model.qname}>` : model.open;
  const close = model.close === '' ? `</${model.qname}>` : model.close;
  return `${open}${rPr}${breakBefore ? `<${p}br/>` : ''}${textContent(p, text)}${close}`;
}

/** A hyperlink around runs, to an external relationship. */
export function hyperlinkXml(p: string, rId: string, runs: string, names: Vocabulary = TRANSITIONAL): string {
  return `<${p}hyperlink xmlns:r="${names.r}" r:id="${escapeAttr(rId)}">${runs}</${p}hyperlink>`;
}

/** A run with an inline picture of cx × cy EMU, as LibreOffice writes one (F-015). */
export function pictureRunXml(model: RawElement, rPr: string, picture: { rId: string; cx: number; cy: number; id: number; name: string; alt: string }, names: Vocabulary = TRANSITIONAL): string {
  const p = model.qname.includes(':') ? model.qname.slice(0, model.qname.indexOf(':') + 1) : '';
  const open = model.open.endsWith('/>') ? `<${model.qname}>` : model.open;
  const close = model.close === '' ? `</${model.qname}>` : model.close;
  const { rId, cx, cy, id } = picture;
  const name = escapeAttr(picture.name);
  const alt = escapeAttr(picture.alt);
  return (
    `${open}${rPr}<${p}drawing><wp:inline xmlns:wp="${names.wp}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${String(cx)}" cy="${String(cy)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${String(id)}" name="${name}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${names.a}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${names.a}"><a:graphicData uri="${names.pic}"><pic:pic xmlns:pic="${names.pic}"><pic:nvPicPr><pic:cNvPr id="${String(id)}" name="${name}" descr="${alt}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="${names.r}" r:embed="${escapeAttr(rId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(cx)}" cy="${String(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></${p}drawing>${close}`
  );
}

/**
 * The w:pPr of a paragraph made from `template`: its properties, with the paragraph style replaced
 * by `styleId` (and direct numbering removed, which would override the style's own) when given.
 */
export function paragraphProperties(p: string, template: RawElement, styleId: string | undefined): string {
  const pPr = template.children.find((c): c is RawElement => isWml(c, 'pPr'));
  if (styleId === undefined) return pPr === undefined ? '' : serialize(pPr);
  const kept = (pPr?.children ?? []).filter((c) => !(isWml(c, 'pStyle') || isWml(c, 'numPr'))).map(serialize);
  const open = pPr === undefined || pPr.open.endsWith('/>') ? `<${p}pPr>` : pPr.open;
  const close = pPr === undefined || pPr.close === '' ? `</${p}pPr>` : pPr.close;
  return `${open}<${p}pStyle ${p}val="${escapeAttr(styleId)}"/>${kept.join('')}${close}`;
}

/** A paragraph with the start tag of `template`, properties and content. */
export function paragraphXml(template: RawElement, pPr: string, content: string): string {
  const open = template.open.endsWith('/>') ? `<${template.qname}>` : template.open;
  const close = template.close === '' ? `</${template.qname}>` : template.close;
  return `${open}${pPr}${content}${close}`;
}

/** The w:rPr child of a run, if any. */
export function runPropertiesOf(run: RawElement): RawElement | undefined {
  return run.children.find((c): c is RawElement => isWml(c, 'rPr'));
}
