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
  readonly ids: Set<string>;
  readonly added: string[];
  readonly byKey: Map<string, string>;
}

interface Media {
  readonly partName: string;
  readonly bytes: Uint8Array;
  readonly info: ImageInfo;
}

/** The parts and relationships one render adds. */
export class Resources {
  private readonly rels = new Map<string, PartRelationships>();
  private readonly media = new Map<string, Media[]>();
  private readonly mediaParts: Media[] = [];
  private readonly usedNames = new Set<string>();
  private next = 1;

  constructor(
    private readonly pkg: OpcPackage,
    private readonly zip: ZipReader,
    private readonly limits: Limits,
  ) {}

  private partRels(part: string): PartRelationships {
    const key = partKey(part);
    let r = this.rels.get(key);
    if (r === undefined) {
      r = { part, ids: new Set(this.pkg.relationships(part).map((x) => x.id)), added: [], byKey: new Map() };
      this.rels.set(key, r);
    }
    return r;
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
  image(bytes: Uint8Array, info: ImageInfo): string {
    const key = `${info.extension}:${String(bytes.length)}:${String(crc32(bytes))}`;
    const list = this.media.get(key) ?? [];
    const same = list.find((m) => m.bytes.length === bytes.length && m.bytes.every((b, i) => b === bytes[i]));
    if (same !== undefined) return same.partName;
    if (this.mediaParts.length >= this.limits.maxImages) {
      throw limitError('maxImages', this.limits.maxImages, `The document would get more than ${String(this.limits.maxImages)} different images.`);
    }
    let name: string;
    do name = `/word/media/docvane${String(this.mediaParts.length + this.usedNames.size + 1)}.${info.extension}`;
    while (this.pkg.hasPart(name) || this.usedNames.has(partKey(name)));
    this.usedNames.add(partKey(name));
    const media = { partName: name, bytes, info };
    list.push(media);
    this.media.set(key, list);
    this.mediaParts.push(media);
    return name;
  }

  /** A relationship from `part` to the media part `media`, as a target relative to the part's folder. */
  imageRelationship(part: string, media: string): string {
    const folder = part.slice(0, part.lastIndexOf('/') + 1);
    const target = media.startsWith(folder) ? media.slice(folder.length) : media;
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
      if (r.added.length === 0) continue;
      const relsPart = relationshipsPartName(r.part);
      const existing = this.pkg.readXml(relsPart);
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
    if (missing.size > 0) {
      // The Media Types stream is not a part (Part 2 §7.2.3), so it is read from the ZIP.
      const entry = this.zip.find('[Content_Types].xml');
      const types = entry === undefined ? '' : decodeXml(this.zip.read(entry), '/[Content_Types].xml');
      const open = /<Types\b[^>]*>/.exec(types);
      if (open !== null) {
        const defaults = [...missing].map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('');
        changed.set(partKey('/[Content_Types].xml'), { name: '/[Content_Types].xml', xml: types.slice(0, open.index + open[0].length) + defaults + types.slice(open.index + open[0].length) });
      }
    }
    return { added, changed };
  }

  /** The total size of the media added, for the output limit. */
  get mediaBytes(): number {
    return this.mediaParts.reduce((n, m) => n + m.bytes.length, 0);
  }
}
