// Rendering of slides and notes: the story renderer of documents with DrawingML text (a:p, a:r,
// a:rPr, a:t), pictures that take the place of shapes, links as a:hlinkClick, and Markdown as
// paragraphs with indentation levels. The shapes follow LibreOffice 24.2 (F-018), to be checked
// in PowerPoint (D-036 … D-039).
import { TvError } from '../errors';
import type { LinkValue } from '../expr/formatters';
import type { Block, Inline } from '../markdown/parse';
import { parseMarkdown } from '../markdown/parse';
import { imageInfo } from '../media/image-info';
import { limitError } from '../limits';
import type { TagRecord } from '../template/analyze';
import { clip } from '../util/clip';
import type { RawElement, RawNode } from '../xml/raw-tree';
import { prefixOf, serializeInto } from '../xml/raw-tree';
import { escapeAttr, escapeText } from '../xml/writer';
import { rawXml } from '../docx/content';
import { isolateTags, type TextDialect } from '../docx/normalize';
import type { ParagraphRecord } from '../docx/paragraphs';
import { StoryRenderer } from '../docx/render';
import { checkLinkUrl } from '../docx/urls';
import { DML_NAMESPACES, isDml, isPml, shapeOf, shapeText } from './paragraphs';

const DML_DIALECT: TextDialect = { namespaces: DML_NAMESPACES, preserveSpace: false };
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

function serialize(node: RawNode): string {
  const out: string[] = [];
  serializeInto(node, out);
  return out.join('');
}

const child = (e: RawElement | undefined, test: (c: RawElement) => boolean): RawElement | undefined => e?.children.find((c): c is RawElement => c.kind === 'element' && test(c));

/** The position and size of a shape (x, y, cx, cy in EMU), or null when it has none of its own. */
function frameOf(shape: RawElement): [number, number, number, number] | null {
  const spPr = child(shape, (c) => isPml(c, 'spPr'));
  const xfrm = child(spPr, (c) => isDml(c, 'xfrm'));
  const off = child(xfrm, (c) => isDml(c, 'off'));
  const ext = child(xfrm, (c) => isDml(c, 'ext'));
  const num = (e: RawElement | undefined, name: string): number => Number(e?.attrs.get(name));
  const frame: [number, number, number, number] = [num(off, 'x'), num(off, 'y'), num(ext, 'cx'), num(ext, 'cy')];
  return frame.every(Number.isFinite) && frame[2] > 0 && frame[3] > 0 ? frame : null;
}

/** a:rPr of a run with attributes set (b, i) and an element added before the extension list (a:hlinkClick). */
function runProps(p: string, base: RawElement | undefined, attrs: Readonly<Record<string, string>>, extra = ''): string {
  let open = base === undefined ? `<${p}rPr>` : base.open.endsWith('/>') ? base.open.replace(/\s*\/>$/, '>') : base.open;
  for (const [name, value] of Object.entries(attrs)) {
    // Either quote: a template may write b='0' (D-071).
    open = open.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '');
    open = open.replace(/>$/, ` ${name}="${value}">`);
  }
  const kids = (base?.children ?? []).filter((c): c is RawElement => c.kind === 'element');
  // a:hlinkClick comes before a:hlinkMouseOver, a:rtl and a:extLst (as LibreOffice writes it last otherwise).
  const tail = kids.findIndex((c) => isDml(c, 'hlinkMouseOver') || isDml(c, 'rtl') || isDml(c, 'extLst'));
  const before = (tail === -1 ? kids : kids.slice(0, tail)).filter((c) => !(extra !== '' && isDml(c, 'hlinkClick'))).map(serialize);
  const after = tail === -1 ? [] : kids.slice(tail).map(serialize);
  return `${open}${before.join('')}${extra}${after.join('')}</${p}rPr>`;
}

/** A DrawingML run with properties and text. */
function run(model: RawElement, rPr: string, text: string): string {
  const p = prefixOf(model.qname);
  const open = model.open.endsWith('/>') ? `<${model.qname}>` : model.open;
  return `${open}${rPr}<${p}t>${escapeText(text)}</${p}t></${model.qname}>`;
}

/** A line break between runs, with the run properties of the run before it. */
function lineBreak(p: string, rPr: string): string {
  return `<${p}br>${rPr}</${p}br>`;
}

/** Story renderer for slides and notes. */
export class SlideRenderer extends StoryRenderer {
  protected override isText(e: RawElement, local?: string): boolean {
    return isDml(e, local);
  }

  protected override dropInCopy(e: RawElement): boolean {
    // p14:creationId identifies a slide; a copy must not carry the original's.
    return e.ns === P14 && e.local === 'creationId';
  }

  protected override isolate(paragraph: ParagraphRecord, tags: readonly TagRecord[]): Map<TagRecord, RawElement> {
    return isolateTags(paragraph, tags, DML_DIALECT);
  }

  override prepare(): TvError[] {
    const problems = super.prepare();
    // An image takes the place of the shape whose whole text is its tag (D-037).
    for (const [anchor, tag] of [...this.imageAnchors]) {
      this.imageAnchors.delete(anchor);
      const shape = shapeOf(tag.paragraph.element);
      if (shape === undefined || shapeText(shape, this.story.paragraphs).trim() !== tag.info.raw) {
        problems.push(
          new TvError('TV_E_TAG_PLACEMENT', `The image tag "${clip(tag.info.raw)}" shares its shape with other text.`, {
            location: tag.info.location,
            hint: 'On a slide, an image takes the place of a shape: put the image tag alone in a shape of the size the image should have.',
            details: { tag: clip(tag.info.raw) },
          }),
        );
        continue;
      }
      // The picture takes the position and size of the shape; a shape that inherits them from its
      // layout has none, which is a problem of the template, whatever the data (D-071).
      if (frameOf(shape) === null) {
        problems.push(
          new TvError('TV_E_TAG_PLACEMENT', `The shape of the image tag "${clip(tag.info.raw)}" has no position and size of its own.`, {
            location: tag.info.location,
            hint: 'Use a text box, or move or resize the placeholder once, so that the shape has its own position and size.',
            details: { tag: clip(tag.info.raw) },
          }),
        );
        continue;
      }
      this.imageAnchors.set(shape, tag);
    }
    return problems;
  }

  protected override valueRuns(anchor: RawElement, text: string): RawNode[] {
    if (text === '') return [];
    const p = prefixOf(anchor.qname);
    const rPr = child(anchor, (c) => isDml(c, 'rPr'));
    const props = rPr === undefined ? '' : serialize(rPr);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    return [rawXml(lines.map((line) => (line === '' ? '' : run(anchor, props, line))).join(lineBreak(p, props)))];
  }

  protected override linkNodes(anchor: RawElement, link: LinkValue, _tag: TagRecord, style: { bold?: boolean; italic?: boolean } = {}): RawNode[] {
    const p = prefixOf(anchor.qname);
    const rId = this.ctx.resources.relationship(this.targetPart, this.ctx.resources.vocabulary.hyperlinkRel, link.url, true);
    const attrs: Record<string, string> = {};
    if (style.bold === true) attrs['b'] = '1';
    if (style.italic === true) attrs['i'] = '1';
    const rPr = runProps(p, child(anchor, (c) => isDml(c, 'rPr')), attrs, `<${p}hlinkClick xmlns:r="${this.ctx.resources.vocabulary.r}" r:id="${escapeAttr(rId)}"/>`);
    return [rawXml(run(anchor, rPr, link.text))];
  }

  /** A picture in the frame of the shape, keeping the image's proportions, centred (D-037). */
  protected override imageNodes(shape: RawElement, tag: TagRecord, scopes: readonly unknown[]): RawNode[] {
    const { ok, value } = this.evaluate(tag, scopes);
    if (!ok) return [];
    if (value === undefined || value === null) {
      if (value === undefined) this.missing(tag, tag.info.path, scopes);
      return [];
    }
    const image = this.imageValue(tag, value);
    if (image === null) return [];
    const info = imageInfo(image.bytes);
    if (typeof info === 'string') {
      this.invalid(tag, `${info} (in "${clip(tag.info.raw)}")`, 'Pass a PNG, JPEG or GIF image.');
      return [];
    }
    if (info.width * info.height > this.ctx.limits.maxImagePixels) {
      throw limitError('maxImagePixels', this.ctx.limits.maxImagePixels, `An image has ${String(info.width)} × ${String(info.height)} pixels, more than the limit.`, tag.info.location);
    }
    const [x, y, w, h] = frameOf(shape) as [number, number, number, number];
    const ratio = info.height / info.dpiY / (info.width / info.dpiX);
    let cx = w;
    let cy = Math.round(w * ratio);
    if (cy > h) {
      cy = h;
      cx = Math.round(h / ratio);
    }
    const ox = Math.round(x + (w - cx) / 2);
    const oy = Math.round(y + (h - cy) / 2);
    const media = this.ctx.resources.image(image.bytes, info);
    const rId = this.ctx.resources.imageRelationship(this.targetPart, media);
    const nv = child(shape, (c) => isPml(c, 'nvSpPr'));
    const cNvPr = child(nv, (c) => isPml(c, 'cNvPr'));
    const id = cNvPr?.attrs.get('id') ?? '1';
    const name = cNvPr?.attrs.get('name') ?? 'Image';
    const p = prefixOf(shape.qname);
    return [
      rawXml(
        `<${p}pic><${p}nvPicPr><${p}cNvPr id="${escapeAttr(id)}" name="${escapeAttr(name)}" descr="${escapeAttr(image.alt)}"/><${p}cNvPicPr><a:picLocks xmlns:a="${this.ctx.resources.vocabulary.a}" noChangeAspect="1"/></${p}cNvPicPr><${p}nvPr/></${p}nvPicPr>` +
          `<${p}blipFill><a:blip xmlns:a="${this.ctx.resources.vocabulary.a}" xmlns:r="${this.ctx.resources.vocabulary.r}" r:embed="${escapeAttr(rId)}"/><a:stretch xmlns:a="${this.ctx.resources.vocabulary.a}"><a:fillRect/></a:stretch></${p}blipFill>` +
          `<${p}spPr><a:xfrm xmlns:a="${this.ctx.resources.vocabulary.a}"><a:off x="${String(ox)}" y="${String(oy)}"/><a:ext cx="${String(cx)}" cy="${String(cy)}"/></a:xfrm><a:prstGeom xmlns:a="${this.ctx.resources.vocabulary.a}" prst="rect"><a:avLst/></a:prstGeom></${p}spPr></${p}pic>`,
      ),
    ];
  }

  /** Inline Markdown as runs with the properties of the anchor. */
  private inlineXml(anchor: RawElement, tag: TagRecord, content: readonly Inline[]): string {
    const p = prefixOf(anchor.qname);
    const base = child(anchor, (c) => isDml(c, 'rPr'));
    const plain = base === undefined ? '' : serialize(base);
    const out: string[] = [];
    let charged = 0;
    const push = (xml: string): void => {
      this.charge(xml.length);
      charged += xml.length;
      out.push(xml);
    };
    for (const inline of content) {
      if (inline.breakBefore === true) push(lineBreak(p, plain));
      const attrs: Record<string, string> = {};
      if (inline.bold) attrs['b'] = '1';
      if (inline.italic) attrs['i'] = '1';
      if (inline.link !== undefined) {
        const problem = checkLinkUrl(inline.link);
        if (problem === null) {
          const rId = this.ctx.resources.relationship(this.targetPart, this.ctx.resources.vocabulary.hyperlinkRel, inline.link, true);
          push(run(anchor, runProps(p, base, attrs, `<${p}hlinkClick xmlns:r="${this.ctx.resources.vocabulary.r}" r:id="${escapeAttr(rId)}"/>`), inline.text));
          continue;
        }
        // As in documents: text without a link (D-071).
      }
      push(run(anchor, Object.keys(attrs).length === 0 ? plain : runProps(p, base, attrs), inline.text));
    }
    this.ctx.output -= charged;
    return out.join('');
  }

  /** Markdown in a slide: paragraphs with indentation levels for lists, bold paragraphs for headings (D-038). */
  protected override markdownNodes(node: RawElement, tag: TagRecord, scopes: readonly unknown[], blocks: boolean): RawNode[] {
    const { ok, value } = this.evaluate(tag, scopes);
    if (!ok) return [];
    if (value === undefined) {
      this.missing(tag, tag.info.path, scopes);
      return [];
    }
    if (value === null || value === '') return [];
    if (typeof value !== 'string') {
      this.invalid(tag, `The value of "${clip(tag.info.raw)}" must be Markdown text.`, 'Pass the Markdown as a string.');
      return [];
    }
    if (value.length > this.ctx.limits.maxMarkdownLength) {
      throw limitError('maxMarkdownLength', this.ctx.limits.maxMarkdownLength, `A Markdown value is longer than ${String(this.ctx.limits.maxMarkdownLength)} characters.`, tag.info.location);
    }
    if (this.checkText(tag, value) === null) return [];
    const parsed = parseMarkdown(value);
    const anchor = this.anchors.get(tag) as RawElement;
    if (!blocks) {
      if (parsed.length > 1 || (parsed[0] !== undefined && parsed[0].kind !== 'paragraph')) {
        this.invalid(tag, `The Markdown of "${clip(tag.info.raw)}" has headings, lists or several paragraphs, but the tag shares its paragraph with other text.`, `Put ${tag.info.raw} alone in a paragraph to get headings, lists and paragraphs.`);
        return [];
      }
      return parsed[0] === undefined ? [] : [rawXml(this.inlineXml(node, tag, parsed[0].content))];
    }
    const p = prefixOf(node.qname);
    const pPr = child(node, (c) => isDml(c, 'pPr'));
    const end = child(node, (c) => isDml(c, 'endParaRPr'));
    const open = node.open.endsWith('/>') ? `<${node.qname}>` : node.open;
    const close = node.close === '' ? `</${node.qname}>` : node.close;
    const out: string[] = [];
    let charged = 0;
    for (const block of parsed as Block[]) {
      let props = pPr === undefined ? '' : serialize(pPr);
      if (block.kind === 'item') {
        // The level selects the indentation and bullet of the shape's own list styles.
        const base = pPr === undefined ? `<${p}pPr/>` : serialize(pPr);
        props = base.replace(/\slvl\s*=\s*(?:"[^"]*"|'[^']*')/, '').replace(/^<([^\s/>]+)/, `<$1 lvl="${String(block.level)}"`);
      }
      const content = block.kind === 'heading' ? block.content.map((i) => ({ ...i, bold: true })) : block.content;
      const paragraph = `${open}${props}${this.inlineXml(anchor, tag, content)}${end === undefined ? '' : serialize(end)}${close}`;
      this.charge(paragraph.length);
      charged += paragraph.length;
      out.push(paragraph);
    }
    this.ctx.output -= charged;
    return [rawXml(out.join(''))];
  }
}
