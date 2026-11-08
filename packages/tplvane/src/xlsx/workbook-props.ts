// workbookPr/@dateCompatibility (D-075). LibreOffice writes it into xl/workbook.xml, but it is in no
// schema of ECMA-376: neither Part 1 (Strict) nor Part 4 (Transitional), 5th editions, define it,
// and Excel 2007 refuses a workbook that has it ("content that cannot be read"). The date system of
// a workbook is the date1904 attribute of workbookPr (Part 1 §18.2.28), which is kept. The attribute
// is removed from the start tag of workbookPr only, so the rest of the part stays as it was.
import type { Limits } from '../limits';
import { openPackage } from '../opc/package';
import { partNameToZipName, zipNameToPartName, partKey } from '../opc/part-name';
import { normalizeLineEnds } from '../xml/parser';
import { parseRawTree, type RawElement } from '../xml/raw-tree';
import { openZip } from '../zip/reader';
import { writeZip, type ZipWriteEntry } from '../zip/writer';

/** The attribute with the white space before it, in either quotes. */
const DATE_COMPATIBILITY = /\s+dateCompatibility\s*=\s*(?:"[^"]*"|'[^']*')/;

/** The workbook without workbookPr/@dateCompatibility; the bytes as they are when it has none. */
export function dropDateCompatibility(bytes: Uint8Array, limits: Limits): Uint8Array {
  const zip = openZip(bytes, limits);
  const pkg = openPackage(zip, limits);
  const book = pkg.relationships(null).find((r) => !r.external && r.type.endsWith('/officeDocument'));
  if (book === undefined || !pkg.hasPart(book.target)) return bytes;
  const xml = normalizeLineEnds(pkg.readXml(book.target) ?? '');
  if (!xml.includes('dateCompatibility')) return bytes;
  const doc = parseRawTree(xml, { part: book.target, limits });
  const props = doc.root.children.find((c): c is RawElement => c.kind === 'element' && c.local === 'workbookPr');
  if (props === undefined || !props.attrs.has('dateCompatibility')) return bytes;
  const open = props.open.replace(DATE_COMPATIBILITY, '');
  const changed = xml.slice(0, props.start) + open + xml.slice(props.start + props.open.length);
  const key = partKey(book.target);
  const encoder = new TextEncoder();
  const entries: ZipWriteEntry[] = zip.entries.map((entry) => {
    if (partKey(zipNameToPartName(entry.name)) === key) return { name: partNameToZipName(zipNameToPartName(entry.name)) ?? entry.name, data: encoder.encode(changed) };
    const raw = zip.raw(entry);
    return raw === null ? { name: entry.name, data: zip.read(entry) } : { name: entry.name, data: new Uint8Array(0), raw };
  });
  return writeZip(entries);
}
