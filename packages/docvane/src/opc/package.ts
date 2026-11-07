// Copied from DevXord/xlvane packages/xlvane/src/opc/package.ts at aeaefbc (unchanged since
// ada547b), adapted for docvane (D-009): DvError and DV_E_* codes, messages that name no
// application.
//
// The OPC package layer (ECMA-376 Part 2, Open Packaging Conventions): maps ZIP items to parts,
// reads the Media Types stream and Relationships parts. Facts F-OPC-01 … F-OPC-15 and decisions
// D-OPC-01 … D-OPC-07 of xlvane.
//
// Untrusted input: names, extensions, Ids and targets from the file are only ever used as Map
// keys or values, never as object keys. Work is linear in the size of the parts read, and XML
// parsing is bounded by the read limits.
import { DvError, type DvDetails } from '../errors';
import type { ReadLimits } from '../limits';
import { CONTENT_TYPES_NS, PACKAGE_REL_NS } from './namespaces';
import { clip } from '../util/clip';
import { decodeXml } from '../xml/parser';
import { parseXmlTree, type XmlElement } from '../xml/tree';
import type { ZipEntry, ZipReader } from '../zip/reader';
import {
  canonicalReference,
  hasColonInFirstSegment,
  isPartName,
  isRelationshipsPart,
  partKey,
  removeDotSegments,
  zipNameToPartName,
} from './part-name';

/** One relationship from a Relationships part (Part 2 §6.5.3.4). */
export interface Relationship {
  /** The Id attribute, unique within its Relationships part. */
  readonly id: string;
  /** The Type attribute as written; compare it case-sensitively (§6.5.3.4). */
  readonly type: string;
  /** Internal: resolved absolute part name such as "/word/header1.xml". External: the Target as written. */
  readonly target: string;
  /** `true` for TargetMode="External": the target is outside the package and is never read. */
  readonly external: boolean;
}

/** An opened OPC package: the parts of a ZIP archive, their media types and relationships. */
export interface OpcPackage {
  /** Part names such as "/word/document.xml", in ZIP order. The Media Types stream, folders and items that are not valid part names are not parts. */
  readonly partNames: readonly string[];
  /** Whether a part with an equivalent name exists (ASCII case-insensitive, Part 2 §6.2.2.3). */
  hasPart(partName: string): boolean;
  /** The media type of a part: a matching Override first, then a Default by extension (Part 2 §7.2.3.5). */
  contentType(partName: string): string | undefined;
  /** Relationships of a part, or of the package when `source` is null. Empty if the Relationships part is absent. */
  relationships(source: string | null): readonly Relationship[];
  /** The decoded text of an XML part, or undefined if there is no such part. */
  readXml(partName: string): string | undefined;
  /** The bytes of a part, or undefined if there is no such part. */
  readBytes(partName: string): Uint8Array | undefined;
  /** The Defaults of the Media Types stream, by extension in lower case, and the Override of a part if it has one (docvane, for rewriting the stream). */
  readonly mediaTypeDefaults: ReadonlyMap<string, string>;
  overrideType(partName: string): string | undefined;
}

/** ZIP item name of the Media Types stream (Part 2 §7.3.7, F-OPC-09). */
const CONTENT_TYPES_ITEM = '[content_types].xml';
/** Used in error locations; the stream is not a part, but this is where users find it. */
const CONTENT_TYPES_LOCATION = '/[Content_Types].xml';
/** Media type of Relationships parts (Part 2 §6.5.2.1, F-OPC-07). */
const RELATIONSHIPS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const PACKAGE_RELATIONSHIPS = '/_rels/.rels';

const INVALID_HINT =
  'The package structure is damaged or was written by a program that does not follow ECMA-376 Part 2. Re-save the file in the application that made it; if a program generated it, report the problem to its authors.';

const EMPTY: readonly Relationship[] = Object.freeze([]);

function invalid(part: string, message: string, reason: string, extra: DvDetails = {}): DvError {
  return new DvError('DV_E_PART_INVALID', message, {
    location: { part },
    hint: INVALID_HINT,
    details: { reason, ...extra },
  });
}

function requireAttribute(element: XmlElement, name: string, part: string): string {
  const value = element.attrs.get(name);
  if (value === undefined) {
    throw invalid(part, `A ${element.local} element has no ${name} attribute.`, 'missing-attribute', {
      element: element.local,
      attribute: name,
    });
  }
  return value;
}

/**
 * Returns the name of the Relationships part for `source`: "/_rels/.rels" for the package (null),
 * otherwise "_rels/" inserted before the last segment and ".rels" appended
 * (Part 2 §6.5.2.2 and §6.5.2.3, F-OPC-07). "/word/document.xml" gives "/word/_rels/document.xml.rels".
 */
export function relationshipsPartName(source: string | null): string {
  if (source === null) return PACKAGE_RELATIONSHIPS;
  const slash = source.lastIndexOf('/');
  return `${source.slice(0, slash + 1)}_rels/${source.slice(slash + 1)}.rels`;
}

/**
 * Resolves the Target of an internal relationship to a part name. The base is the source part, or
 * the package root when `source` is null (Part 2 §6.4, §6.5.2.2, §6.5.2.3; F-OPC-06, F-OPC-07).
 *
 * Query and fragment are dropped (§6.3.2, F-OPC-05); percent-encoded `iunreserved` characters are
 * decoded (D-OPC-02); the path is merged and its dot segments removed as in RFC 3986 §5.2, so
 * "../" above the root stays at the root (D-OPC-03). Returns null when `target` is not a relative
 * reference (it has a scheme or an authority) or the result is not a valid part name.
 */
export function resolveTarget(source: string | null, target: string): string | null {
  let end = target.indexOf('#');
  if (end === -1) end = target.length;
  const query = target.indexOf('?');
  if (query !== -1 && query < end) end = query;
  const raw = target.slice(0, end);
  // RFC 3986 §4.2: a colon in the first segment means a scheme (an absolute IRI), and "//" starts
  // an authority (a network-path reference). Neither is a relative reference to a part.
  if (hasColonInFirstSegment(raw) || raw.startsWith('//')) return null;
  const path = canonicalReference(raw);
  const base = source ?? '/';
  let merged: string;
  if (path === '') merged = base;
  else if (path.charCodeAt(0) === 0x2f) merged = path;
  else merged = base.slice(0, base.lastIndexOf('/') + 1) + path;
  const resolved = removeDotSegments(merged);
  return isPartName(resolved) ? resolved : null;
}

interface StoredPart {
  readonly name: string;
  readonly entry: ZipEntry;
}

interface MediaTypes {
  /** Default@Extension (folded) → ContentType. */
  readonly defaults: ReadonlyMap<string, string>;
  /** Override@PartName (canonical, folded) → ContentType. */
  readonly overrides: ReadonlyMap<string, string>;
}

/**
 * Opens the OPC package stored in a ZIP archive. Maps ZIP items to parts (Part 2 §7.3.5,
 * F-OPC-12, F-OPC-13) and reads the Media Types stream, which a ZIP package must contain
 * (§7.2.3.1, F-OPC-09). Relationships parts are read on demand.
 *
 * Throws `DV_E_PART_MISSING` without `[Content_Types].xml`, `DV_E_PART_INVALID` for two items
 * with equivalent part names or a malformed Media Types stream, and whatever the ZIP and XML
 * layers throw.
 */
export function openPackage(zip: ZipReader, limits: ReadLimits): OpcPackage {
  const parts = new Map<string, StoredPart>();
  const partNames: string[] = [];
  let contentTypes: ZipEntry | undefined;
  let interleaved = false;
  for (const entry of zip.entries) {
    const folded = partKey(entry.name);
    if (folded === CONTENT_TYPES_ITEM) {
      contentTypes = entry;
      continue;
    }
    if (folded.startsWith(`${CONTENT_TYPES_ITEM}/`)) {
      interleaved = true;
      continue;
    }
    // Folders do not represent files (§7.3.5, Annex B Table B.3).
    if (entry.name.endsWith('/')) continue;
    const name = zipNameToPartName(entry.name);
    // Items whose names do not follow the part name grammar are not parts (§7.2.5.5).
    if (!isPartName(name)) continue;
    const key = partKey(name);
    const previous = parts.get(key);
    if (previous !== undefined) {
      // §7.2.5.2: a physical package shall not contain equivalent logical item names.
      throw invalid(
        previous.name,
        `ZIP items "${clip(previous.entry.name)}" and "${clip(entry.name)}" both map to part ${clip(previous.name)}.`,
        'equivalent-part-names',
        { items: [clip(previous.entry.name), clip(entry.name)] },
      );
    }
    parts.set(key, { name, entry });
    partNames.push(name);
  }
  if (contentTypes === undefined) {
    throw new DvError(
      'DV_E_PART_MISSING',
      interleaved
        ? 'The package stores [Content_Types].xml in interleaved pieces, which Office Open XML documents must not use.'
        : 'The package has no [Content_Types].xml, so it is not an Office Open XML package.',
      {
        location: { part: CONTENT_TYPES_LOCATION },
        hint: 'Check that the file is a .docx, .pptx or .xlsx document and not another ZIP-based format (such as .odt or .zip). If it is, re-save it in the application that made it.',
        details: { reason: interleaved ? 'interleaved' : 'missing' },
      },
    );
  }
  const mediaTypes = readMediaTypes(zip.read(contentTypes), limits);
  return new Package(zip, limits, parts, Object.freeze(partNames), mediaTypes);
}

/** Parses the Media Types stream (Part 2 §7.2.3.2, F-OPC-10). */
function readMediaTypes(bytes: Uint8Array, limits: ReadLimits): MediaTypes {
  const part = CONTENT_TYPES_LOCATION;
  // decodeXml enforces UTF-8/UTF-16 and parseXmlTree rejects DTDs (§6.2.5 a, b; F-OPC-04).
  const root = parseXmlTree(decodeXml(bytes, part), { part, limits });
  if (root.ns !== CONTENT_TYPES_NS || root.local !== 'Types') {
    throw invalid(part, `The root element of [Content_Types].xml is not Types in namespace ${CONTENT_TYPES_NS}.`, 'root-element', {
      element: clip(root.local),
      namespace: clip(root.ns),
    });
  }
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const child of root.children) {
    // Unknown elements are ignored (D-OPC-04).
    if (child.ns !== CONTENT_TYPES_NS) continue;
    if (child.local === 'Default') {
      const extension = requireAttribute(child, 'Extension', part);
      const type = requireAttribute(child, 'ContentType', part);
      // Extensions match ASCII case-insensitively (§7.2.3.5); at most one Default each (§7.2.3.2.1).
      const key = partKey(extension);
      if (defaults.has(key)) {
        throw invalid(part, `[Content_Types].xml has more than one Default for extension "${clip(extension)}".`, 'duplicate-default', {
          extension: clip(extension),
        });
      }
      defaults.set(key, type);
    } else if (child.local === 'Override') {
      const partName = requireAttribute(child, 'PartName', part);
      const type = requireAttribute(child, 'ContentType', part);
      const key = partKey(canonicalReference(partName));
      if (overrides.has(key)) {
        throw invalid(part, `[Content_Types].xml has more than one Override for part "${clip(partName)}".`, 'duplicate-override', {
          partName: clip(partName),
        });
      }
      overrides.set(key, type);
    }
  }
  return { defaults, overrides };
}

/** The extension of a part name: what follows the last "." of the last segment (§7.2.3.5 c). */
function extensionOf(partName: string): string | null {
  const dot = partName.lastIndexOf('.');
  return dot > partName.lastIndexOf('/') ? partName.slice(dot + 1) : null;
}

class Package implements OpcPackage {
  private readonly cache = new Map<string, readonly Relationship[]>();

  constructor(
    private readonly zip: ZipReader,
    private readonly limits: ReadLimits,
    private readonly parts: ReadonlyMap<string, StoredPart>,
    readonly partNames: readonly string[],
    private readonly mediaTypes: MediaTypes,
  ) {}

  hasPart(partName: string): boolean {
    return this.parts.has(partKey(partName));
  }

  get mediaTypeDefaults(): ReadonlyMap<string, string> {
    return this.mediaTypes.defaults;
  }

  overrideType(partName: string): string | undefined {
    return this.mediaTypes.overrides.get(partKey(partName));
  }

  contentType(partName: string): string | undefined {
    const override = this.mediaTypes.overrides.get(partKey(partName));
    if (override !== undefined) return override;
    const extension = extensionOf(partName);
    if (extension !== null) {
      const type = this.mediaTypes.defaults.get(partKey(extension));
      if (type !== undefined) return type;
    }
    // The stream need not cover Relationships parts (§7.2.3.2.1), whose type is fixed (§6.5.2.1).
    return isRelationshipsPart(partName) ? RELATIONSHIPS_CONTENT_TYPE : undefined;
  }

  relationships(source: string | null): readonly Relationship[] {
    const relsName = relationshipsPartName(source);
    const key = partKey(relsName);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const stored = this.parts.get(key);
    const list = stored === undefined ? EMPTY : this.parseRelationships(stored, source);
    this.cache.set(key, list);
    return list;
  }

  readXml(partName: string): string | undefined {
    const stored = this.parts.get(partKey(partName));
    return stored === undefined ? undefined : decodeXml(this.zip.read(stored.entry), stored.name);
  }

  readBytes(partName: string): Uint8Array | undefined {
    const stored = this.parts.get(partKey(partName));
    return stored === undefined ? undefined : this.zip.read(stored.entry);
  }

  /** Parses a Relationships part (Part 2 §6.5.3, F-OPC-08). */
  private parseRelationships(stored: StoredPart, source: string | null): readonly Relationship[] {
    const part = stored.name;
    const root = parseXmlTree(decodeXml(this.zip.read(stored.entry), part), { part, limits: this.limits });
    if (root.ns !== PACKAGE_REL_NS || root.local !== 'Relationships') {
      throw invalid(part, `The root element of ${clip(part)} is not Relationships in namespace ${PACKAGE_REL_NS}.`, 'root-element', {
        element: clip(root.local),
        namespace: clip(root.ns),
      });
    }
    const ids = new Set<string>();
    const list: Relationship[] = [];
    for (const child of root.children) {
      // Unknown elements are ignored; MCE is not processed (D-OPC-04).
      if (child.ns !== PACKAGE_REL_NS || child.local !== 'Relationship') continue;
      const id = requireAttribute(child, 'Id', part);
      const type = requireAttribute(child, 'Type', part);
      const target = requireAttribute(child, 'Target', part);
      const mode = child.attrs.get('TargetMode');
      // §6.5.3.4: the Id is unique within the Relationships part.
      if (ids.has(id)) {
        throw invalid(part, `Relationship Id "${clip(id)}" is used more than once.`, 'duplicate-id', { id: clip(id) });
      }
      ids.add(id);
      // ST_TargetMode is Internal or External; Internal is the default.
      if (mode !== undefined && mode !== 'Internal' && mode !== 'External') {
        throw invalid(part, `Relationship "${clip(id)}" has TargetMode "${clip(mode)}"; expected Internal or External.`, 'target-mode', {
          id: clip(id),
          targetMode: clip(mode),
        });
      }
      if (mode === 'External') {
        // External targets are kept as written and never resolved or read (F-OPC-07).
        list.push(Object.freeze({ id, type, target, external: true }));
        continue;
      }
      const resolved = resolveTarget(source, target);
      if (resolved === null) {
        // An internal Target shall be a relative reference to a part (§6.5.3.4; D-OPC-05).
        throw invalid(
          part,
          `Relationship "${clip(id)}" has the internal target "${clip(target)}", which is not a relative reference to a part.`,
          'internal-target',
          { id: clip(id), target: clip(target) },
        );
      }
      list.push(Object.freeze({ id, type, target: resolved, external: false }));
    }
    return Object.freeze(list);
  }
}
