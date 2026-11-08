// Parts and relationships that a render adds to the package: media parts for pictures, and
// relationships from each story part to its pictures and hyperlinks (ECMA-376 Part 2 §6.5;
// the shapes follow LibreOffice 24.2, F-015). Written into the ZIP by ../render.ts.
import { TvError } from '../errors';
import { limitError, type Limits } from '../limits';
import type { OpcPackage } from '../opc/package';
import { relationshipsPartName } from '../opc/package';
import { partKey } from '../opc/part-name';
import { escapeAttr } from '../xml/writer';
import { crc32 } from '../zip/crc32';
import type { ZipReader } from '../zip/reader';
import { decodeXml } from '../xml/parser';
import type { ImageInfo } from '../media/image-info';
import { TRANSITIONAL, type Vocabulary } from '../opc/conformance';

interface PartRelationships {
  readonly part: string;
  /** The XML to start from, when the part is a copy made by the render. */
  /** For a copied part: its relationships, written as elements. */
  base?: readonly string[];
  readonly removed: Set<string>;
  readonly ids: Set<string>;
  readonly added: string[];
  readonly byKey: Map<string, string>;
}

interface Media {
  readonly partName: string;
  readonly bytes: Uint8Array;
  readonly info: ImageInfo;
}

/** The target of a relationship from `from` to `to`, relative to the folder of `from` (as "../media/x.png"). */
export function relativeTarget(from: string, to: string): string {
  const a = from.split('/').slice(1, -1);
  const b = to.split('/').slice(1);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** A Relationship element. */
export function relationshipXml(id: string, type: string, target: string, external: boolean): string {
  return `<Relationship Id="${escapeAttr(id)}" Type="${escapeAttr(type)}" Target="${escapeAttr(target)}"${external ? ' TargetMode="External"' : ''}/>`;
}

/** The Id of a Relationship element written by relationshipXml. */
const idOf = (xml: string): string =>
  (/\bId="([^"]*)"/.exec(xml)?.[1] ?? '').replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e] as string);

/** The parts and relationships one render adds. */
export class Resources {
  private readonly rels = new Map<string, PartRelationships>();
  private readonly media = new Map<string, Media[]>();
  private readonly mediaParts: Media[] = [];
  private readonly usedNames = new Set<string>();
  private readonly overrides = new Map<string, string>();
  private readonly removedOverrides = new Set<string>();
  private readonly removedParts = new Set<string>();
  private next = 1;

  constructor(
    private readonly pkg: OpcPackage,
    private readonly zip: ZipReader,
    private readonly limits: Limits,
    /** The folder of media parts: /word/media/ in documents, /ppt/media/ in presentations. */
    private readonly mediaFolder: string = '/word/media/',
    /** The names of what the render writes: Strict in a Strict package (F-025). */
    readonly vocabulary: Vocabulary = TRANSITIONAL,
  ) {}

  private partRels(part: string): PartRelationships {
    const key = partKey(part);
    let r = this.rels.get(key);
    if (r === undefined) {
      r = { part, removed: new Set(), ids: new Set(this.pkg.relationships(part).map((x) => x.id)), added: [], byKey: new Map() };
      this.rels.set(key, r);
    }
    return r;
  }

  /** A new part name `<folder><stem>N.<ext>` that is not in the package and not given out before. */
  newPartName(folder: string, stem: string, ext: string): string {
    let name: string;
    let n = this.usedNames.size + 1;
    do name = `${folder}${stem}${String(n++)}.${ext}`;
    while (this.pkg.hasPart(name) || this.usedNames.has(partKey(name)));
    this.usedNames.add(partKey(name));
    return name;
  }

  /** Starts the relationships of a new part `part` from the XML of another part's relationships. */
  seedRelationships(part: string, entries: readonly string[], ids: readonly string[]): void {
    const r: PartRelationships = { part, base: entries, removed: new Set(), ids: new Set(ids), added: [], byKey: new Map() };
    this.rels.set(partKey(part), r);
  }

  /** Removes a relationship of `part` by Id. */
  removeRelationship(part: string, id: string): void {
    this.partRels(part).removed.add(id);
  }

  /** Adds an Override to the Media Types stream for a new part. */
  addOverride(partName: string, contentType: string): void {
    this.overrides.set(partName, contentType);
  }

  /** Leaves a part, its Relationships part and its Override out of the result. */
  removePart(partName: string): void {
    this.removedParts.add(partKey(partName));
    this.removedParts.add(partKey(relationshipsPartName(partName)));
    this.removedOverrides.add(partKey(partName));
  }

  /** The parts left out of the result, by partKey. */
  get removed(): ReadonlySet<string> {
    return this.removedParts;
  }

  /** A relationship from `part`, reused for the same target; returns its Id. */
  relationship(part: string, type: string, target: string, external: boolean): string {
    const r = this.partRels(part);
    const key = `${type} ${target}`;
    const known = r.byKey.get(key);
    if (known !== undefined) return known;
    let id: string;
    do id = `rIdDv${String(this.next++)}`;
    while (r.ids.has(id));
    r.ids.add(id);
    r.byKey.set(key, id);
    r.added.push(`<Relationship Id="${escapeAttr(id)}" Type="${escapeAttr(type)}" Target="${escapeAttr(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return id;
  }

  /** The media part for these image bytes, added once per distinct image. */
  /** Media parts by the identity of the bytes, so that a value repeated in a loop costs nothing more (D-062). */
  private readonly byIdentity = new WeakMap<Uint8Array, string>();
  /** Decoded data URLs by their text, for the same reason. */
  readonly dataUrls: Map<string, Uint8Array> = new Map();

  image(bytes: Uint8Array, info: ImageInfo): string {
    const known = this.byIdentity.get(bytes);
    if (known !== undefined) return known;
    const name = this.imageByContent(bytes, info);
    this.byIdentity.set(bytes, name);
    return name;
  }

  private imageByContent(bytes: Uint8Array, info: ImageInfo): string {
    const key = `${info.extension}:${String(bytes.length)}:${String(crc32(bytes))}`;
    const list = this.media.get(key) ?? [];
    const same = list.find((m) => m.bytes.length === bytes.length && m.bytes.every((b, i) => b === bytes[i]));
    if (same !== undefined) return same.partName;
    if (this.mediaParts.length >= this.limits.maxImages) {
      throw limitError('maxImages', this.limits.maxImages, `The document would get more than ${String(this.limits.maxImages)} different images.`);
    }
    const name = this.newPartName(this.mediaFolder, 'tplvane', info.extension);
    const media = { partName: name, bytes, info };
    list.push(media);
    this.media.set(key, list);
    this.mediaParts.push(media);
    return name;
  }

  /** A relationship from `part` to the media part `media`, as a target relative to the part's folder. */
  imageRelationship(part: string, media: string): string {
    const target = relativeTarget(part, media);
    return this.relationship(part, this.vocabulary.imageRel, target, false);
  }

  /**
   * The new and changed parts: media, Relationships parts (existing ones with the new entries
   * added, missing ones created) and the Media Types stream with a Default for each new extension.
   * Changed parts are keyed by partKey, like the parts a render rewrites.
   */
  parts(): { added: Map<string, Uint8Array>; changed: Map<string, { readonly name: string; readonly xml: string }> } {
    const added = new Map<string, Uint8Array>();
    const changed = new Map<string, { readonly name: string; readonly xml: string }>();
    for (const m of this.mediaParts) added.set(m.partName, m.bytes);
    for (const r of this.rels.values()) {
      if (r.added.length === 0 && r.removed.size === 0 && r.base === undefined) continue;
      const relsPart = relationshipsPartName(r.part);
      // Written again from the parsed relationships, not edited as text: comments, processing
      // instructions, end tags or apostrophes in the template cannot misplace an entry (D-071).
      const kept = r.base ?? this.pkg.relationships(r.part).filter((x) => !r.removed.has(x.id)).map((x) => relationshipXml(x.id, x.type, x.external ? x.target : relativeTarget(r.part, x.target), x.external));
      const entries = r.base === undefined ? kept : kept.filter((x) => !r.removed.has(idOf(x)));
      changed.set(partKey(relsPart), { name: relsPart, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.join('')}${r.added.join('')}</Relationships>` });
    }
    const missing = new Map<string, string>();
    for (const m of this.mediaParts) if (this.pkg.contentType(m.partName) === undefined) missing.set(m.info.extension, m.info.contentType);
    if (missing.size > 0 || this.overrides.size > 0 || this.removedOverrides.size > 0) {
      // Written again from the parsed stream (Part 2 §7.2.3): the Defaults, then an Override for
      // every part that has one and still exists, then those of new parts (D-071). Overrides of
      // removed parts, and of their Relationships parts, go.
      const defaults = new Map(this.pkg.mediaTypeDefaults);
      for (const [ext, type] of missing) if (!defaults.has(ext.toLowerCase())) defaults.set(ext.toLowerCase(), type);
      const out: string[] = [];
      for (const [ext, type] of defaults) out.push(`<Default Extension="${escapeAttr(ext)}" ContentType="${escapeAttr(type)}"/>`);
      for (const name of this.pkg.partNames) {
        const type = this.pkg.overrideType(name);
        if (type === undefined || this.removedOverrides.has(partKey(name)) || this.removedParts.has(partKey(name)) || this.overrides.has(name)) continue;
        out.push(`<Override PartName="${escapeAttr(name)}" ContentType="${escapeAttr(type)}"/>`);
      }
      for (const [name, type] of this.overrides) out.push(`<Override PartName="${escapeAttr(name)}" ContentType="${escapeAttr(type)}"/>`);
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${out.join('')}</Types>`;
      changed.set(partKey('/[Content_Types].xml'), { name: '/[Content_Types].xml', xml });
    }
    return { added, changed };
  }

  /** The total size of the media added, for the output limit. */
  get mediaBytes(): number {
    return this.mediaParts.reduce((n, m) => n + m.bytes.length, 0);
  }
}
