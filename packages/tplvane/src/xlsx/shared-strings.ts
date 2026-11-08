// The shared strings of a rendered workbook, keeping only the strings its cells use (D-071). xlvane
// adds the strings it writes and keeps the others, so the text of the template (its tags, and the
// text of sections shown no time, such as "Internal margin - do not share") would stay in the file.
// The table is written again with the strings in use, in their order, and the cells that refer to
// it are given their new indexes. Sheets are edited at the offsets of their <v> texts, so the rest
// of each sheet stays as it was.
import type { Limits } from '../limits';
import { openPackage } from '../opc/package';
import { partNameToZipName, zipNameToPartName, partKey } from '../opc/part-name';
import { parseRawTree, rawXmlText, type RawElement, type RawNode } from '../xml/raw-tree';
import { normalizeLineEnds } from '../xml/parser';
import { escapeAttr } from '../xml/writer';
import { openZip } from '../zip/reader';
import { writeZip, type ZipWriteEntry } from '../zip/writer';

const SHARED_STRINGS = /\/sharedStrings$/;
const WORKSHEET = /\/worksheet$/;

const elements = (e: RawElement): RawElement[] => e.children.filter((c): c is RawElement => c.kind === 'element');

/** The workbook with its shared strings reduced to those in use; the bytes as they are when nothing changes. */
export function compactSharedStrings(bytes: Uint8Array, limits: Limits): Uint8Array {
  const zip = openZip(bytes, limits);
  const pkg = openPackage(zip, limits);
  const book = pkg.relationships(null).find((r) => !r.external && r.type.endsWith('/officeDocument'));
  if (book === undefined) return bytes;
  const rels = pkg.relationships(book.target);
  const table = rels.find((r) => !r.external && SHARED_STRINGS.test(r.type));
  if (table === undefined || !pkg.hasPart(table.target)) return bytes;
  const sst = parseRawTree(pkg.readXml(table.target) ?? '', { part: table.target, limits });
  const items = elements(sst.root).filter((e) => e.local === 'si');

  // The index of every shared string a cell uses, and where its <v> text is.
  const sheets = rels.filter((r) => !r.external && WORKSHEET.test(r.type) && pkg.hasPart(r.target)).map((r) => r.target);
  const used = new Map<number, number>();
  const edits = new Map<string, { xml: string; at: { start: number; length: number; index: number }[] }>();
  for (const sheet of sheets) {
    // Offsets of the tree are those of the text with normalised line ends.
    const xml = normalizeLineEnds(pkg.readXml(sheet) ?? '');
    const doc = parseRawTree(xml, { part: sheet, limits });
    const at: { start: number; length: number; index: number }[] = [];
    const visit = (e: RawElement): void => {
      if (e.local === 'c' && e.attrs.get('t') === 's') {
        const v = elements(e).find((c) => c.local === 'v');
        const text = v?.children.find((c): c is RawNode & { kind: 'text'; start: number; raw: string; text: string } => c.kind === 'text');
        const index = text === undefined ? NaN : Number(text.text.trim());
        if (text !== undefined && Number.isInteger(index) && index >= 0 && index < items.length) {
          if (!used.has(index)) used.set(index, used.size);
          at.push({ start: text.start, length: text.raw.length, index });
        }
        return;
      }
      for (const c of elements(e)) visit(c);
    };
    visit(doc.root);
    edits.set(partKey(sheet), { xml, at });
  }
  if (used.size === items.length && [...used].every(([from, to]) => from === to)) return bytes;

  // The new table, then each sheet with its indexes replaced from the end, so offsets stay valid.
  const kept = [...used.keys()].map((i) => rawXmlText(items[i] as RawElement));
  const count = [...edits.values()].reduce((n, e) => n + e.at.length, 0);
  const root = sst.root;
  const open = root.open
    .replace(/\s(count|uniqueCount)\s*=\s*(?:"[^"]*"|'[^']*')/g, '')
    .replace(/\s*\/?>$/, ` count="${escapeAttr(String(count))}" uniqueCount="${escapeAttr(String(kept.length))}">`);
  const close = root.close === '' ? `</${root.qname}>` : root.close;
  const changed = new Map<string, string>([[partKey(table.target), `${sst.prolog}${open}${kept.join('')}${close}${sst.epilog}`]]);
  for (const [key, { xml, at }] of edits) {
    if (at.length === 0) continue;
    let out = xml;
    for (const { start, length, index } of [...at].sort((a, b) => b.start - a.start)) out = out.slice(0, start) + String(used.get(index)) + out.slice(start + length);
    changed.set(key, out);
  }
  const encoder = new TextEncoder();
  const entries: ZipWriteEntry[] = zip.entries.map((entry) => {
    const xml = changed.get(partKey(zipNameToPartName(entry.name)));
    if (xml !== undefined) return { name: partNameToZipName(zipNameToPartName(entry.name)) ?? entry.name, data: encoder.encode(xml) };
    const raw = zip.raw(entry);
    return raw === null ? { name: entry.name, data: zip.read(entry) } : { name: entry.name, data: new Uint8Array(0), raw };
  });
  return writeZip(entries);
}
