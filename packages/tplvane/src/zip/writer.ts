// Copied from DevXord/xlvane packages/xlvane/src/zip/writer.ts at aeaefbc (unchanged since ada547b),
// adapted for tplvane (D-009): TvError and TV_E_* codes, messages that name no file format.
// Identifiers such as D-202, D-R03, Z-07 or E-58 below refer to the notes of xlvane.
//
// A deterministic ZIP writer for packages that tplvane creates itself (xlvane D-202).
//
// Record layouts follow APPNOTE.TXT 6.3.10: local file header (Z-07), central directory file
// header (Z-05), end of central directory record (Z-02); all fields little-endian (Z-01).
// Entries are written without data descriptors (flag bit 3 clear, Z-09), with method 8 (Deflate)
// when that makes the entry smaller and method 0 (stored) otherwise (Z-10). ZIP64 is not written:
// archives that would need it are refused. Timestamps are fixed so that the same input always
// gives the same bytes.
import { deflateSync } from 'fflate';
import { TvError } from '../errors';
import { crc32 } from './crc32';

/** One file to put into the archive. */
export interface ZipWriteEntry {
  /** Item name; printable ASCII, no leading slash. */
  readonly name: string;
  /** The uncompressed bytes. Ignored when `raw` is given. */
  readonly data: Uint8Array;
  /**
   * Already compressed data copied unchanged from another archive (stored or Deflate), with its
   * CRC-32 and uncompressed size, so that parts an edit does not change are neither inflated nor
   * deflated again (D-R03).
   */
  readonly raw?: ZipRawData;
}

/** The compressed form of an entry, as read from an archive's central directory and data. */
export interface ZipRawData {
  readonly method: 0 | 8;
  readonly crc32: number;
  readonly uncompressedSize: number;
  readonly body: Uint8Array;
}

/** Entries a ZIP without ZIP64 can hold (2-byte entry count in the EOCD, Z-02, Z-04). */
export const MAX_ZIP_ENTRIES = 0xfffe;
/** Largest offset or size a ZIP without ZIP64 can hold (4-byte fields, Z-04). */
const MAX_32 = 0xfffffffe;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** Version 2.0: Deflate (Z-06); upper byte 0 = MS-DOS host. */
const VERSION = 20;
/**
 * MS-DOS date for 1980-01-01: (year - 1980) << 9 | month << 5 | day. APPNOTE only says
 * "standard MS-DOS format" (Z-19); the bit layout is the one fflate writes
 * (node_modules/fflate/esm/index.mjs, zip header writer). Time 00:00:00 is 0.
 */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const encoder = new TextEncoder();

function tooLarge(what: string): TvError {
  return new TvError('TV_E_LIMIT_EXCEEDED', `The document is too large to write: ${what}.`, {
    hint: 'Split the data into several documents. Writing ZIP64 archives is not supported yet.',
    details: { limit: 'zip32' },
  });
}

/**
 * Writes a ZIP archive. Throws `TV_E_INVALID_INPUT` for names that are not printable ASCII or
 * that repeat (ignoring case, as OPC requires, E-58), and `TV_E_LIMIT_EXCEEDED` when the
 * archive would need ZIP64. `level` is the Deflate level 0–9 (0 stores every entry).
 */
export function writeZip(entries: readonly ZipWriteEntry[], level = 6): Uint8Array {
  if (entries.length > MAX_ZIP_ENTRIES) throw tooLarge(`${String(entries.length)} parts`);
  const seen = new Set<string>();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name;
    if (!/^[\x21-\x7e][\x20-\x7e]*$/.test(name) || name.startsWith('/') || name.length > 0xffff) {
      throw new TvError('TV_E_INVALID_INPUT', `"${name.slice(0, 60)}" is not a valid ZIP item name.`, {
        hint: 'Item names must be printable ASCII without a leading slash. This is an internal error; please report it.',
        details: { name: name.slice(0, 60) },
      });
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new TvError('TV_E_INVALID_INPUT', `The ZIP item name "${name.slice(0, 60)}" is used twice.`, {
        hint: 'Item names must be unique ignoring case. This is an internal error; please report it.',
        details: { name: name.slice(0, 60) },
      });
    }
    seen.add(key);

    const nameBytes = encoder.encode(name);
    let crc: number;
    let body: Uint8Array;
    let method: number;
    let size: number;
    if (entry.raw !== undefined) {
      ({ crc32: crc, body, method, uncompressedSize: size } = entry.raw);
    } else {
      crc = crc32(entry.data);
      // Level 0 stores every entry (method 0); other levels deflate when that makes the entry smaller.
      const deflated = entry.data.length === 0 || level === 0 ? null : deflateSync(entry.data, { level: level as 1 });
      const useDeflate = deflated !== null && deflated.length < entry.data.length;
      body = useDeflate ? deflated : entry.data;
      method = useDeflate ? 8 : 0;
      size = entry.data.length;
    }
    if (size > MAX_32 || body.length > MAX_32 || offset > MAX_32) throw tooLarge('more than 4 GiB');

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    // extra length, comment length, disk number, internal and external attributes stay 0
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    chunks.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }

  const cdOffset = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  if (cdOffset > MAX_32 || cdOffset + cdSize > MAX_32) throw tooLarge('more than 4 GiB');
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const out = new Uint8Array(cdOffset + cdSize + eocd.length);
  let pos = 0;
  for (const part of [...chunks, ...central, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
