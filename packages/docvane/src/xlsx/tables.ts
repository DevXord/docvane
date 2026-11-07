// Excel tables (Table1, with their filters) over repeated rows (D-073). xlvane moves tables that lie
// below inserted rows, but does not grow one whose last row is the last template row, so the
// copies would fall outside it. By the docvane rule for ranges (D-041), such a table, and its
// filter, now end on the last copy. The table parts are edited at their ref attributes only.
import type { Limits } from '../limits';
import { openPackage } from '../opc/package';
import { partKey, partNameToZipName, zipNameToPartName } from '../opc/part-name';
import { normalizeLineEnds } from '../xml/parser';
import { parseRawTree, type RawElement } from '../xml/raw-tree';
import { openZip } from '../zip/reader';
import { writeZip, type ZipWriteEntry } from '../zip/writer';

const REF = /^(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)$/;
const REL_ID = /(?:^|\})id$/;

/** The ref "A1:B2" with its last row moved from `last` to `last + added`; null when it does not end on `last`. */
function grow(ref: string, last: number, added: number): string | null {
  const m = REF.exec(ref);
  if (m === null || Number(m[4]) !== last || Number(m[2]) > last) return null;
  return `${m[1] as string}${m[2] as string}:${m[3] as string}${String(last + added)}`;
}

/** Replaces the value of the attribute `ref` in an open tag, either quote. */
function withRef(open: string, ref: string): string {
  return open.replace(/(\sref\s*=\s*)(?:"[^"]*"|'[^']*')/, `$1"${ref}"`);
}

/** The workbook with the tables of `sheet` that end on row `last` grown by `added` rows. */
export function extendTables(bytes: Uint8Array, sheet: string, last: number, added: number, limits: Limits): Uint8Array {
  if (added <= 0) return bytes;
  const zip = openZip(bytes, limits);
  const pkg = openPackage(zip, limits);
  const book = pkg.relationships(null).find((r) => !r.external && r.type.endsWith('/officeDocument'));
  if (book === undefined) return bytes;
  const workbook = parseRawTree(pkg.readXml(book.target) ?? '', { part: book.target, limits });
  let id: string | undefined;
  const find = (e: RawElement): void => {
    if (e.local === 'sheet' && e.attrs.get('name') === sheet) {
      for (const [key, value] of e.attrs) if (REL_ID.test(key) && key !== 'id' && key !== 'sheetId') id = value;
    }
    for (const c of e.children) if (c.kind === 'element') find(c);
  };
  find(workbook.root);
  const target = pkg.relationships(book.target).find((r) => r.id === id && !r.external)?.target;
  if (target === undefined) return bytes;
  const changed = new Map<string, string>();
  for (const rel of pkg.relationships(target)) {
    if (rel.external || !rel.type.endsWith('/table') || !pkg.hasPart(rel.target)) continue;
    const xml = normalizeLineEnds(pkg.readXml(rel.target) ?? '');
    const doc = parseRawTree(xml, { part: rel.target, limits });
    const ref = doc.root.attrs.get('ref');
    const grown = ref === undefined ? null : grow(ref, last, added);
    if (grown === null) continue;
    let out = xml.slice(0, doc.root.start) + withRef(doc.root.open, grown) + xml.slice(doc.root.start + doc.root.open.length);
    const filter = doc.root.children.find((c): c is RawElement => c.kind === 'element' && c.local === 'autoFilter');
    const filterRef = filter?.attrs.get('ref');
    const filterGrown = filter === undefined || filterRef === undefined ? null : grow(filterRef, last, added);
    if (filter !== undefined && filterGrown !== null) {
      const shift = out.length - xml.length;
      const at = filter.start + shift;
      out = out.slice(0, at) + withRef(filter.open, filterGrown) + out.slice(at + filter.open.length);
    }
    changed.set(partKey(rel.target), out);
  }
  if (changed.size === 0) return bytes;
  const encoder = new TextEncoder();
  const entries: ZipWriteEntry[] = zip.entries.map((entry) => {
    const xml = changed.get(partKey(zipNameToPartName(entry.name)));
    if (xml !== undefined) return { name: partNameToZipName(zipNameToPartName(entry.name)) ?? entry.name, data: encoder.encode(xml) };
    const raw = zip.raw(entry);
    return raw === null ? { name: entry.name, data: zip.read(entry) } : { name: entry.name, data: new Uint8Array(0), raw };
  });
  return writeZip(entries);
}
