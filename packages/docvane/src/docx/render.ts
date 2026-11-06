// Renders the stories of a DOCX template with data. The template tree is not changed while
// rendering: each story is rendered into a new tree that shares the unchanged subtrees of the
// template, so loops never copy the template's bookkeeping, and the output is counted against
// `maxOutputBytes` as it is built (D-026, D-027).
import { DvError, type DvWarning } from '../errors';
import type { Expr } from '../expr/ast';
import { evaluate, firstMissing, MissingField, ownValue, truthy } from '../expr/evaluate';
import { LinkValue, ValueError, type Formatting } from '../expr/formatters';
import { imageInfo } from '../media/image-info';
import { parseMarkdown, type Block, type Inline } from '../markdown/parse';
import { limitError, type Limits } from '../limits';
import type { StoryAnalysis, TagRecord } from '../template/analyze';
import type { SectionTree, TreeChild } from '../template/structure';
import { clip } from '../util/clip';
import { suggest } from '../util/suggest';
import { firstInvalidXmlChar } from '../xml/writer';
import { makeElement, prefixOf, serializeInto, type RawDocument, type RawElement, type RawNode } from '../xml/raw-tree';
import { hyperlinkXml, paragraphProperties, paragraphXml, pictureRunXml, rawXml, runProperties, runPropertiesOf, runXml, type RunStyle } from './content';
import { isolateTags, textElement } from './normalize';
import { HYPERLINK_REL, type Resources } from './resources';
import { styleNamed, type Styles } from './styles';
import { checkLinkUrl } from './urls';
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
  readonly resources: Resources;
  readonly styles: Styles;
  /** Width of the text column of the document, in EMU. */
  readonly textWidth: number;
  /** Images fetched by renderAsync, by URL. */
  readonly fetched: ReadonlyMap<string, Uint8Array>;
  /** When set, URLs of images that were not fetched yet are collected here instead of reported. */
  readonly collect: Set<string> | undefined;
  readonly warnings: DvWarning[];
}

const EMU_PER_INCH = 914400;
const EMU_PER_CM = 360000;
const EMU_PER_TWIP = 635;
const MAX_IMAGE_CM = 1000;

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
  private readonly imageAnchors = new Map<RawElement, TagRecord>();
  /** Markdown tags that share their paragraph with other content: rendered inline. */
  private readonly markdownAnchors = new Map<RawElement, TagRecord>();
  /** Paragraphs that hold only a Markdown tag: replaced by the paragraphs of the Markdown. */
  private readonly markdownParagraphs = new Map<RawElement, TagRecord>();
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
      else if (tag.info.kind === 'image') this.imageAnchors.set(anchor, tag);
      else if (tag.info.kind === 'markdown') {
        if (tag.paragraph.text.trim() === tag.info.raw) this.markdownParagraphs.set(tag.paragraph.element, tag);
        else this.markdownAnchors.set(anchor, tag);
      }
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

  /** The text of a value tag (or a link from the link formatter), or null when it has a problem. */
  private valueText(tag: TagRecord, scopes: readonly unknown[]): string | LinkValue | null {
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
  private checkText(tag: TagRecord, text: string): string | null {
    const bad = firstInvalidXmlChar(text);
    if (bad === -1) return text;
    this.invalid(
      tag,
      `The value of "${clip(tag.info.raw)}" contains the character U+${(text.codePointAt(bad) ?? 0).toString(16).toUpperCase().padStart(4, '0')} at position ${String(bad + 1)}, which a document cannot hold.`,
      'Remove control characters (other than tab and line breaks) and unpaired surrogates from the data.',
    );
    return null;
  }

  private warn(code: 'DV_W_STYLE_MISSING', message: string, hint: string, tag: TagRecord): void {
    if (this.ctx.warnings.some((w) => w.code === code && w.message === message)) return;
    this.ctx.warnings.push({ code, message, location: tag.info.location, hint });
  }

  /** A style of the template by name, with a warning when the template has none. */
  private style(name: string, type: 'paragraph' | 'character', tag: TagRecord): string | undefined {
    const style = styleNamed(this.ctx.styles, name, type);
    if (style === undefined) {
      this.warn('DV_W_STYLE_MISSING', `The template has no ${type} style "${name}", so ${type === 'paragraph' ? 'these paragraphs keep the style of the tag’s paragraph' : 'this text keeps the formatting of the tag'}.`, `Add a ${type} style named "${name}" to the template (for example by using it once in Word or LibreOffice) to control how it looks.`, tag);
    }
    return style?.id;
  }

  /** A hyperlink run in place of the anchor. */
  private linkNodes(anchor: RawElement, link: LinkValue, tag: TagRecord, style: RunStyle = {}): RawNode[] {
    const p = prefixOf(anchor.qname);
    const rStyle = this.style('Hyperlink', 'character', tag);
    const run = runXml(anchor, runProperties(p, runPropertiesOf(anchor), rStyle === undefined ? style : { ...style, rStyle }), link.text);
    if (anchor.parent !== null && ancestors(anchor).some((a) => isWml(a, 'hyperlink'))) return [rawXml(run)];
    const rId = this.ctx.resources.relationship(this.story.part, HYPERLINK_REL, link.url, true);
    return [rawXml(hyperlinkXml(p, rId, run))];
  }

  /** The bytes, size and description of the value of an image tag, or null with a problem recorded. */
  private imageValue(tag: TagRecord, value: unknown): { bytes: Uint8Array; width?: number; height?: number; alt: string } | null {
    const bad = (message: string, hint: string): null => {
      this.invalid(tag, `${message} (in "${clip(tag.info.raw)}")`, hint);
      return null;
    };
    let source = value;
    let width: number | undefined;
    let height: number | undefined;
    let alt = '';
    if (source !== null && typeof source === 'object' && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) {
      source = ownValue(value, 'data');
      const w = ownValue(value, 'width');
      const h = ownValue(value, 'height');
      const a = ownValue(value, 'alt');
      for (const [name, x] of [['width', w], ['height', h]] as const) {
        if (x !== undefined && !(typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= MAX_IMAGE_CM)) return bad(`The ${name} of an image must be a number of centimetres from 0 to ${String(MAX_IMAGE_CM)}.`, `Pass for example { data, ${name}: 5 }.`);
      }
      if (a !== undefined && typeof a !== 'string') return bad('The alt text of an image must be text.', 'Pass for example { data, alt: "Company logo" }.');
      width = w as number | undefined;
      height = h as number | undefined;
      alt = (a as string | undefined) ?? '';
      if (firstInvalidXmlChar(alt) !== -1) return bad('The alt text of the image contains a character that a document cannot hold.', 'Remove control characters from the alt text.');
    }
    let bytes: Uint8Array;
    if (source instanceof Uint8Array) bytes = source;
    else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
    else if (typeof source === 'string') {
      const lower = source.slice(0, 16).toLowerCase();
      if (lower.startsWith('data:')) {
        const m = /^data:image\/(?:png|jpeg|jpg|gif);base64,/i.exec(source.slice(0, 40));
        if (m === null) return bad('The data URL of the image is not a base64 PNG, JPEG or GIF.', 'Pass for example "data:image/png;base64,iVBORw0…".');
        const b64 = source.slice(m[0].length).replace(/\s+/g, '');
        if ((b64.length * 3) / 4 > this.ctx.limits.maxImageBytes) {
          throw limitError('maxImageBytes', this.ctx.limits.maxImageBytes, `An image is larger than ${String(this.ctx.limits.maxImageBytes)} bytes.`, tag.info.location);
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return bad('The data URL of the image is not valid base64.', 'Encode the image bytes with base64.');
        const binary = atob(b64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
        const fetched = this.ctx.fetched.get(source);
        if (fetched === undefined) {
          if (this.ctx.collect !== undefined) {
            this.ctx.collect.add(source);
            return null;
          }
          return bad(`The image "${clip(source)}" is an address, and docvane does not download anything by itself.`, 'Pass the bytes or a data URL, or use renderAsync with a fetchImage function that you control.');
        }
        bytes = fetched;
      } else {
        return bad('The value of an image tag is text, but not a data URL or an http(s) address.', 'Pass the bytes (Uint8Array), a data URL, or { data, width, height, alt }.');
      }
    } else {
      return bad('The value of an image tag must be the bytes, a data URL, an address or { data, width, height, alt }.', 'Pass for example the bytes of a PNG file as a Uint8Array.');
    }
    if (bytes.length > this.ctx.limits.maxImageBytes) {
      throw limitError('maxImageBytes', this.ctx.limits.maxImageBytes, `An image is larger than ${String(this.ctx.limits.maxImageBytes)} bytes.`, tag.info.location);
    }
    return { bytes, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }), alt };
  }

  /** Width available to an image at the anchor: its table cell, else the text column, in EMU. */
  private availableWidth(anchor: RawElement): number {
    for (let e: RawElement | null = anchor.parent; e !== null; e = e.parent) {
      if (!isWml(e, 'tc')) continue;
      const tcPr = e.children.find((c): c is RawElement => c.kind === 'element' && isWml(c, 'tcPr'));
      const tcW = tcPr?.children.find((c): c is RawElement => c.kind === 'element' && isWml(c, 'tcW'));
      const w = Number(tcW?.attrs.get(`{${tcW.ns}}w`));
      const type = tcW?.attrs.get(`{${tcW.ns}}type`) ?? 'dxa';
      if (type === 'dxa' && Number.isFinite(w) && w > 0) return Math.min(w * EMU_PER_TWIP, this.ctx.textWidth);
      break;
    }
    return this.ctx.textWidth;
  }

  /** An inline picture in place of the anchor. */
  private imageNodes(anchor: RawElement, tag: TagRecord, scopes: readonly unknown[]): RawNode[] {
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
    const ratio = info.height / info.dpiY / (info.width / info.dpiX);
    let cx: number;
    let cy: number;
    if (image.width !== undefined || image.height !== undefined) {
      cx = image.width !== undefined ? image.width * EMU_PER_CM : (image.height as number) * EMU_PER_CM / ratio;
      cy = image.height !== undefined ? image.height * EMU_PER_CM : cx * ratio;
    } else {
      cx = (info.width / info.dpiX) * EMU_PER_INCH;
      cy = (info.height / info.dpiY) * EMU_PER_INCH;
      const max = this.availableWidth(anchor);
      if (cx > max) {
        cy = cy * (max / cx);
        cx = max;
      }
    }
    const media = this.ctx.resources.image(image.bytes, info);
    const rId = this.ctx.resources.imageRelationship(this.story.part, media);
    const id = this.ctx.nextDrawingId++;
    const p = prefixOf(anchor.qname);
    return [rawXml(pictureRunXml(anchor, runProperties(p, runPropertiesOf(anchor)), { rId, cx: Math.max(1, Math.round(cx)), cy: Math.max(1, Math.round(cy)), id, name: `Image ${String(id)}`, alt: image.alt }))];
  }

  /** The runs of inline Markdown, with the formatting of the anchor. */
  private inlineRuns(anchor: RawElement, tag: TagRecord, content: readonly Inline[]): string {
    const p = prefixOf(anchor.qname);
    const base = runPropertiesOf(anchor);
    const out: string[] = [];
    for (const inline of content) {
      const style: RunStyle = { ...(inline.bold ? { bold: true } : {}), ...(inline.italic ? { italic: true } : {}) };
      const code = inline.code ? this.style('HTML Code', 'character', tag) : undefined;
      const runStyle = code === undefined ? style : { ...style, rStyle: code };
      if (inline.link !== undefined) {
        const problem = checkLinkUrl(inline.link);
        if (problem !== null) {
          this.invalid(tag, `The Markdown link "${clip(inline.link)}" cannot be a link: ${problem}`, 'Use absolute http, https or mailto addresses in Markdown links.');
          out.push(runXml(anchor, runProperties(p, base, runStyle), inline.text, inline.breakBefore === true));
          continue;
        }
        if (inline.breakBefore === true) out.push(runXml(anchor, runProperties(p, base), '', true));
        const [node] = this.linkNodes(anchor, new LinkValue(inline.link, inline.text), tag, runStyle);
        out.push((node as RawNode & { raw: string }).raw);
        continue;
      }
      out.push(runXml(anchor, runProperties(p, base, runStyle), inline.text, inline.breakBefore === true));
    }
    return out.join('');
  }

  /** Markdown in place of the anchor (inline), or of the paragraph that holds only the tag (blocks). */
  private markdownNodes(node: RawElement, tag: TagRecord, scopes: readonly unknown[], blocks: boolean): RawNode[] {
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
    if (!blocks) {
      if (parsed.length > 1 || (parsed[0] !== undefined && parsed[0].kind !== 'paragraph')) {
        this.invalid(tag, `The Markdown of "${clip(tag.info.raw)}" has headings, lists or several paragraphs, but the tag shares its paragraph with other text.`, `Put ${tag.info.raw} alone in a paragraph to get headings, lists and paragraphs.`);
        return [];
      }
      return parsed[0] === undefined ? [] : [rawXml(this.inlineRuns(node, tag, parsed[0].content))];
    }
    const anchor = this.anchors.get(tag) as RawElement;
    const p = prefixOf(node.qname);
    const numbers = [0, 0, 0];
    const kinds: (boolean | undefined)[] = [undefined, undefined, undefined];
    const out: string[] = [];
    for (const block of parsed as Block[]) {
      let styleId: string | undefined;
      let prefix = '';
      if (block.kind === 'heading') styleId = this.style(`heading ${String(block.level)}`, 'paragraph', tag);
      if (block.kind === 'item') {
        const name = `${block.ordered ? 'List Number' : 'List Bullet'}${block.level === 0 ? '' : ` ${String(block.level + 1)}`}`;
        styleId = this.style(name, 'paragraph', tag);
        // A list of the other kind at this level starts its numbering again.
        if (kinds[block.level] !== block.ordered) numbers[block.level] = 0;
        kinds[block.level] = block.ordered;
        numbers[block.level] = (numbers[block.level] ?? 0) + 1;
        for (let l = block.level + 1; l < numbers.length; l++) {
          numbers[l] = 0;
          kinds[l] = undefined;
        }
        if (styleId === undefined) prefix = `${'    '.repeat(block.level)}${block.ordered ? `${String(numbers[block.level])}. ` : '• '}`;
      } else {
        numbers.fill(0);
        kinds.fill(undefined);
      }
      const content = (prefix === '' ? '' : runXml(anchor, runProperties(p, runPropertiesOf(anchor)), prefix)) + this.inlineRuns(anchor, tag, block.content);
      out.push(paragraphXml(node, paragraphProperties(p, node, styleId), content));
    }
    return [rawXml(out.join(''))];
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
    known = this.valueAnchors.has(e) || this.imageAnchors.has(e) || this.markdownAnchors.has(e) || this.markdownParagraphs.has(e) || this.droppedAnchors.has(e) || this.units.has(e) || this.prunedAlternates.has(e) || e.children.some((c) => c.kind === 'element' && this.containsWork(c));
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
        const value = this.valueText(valueTag, scopes);
        const nodes = value instanceof LinkValue ? this.linkNodes(child, value, valueTag) : this.valueRuns(child, value ?? '');
        for (const run of nodes) {
          this.count(run);
          out.push(run);
        }
        continue;
      }
      const imageTag = this.imageAnchors.get(child);
      if (imageTag !== undefined) {
        for (const node of this.imageNodes(child, imageTag, scopes)) {
          this.count(node);
          out.push(node);
        }
        continue;
      }
      const markdownTag = this.markdownAnchors.get(child) ?? this.markdownParagraphs.get(child);
      if (markdownTag !== undefined) {
        for (const node of this.markdownNodes(child, markdownTag, scopes, this.markdownParagraphs.has(child))) {
          this.count(node);
          out.push(node);
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

/**
 * The width of the text column of the main document in EMU: the page width minus the left and
 * right margins of the last w:sectPr of the body (F-015), or 16 cm when they are not given.
 */
export function textWidthOf(doc: RawDocument): number {
  const body = doc.root.children.find((c): c is RawElement => c.kind === 'element' && isWml(c, 'body'));
  const sectPr = [...(body?.children ?? [])].reverse().find((c): c is RawElement => c.kind === 'element' && isWml(c, 'sectPr'));
  const child = (local: string): RawElement | undefined => sectPr?.children.find((c): c is RawElement => c.kind === 'element' && isWml(c, local));
  const pgSz = child('pgSz');
  const pgMar = child('pgMar');
  const num = (e: RawElement | undefined, name: string): number => Number(e?.attrs.get(`{${e.ns}}${name}`));
  const width = num(pgSz, 'w') - (num(pgMar, 'left') || num(pgMar, 'start') || 0) - (num(pgMar, 'right') || num(pgMar, 'end') || 0);
  return Number.isFinite(width) && width > 0 ? width * EMU_PER_TWIP : 16 * EMU_PER_CM;
}

