// Parts and relationships that a render adds to the package: media parts for pictures, and
// relationships from each story part to its pictures and hyperlinks (ECMA-376 Part 2 §6.5;
// the shapes follow LibreOffice 24.2, F-015). Written into the ZIP by ../render.ts.
import { DvError } from '../errors';
import { limitError, type Limits } from '../limits';
import type { OpcPackage } from '../opc/package';
import { relationshipsPartName } from '../opc/package';
import { partKey } from '../opc/part-name';
import { escapeAttr } from '../xml/writer';
import { crc32 } from '../zip/crc32';
import type { ZipReader } from '../zip/reader';
import { decodeXml } from '../xml/parser';
import type { ImageInfo } from '../media/image-info';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const IMAGE_REL: string = `${REL}/image`;
export const HYPERLINK_REL: string = `${REL}/hyperlink`;

interface PartRelationships {
  readonly part: string;
  /** The XML to start from, when the part is a copy made by the render. */
  base?: string;
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
  seedRelationships(part: string, xml: string, ids: readonly string[]): void {
    const r: PartRelationships = { part, base: xml, removed: new Set(), ids: new Set(ids), added: [], byKey: new Map() };
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
    const name = this.newPartName(this.mediaFolder, 'docvane', info.extension);
    const media = { partName: name, bytes, info };
    list.push(media);
    this.media.set(key, list);
    this.mediaParts.push(media);
    return name;
  }

  /** A relationship from `part` to the media part `media`, as a target relative to the part's folder. */
  imageRelationship(part: string, media: string): string {
    const target = relativeTarget(part, media);
    return this.relationship(part, IMAGE_REL, target, false);
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
      let existing = r.base ?? this.pkg.readXml(relsPart);
      for (const id of r.removed) {
        if (existing !== undefined) existing = existing.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${id.replace(/[^\w-]/g, '')}"[^>]*/>`), '');
      }
      if (existing === undefined) {
        changed.set(partKey(relsPart), { name: relsPart, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.added.join('')}</Relationships>` });
      } else {
        const at = existing.lastIndexOf('</');
        if (at === -1) throw new DvError('DV_E_PART_INVALID', 'A relationships part has no end tag.', { location: { part: relsPart }, hint: 'Re-save the document in the application that made it.', details: { reason: 'root-element' } });
        changed.set(partKey(relsPart), { name: relsPart, xml: existing.slice(0, at) + r.added.join('') + existing.slice(at) });
      }
    }
    const missing = new Map<string, string>();
    for (const m of this.mediaParts) if (this.pkg.contentType(m.partName) === undefined) missing.set(m.info.extension, m.info.contentType);
    if (missing.size > 0 || this.overrides.size > 0 || this.removedOverrides.size > 0) {
      // The Media Types stream is not a part (Part 2 §7.2.3), so it is read from the ZIP.
      const entry = this.zip.find('[Content_Types].xml');
      const types = entry === undefined ? '' : decodeXml(this.zip.read(entry), '/[Content_Types].xml');
      let xml = types;
      // Overrides of removed parts go: a Media Types stream may not name parts that do not exist.
      xml = xml.replace(/<Override\b[^>]*\/>/g, (o) => {
        const name = /PartName="([^"]*)"/.exec(o)?.[1];
        return name !== undefined && this.removedOverrides.has(partKey(name)) ? '' : o;
      });
      const open = /<Types\b[^>]*>/.exec(xml);
      if (open !== null) {
        const defaults = [...missing].map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('');
        const overrides = [...this.overrides].map(([name, type]) => `<Override PartName="${escapeAttr(name)}" ContentType="${escapeAttr(type)}"/>`).join('');
        xml = xml.slice(0, open.index + open[0].length) + defaults + xml.slice(open.index + open[0].length);
        const end = xml.lastIndexOf('</');
        xml = xml.slice(0, end) + overrides + xml.slice(end);
        changed.set(partKey('/[Content_Types].xml'), { name: '/[Content_Types].xml', xml });
      }
    }
    return { added, changed };
  }

  /** The total size of the media added, for the output limit. */
  get mediaBytes(): number {
    return this.mediaParts.reduce((n, m) => n + m.bytes.length, 0);
  }
}
