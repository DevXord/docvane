// Copied from DevXord/xlvane packages/xlvane/src/zip/reader.ts at aeaefbc (unchanged since ada547b),
// adapted for tplvane (D-009): TvError and TV_E_* codes, messages that name no file format, and
// `raw` required in ZipReader, and an entry read again counted once against maxTotalBytes. Identifiers such as D-102, W-07, Z-02 or E-58 below refer to the
// notes of xlvane.
//
// A strict ZIP reader for untrusted input (xlvane D-102).
//
// The central directory is parsed here; only DEFLATE decompression is delegated to fflate.
// Limits are enforced on the bytes actually produced by the decompressor, never on sizes
// declared in headers, because headers can lie (xlvane W-07). Record layouts follow APPNOTE.TXT
// 6.3.10 (Z-02 … Z-16).
import { Inflate } from 'fflate';
import { TvError, type TvDetails } from '../errors';
import type { ReadLimits } from '../limits';
import { decodeCp437 } from './cp437';
import { crc32 } from './crc32';

/** One entry of the central directory, after validation. */
export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Offset of the local file header. */
  readonly headerOffset: number;
  /** Offset of the first byte of entry data. */
  readonly dataOffset: number;
}

/** An opened archive. Entries are decompressed on demand by {@link ZipReader.read}. */
export interface ZipReader {
  readonly entries: readonly ZipEntry[];
  /** Finds an entry by name; names are compared case-insensitively (E-58). */
  find(name: string): ZipEntry | undefined;
  /** Decompresses an entry and verifies its size and CRC-32. */
  read(entry: ZipEntry | string): Uint8Array;
  /** Total number of decompressed bytes returned so far. */
  readonly bytesRead: number;
  /**
   * The compressed bytes of a stored or Deflate entry as they are in the archive, without
   * inflating them, or `null` when they cannot be copied as they are (D-R03).
   */
  raw(entry: ZipEntry): { readonly method: 0 | 8; readonly crc32: number; readonly uncompressedSize: number; readonly body: Uint8Array } | null;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const CENTRAL_SIZE = 46;
export const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const FLAG_CENTRAL_ENCRYPTED = 0x2000;
export const METHOD_STORED = 0;
export const METHOD_DEFLATE = 8;
/** Compressed bytes handed to the decompressor at a time; bounds the overshoot past a limit. */
const INFLATE_CHUNK = 8 * 1024;
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export const CORRUPT_HINT =
  'The file is damaged or is not a valid Office document. Re-save it in the application that made it or ask the sender for a new copy.';

export function corrupt(message: string, reason: string, offset?: number, extra: TvDetails = {}): TvError {
  return new TvError('TV_E_ZIP_CORRUPT', message, {
    location: offset === undefined ? {} : { offset },
    hint: CORRUPT_HINT,
    details: { reason, ...extra },
  });
}

export function unsupported(message: string, reason: string, hint: string, name?: string): TvError {
  return new TvError('TV_E_ZIP_UNSUPPORTED', message, {
    location: name === undefined ? {} : { part: `/${name}` },
    hint,
    details: { reason },
  });
}

export function limitExceeded(limit: keyof ReadLimits, value: number, message: string, name?: string): TvError {
  return new TvError('TV_E_LIMIT_EXCEEDED', message, {
    location: name === undefined ? {} : { part: `/${name}` },
    hint: `If you trust this file, raise the limit, for example { limits: { ${limit}: ${String(value * 4)} } }.`,
    details: { limit, value },
  });
}

/** Thrown by {@link Bytes} when a byte outside the loaded segments is read (streaming sources only). */
export class NotLoaded extends Error {
  constructor(
    readonly start: number,
    readonly end: number,
  ) {
    super(`Bytes ${String(start)}…${String(end)} are not loaded.`);
  }
}

interface Segment {
  readonly start: number;
  readonly data: Uint8Array;
}

const segmentEnd = (segment: Segment): number => segment.start + segment.data.length;

/**
 * Little-endian access to a file of `size` bytes, of which only some segments may be in memory
 * (all of it for `openZip`; the tail, the central directory and local headers for streaming
 * sources). Offsets are absolute.
 */
export class Bytes {
  /** Loaded segments in order of `start` (equal starts in order of addition). */
  private readonly segments: Segment[] = [];
  /**
   * For each index i, the segment with the largest end among segments[0..i]. A range is loaded
   * exactly when that segment, for the last i whose start is at or before the range's start,
   * reaches its end; so a lookup is one binary search (D-H01).
   */
  private readonly reach: Segment[] = [];
  private last: Segment | undefined;

  constructor(
    readonly size: number,
    segments: readonly Segment[],
  ) {
    for (const segment of segments) this.add(segment.start, segment.data);
  }

  static of(data: Uint8Array): Bytes {
    return new Bytes(data.length, [{ start: 0, data }]);
  }

  add(start: number, data: Uint8Array): void {
    const segment = { start, data };
    const at = this.upperBound(start);
    this.segments.splice(at, 0, segment);
    this.reach.splice(at, 0, segment);
    // Segments are mostly added in increasing order, so this loop is usually short.
    for (let i = at; i < this.segments.length; i++) {
      const own = this.segments[i] as Segment;
      const before = i === 0 ? undefined : (this.reach[i - 1] as Segment);
      this.reach[i] = before !== undefined && segmentEnd(before) >= segmentEnd(own) ? before : own;
    }
    this.last = segment;
  }

  /** Whether `[start, end)` is fully inside one loaded segment. */
  has(start: number, end: number): boolean {
    return this.find(start, end) !== undefined;
  }

  /** The number of segments whose start is at or before `start`. */
  private upperBound(start: number): number {
    let lo = 0;
    let hi = this.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.segments[mid] as Segment).start <= start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private find(start: number, stop: number): Segment | undefined {
    const last = this.last;
    if (last && start >= last.start && stop <= segmentEnd(last)) return last;
    const i = this.upperBound(start) - 1;
    if (i < 0) return undefined;
    const seg = this.reach[i] as Segment;
    if (stop > segmentEnd(seg)) return undefined;
    this.last = seg;
    return seg;
  }

  /** The bytes `[start, end)`; throws {@link NotLoaded} if they are not in memory. */
  slice(start: number, end: number): Uint8Array {
    if (end <= start) return new Uint8Array(0);
    const seg = this.find(start, end);
    if (seg === undefined) throw new NotLoaded(start, end);
    return seg.data.subarray(start - seg.start, end - seg.start);
  }

  byte(at: number): number {
    if (at < 0 || at >= this.size) return 0;
    const seg = this.find(at, at + 1);
    if (seg === undefined) throw new NotLoaded(at, at + 1);
    return seg.data[at - seg.start] as number;
  }

  u16(at: number): number {
    return this.byte(at) | (this.byte(at + 1) << 8);
  }
  u32(at: number): number {
    return (this.u16(at) | (this.u16(at + 2) << 16)) >>> 0;
  }
  /** Reads a 64-bit value; rejects values above Number.MAX_SAFE_INTEGER. */
  u64(at: number): number {
    const value = this.u32(at) + this.u32(at + 4) * 0x1_0000_0000;
    if (!Number.isSafeInteger(value)) throw corrupt('A ZIP64 field holds an impossibly large value.', 'zip64-value', at);
    return value;
  }
}

/**
 * Opens a ZIP archive held in memory and validates its structure. Throws
 * `TV_E_NOT_ZIP`, `TV_E_UNSUPPORTED_CONTAINER`, `TV_E_ZIP_CORRUPT`,
 * `TV_E_ZIP_UNSUPPORTED` or `TV_E_LIMIT_EXCEEDED`.
 */
export function openZip(data: Uint8Array, limits: ReadLimits): ZipReader {
  checkSource(data.length, data.subarray(0, CFB_SIGNATURE.length), limits);
  const b = Bytes.of(data);
  const dir = locateCentralDirectory(b, limits);
  const entries = readCentralDirectory(b, dir.centralOffset, dir.centralLimit, dir.entryCount);
  validateLocalHeaders(b, entries, dir.centralOffset);
  return new Reader(b, entries, limits);
}

/** Bytes needed at the end of a file to find the end record and a directly preceding ZIP64 locator. */
export const TAIL_BYTES: number = EOCD_SIZE + MAX_COMMENT + ZIP64_LOCATOR_SIZE;
/** Bytes needed at the start of a file to recognise CFB containers and local headers. */
export const HEAD_BYTES: number = CFB_SIGNATURE.length;

/** Input size limit and CFB detection, from the size and the first bytes of the input. */
export function checkSource(size: number, head: Uint8Array, limits: ReadLimits): void {
  if (size > limits.maxInputBytes) {
    throw limitExceeded('maxInputBytes', limits.maxInputBytes, `The input is ${size} bytes, more than the limit.`);
  }
  if (CFB_SIGNATURE.every((b, i) => head[i] === b)) {
    throw new TvError('TV_E_UNSUPPORTED_CONTAINER', 'The file is a Compound File Binary container, not a ZIP-based Office document.', {
      hint: 'This is either a legacy binary file (.doc, .ppt, .xls) or a password-protected (encrypted) document. Open it in its application and save it without a password in the current format (.docx, .pptx, .xlsx).',
    });
  }
}

/** Where the central directory is, from the end record (and the ZIP64 records). */
export interface CentralDirectoryLocation {
  readonly centralOffset: number;
  readonly centralSize: number;
  /** Where the structures that follow the central directory begin. */
  readonly centralLimit: number;
  readonly entryCount: number;
}

/**
 * Finds and checks the end of central directory record (and the ZIP64 record and locator).
 * Needs the tail of the file loaded (and the ZIP64 record, which may lie before the tail).
 */
export function locateCentralDirectory(b: Bytes, limits: ReadLimits): CentralDirectoryLocation {
  const eocd = findEndOfCentralDirectory(b);

  let thisDisk = b.u16(eocd + 4);
  let centralDisk = b.u16(eocd + 6);
  let entriesOnDisk = b.u16(eocd + 8);
  let entryCount = b.u16(eocd + 10);
  let centralSize = b.u32(eocd + 12);
  let centralOffset = b.u32(eocd + 16);
  /** Where the structures that follow the central directory begin. */
  let centralLimit = eocd;

  const zip64 =
    thisDisk === 0xffff ||
    centralDisk === 0xffff ||
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff;
  if (zip64) {
    const locator = eocd - ZIP64_LOCATOR_SIZE;
    if (locator < 0 || b.u32(locator) !== SIG_ZIP64_LOCATOR) {
      throw corrupt('The ZIP64 end of central directory locator is missing.', 'zip64-locator', eocd);
    }
    if (b.u32(locator + 4) !== 0 || b.u32(locator + 16) !== 1) {
      throw unsupported('The archive spans several disks.', 'multi-disk', 'Multi-volume ZIP archives are not supported. Save the document as a single file.');
    }
    const record = b.u64(locator + 8);
    if (record + 56 > locator || b.u32(record) !== SIG_ZIP64_EOCD) {
      throw corrupt('The ZIP64 end of central directory record is missing.', 'zip64-record', record);
    }
    thisDisk = b.u32(record + 16);
    centralDisk = b.u32(record + 20);
    entriesOnDisk = b.u64(record + 24);
    entryCount = b.u64(record + 32);
    centralSize = b.u64(record + 40);
    centralOffset = b.u64(record + 48);
    centralLimit = record;
  }

  if (thisDisk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw unsupported('The archive spans several disks.', 'multi-disk', 'Multi-volume ZIP archives are not supported. Save the document as a single file.');
  }
  if (entryCount > limits.maxEntries) {
    throw limitExceeded('maxEntries', limits.maxEntries, `The archive has ${entryCount} entries, more than the limit.`);
  }
  if (centralOffset + centralSize !== centralLimit) {
    throw corrupt('The central directory is not where the end of central directory record says.', 'central-directory-bounds', centralOffset);
  }
  return { centralOffset, centralSize, centralLimit, entryCount };
}

/**
 * Finds the end of central directory record by scanning backwards. The record must end the
 * file exactly (its comment runs to the last byte); data after it is rejected. APPNOTE does not
 * define a search algorithm (Z-03), so this reader picks the strictest one.
 */
function findEndOfCentralDirectory(b: Bytes): number {
  const size = b.size;
  const lowest = Math.max(0, size - EOCD_SIZE - MAX_COMMENT);
  const data = b.slice(lowest, size);
  for (let at = size - EOCD_SIZE; at >= lowest; at--) {
    const i = at - lowest;
    if (data[i] === 0x50 && data[i + 1] === 0x4b && b.u32(at) === SIG_EOCD) {
      if (at + EOCD_SIZE + b.u16(at + 20) === size) return at;
    }
  }
  if (size >= 4 && b.u32(0) === SIG_LOCAL) {
    throw corrupt('The end of the ZIP archive is missing; the file is probably truncated.', 'eocd-missing');
  }
  if (size >= EOCD_SIZE && data.indexOf(0x50) !== -1 && containsSignature(data, 0)) {
    throw corrupt('The end of central directory record is followed by unexpected data.', 'trailing-data');
  }
  throw new TvError('TV_E_NOT_ZIP', 'The input is not a ZIP archive, so it cannot be an Office document.', {
    hint: 'DOCX, PPTX and XLSX files are ZIP archives. Check that the file is a .docx, .pptx or .xlsx document and not a legacy, PDF or text file.',
  });
}

function containsSignature(data: Uint8Array, from: number): boolean {
  for (let at = data.length - 4; at >= from; at--) {
    if (data[at] === 0x50 && data[at + 1] === 0x4b && data[at + 2] === 0x05 && data[at + 3] === 0x06) return true;
  }
  return false;
}

export interface RawEntry extends ZipEntry {
  readonly nameBytes: Uint8Array;
}

export function readCentralDirectory(b: Bytes, start: number, end: number, count: number): RawEntry[] {
  const entries: RawEntry[] = [];
  const seen = new Map<string, string>();
  let p = start;
  for (let i = 0; i < count; i++) {
    if (p + CENTRAL_SIZE > end || b.u32(p) !== SIG_CENTRAL) {
      throw corrupt('A central directory entry is missing or damaged.', 'central-directory-entry', p);
    }
    const flags = b.u16(p + 8);
    const method = b.u16(p + 10);
    const crc = b.u32(p + 16);
    let compressedSize = b.u32(p + 20);
    let uncompressedSize = b.u32(p + 24);
    const nameLength = b.u16(p + 28);
    const extraLength = b.u16(p + 30);
    const commentLength = b.u16(p + 32);
    let diskStart = b.u16(p + 34);
    let headerOffset = b.u32(p + 42);
    const next = p + CENTRAL_SIZE + nameLength + extraLength + commentLength;
    if (next > end) throw corrupt('A central directory entry runs past the end of the directory.', 'central-directory-entry', p);
    const nameBytes = b.slice(p + CENTRAL_SIZE, p + CENTRAL_SIZE + nameLength);
    const name = decodeName(nameBytes, flags, p);

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_CENTRAL_ENCRYPTED) || method === 99) {
      throw unsupported(
        `ZIP entry "${name}" is encrypted.`,
        'encrypted',
        'Encrypted ZIP entries are not supported. Save the document again without ZIP encryption.',
        name,
      );
    }

    // ZIP64 extended information extra field (APPNOTE 4.5.3, Z-13): fields appear in a
    // fixed order, and only for the header fields that hold the 0xFFFF / 0xFFFFFFFF sentinel.
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || headerOffset === 0xffffffff || diskStart === 0xffff) {
      const zip64 = findExtraField(b, p + CENTRAL_SIZE + nameLength, extraLength, 0x0001);
      if (zip64 === null) throw corrupt(`ZIP entry "${name}" lacks its ZIP64 extra field.`, 'zip64-extra', p);
      let q = zip64.start;
      const take = (size: number): number => {
        if (q + size > zip64.end) throw corrupt(`The ZIP64 extra field of "${name}" is too short.`, 'zip64-extra', p);
        const value = size === 8 ? b.u64(q) : b.u32(q);
        q += size;
        return value;
      };
      if (uncompressedSize === 0xffffffff) uncompressedSize = take(8);
      if (compressedSize === 0xffffffff) compressedSize = take(8);
      if (headerOffset === 0xffffffff) headerOffset = take(8);
      if (diskStart === 0xffff) diskStart = take(4);
    } else {
      // Validate the framing of the extra field even when nothing in it is needed.
      findExtraField(b, p + CENTRAL_SIZE + nameLength, extraLength, -1);
    }
    if (diskStart !== 0) {
      throw unsupported('The archive spans several disks.', 'multi-disk', 'Multi-volume ZIP archives are not supported. Save the document as a single file.');
    }

    const key = name.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw corrupt(`The archive contains two entries named "${previous}" and "${name}".`, 'duplicate-name', p, { name });
    }
    seen.set(key, name);
    entries.push({ name, nameBytes, method, flags, crc32: crc, compressedSize, uncompressedSize, headerOffset, dataOffset: 0 });
    p = next;
  }
  if (p !== end) throw corrupt('The central directory size does not match its entries.', 'central-directory-size', p);
  return entries;
}

function decodeName(bytes: Uint8Array, flags: number, at: number): string {
  if (flags & FLAG_UTF8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw corrupt('A ZIP entry name is not valid UTF-8.', 'name-encoding', at);
    }
  }
  return decodeCp437(bytes);
}

/** Walks the extra field blocks (APPNOTE 4.5.1) and returns the data range of block `id`. */
function findExtraField(b: Bytes, start: number, length: number, id: number): { start: number; end: number } | null {
  const end = start + length;
  let found: { start: number; end: number } | null = null;
  for (let q = start; q < end; ) {
    if (q + 4 > end) throw corrupt('A ZIP extra field is damaged.', 'extra-field', q);
    const blockId = b.u16(q);
    const size = b.u16(q + 2);
    if (q + 4 + size > end) throw corrupt('A ZIP extra field is damaged.', 'extra-field', q);
    if (blockId === id && found === null) found = { start: q + 4, end: q + 4 + size };
    q += 4 + size;
  }
  return found;
}

/**
 * Checks each local file header against its central directory entry and rejects archives in
 * which entries overlap each other or the central directory (the "better zip bomb" technique,
 * W-06, W-07). Fills in the data offsets.
 */
export function validateLocalHeaders(b: Bytes, entries: RawEntry[], centralOffset: number): void {
  const spans: { start: number; end: number; entry: RawEntry; index: number }[] = [];
  entries.forEach((entry, index) => {
    const at = entry.headerOffset;
    if (at + LOCAL_SIZE > centralOffset || b.u32(at) !== SIG_LOCAL) {
      throw corrupt(`The local header of "${entry.name}" is missing or damaged.`, 'local-header', at, { name: entry.name });
    }
    const dataOffset = at + LOCAL_SIZE + b.u16(at + 26) + b.u16(at + 28);
    const end = dataOffset + entry.compressedSize;
    if (end > centralOffset) {
      throw corrupt(`The data of "${entry.name}" runs into the central directory.`, 'entry-bounds', at, { name: entry.name });
    }
    spans.push({ start: at, end, entry, index });
  });
  spans.sort((x, y) => x.start - y.start);
  // Data in front of the first entry (as in self-extracting archives or polyglot files) is
  // rejected: an OOXML package starts with a local file header.
  const first = spans[0];
  if (first !== undefined && first.start !== 0) {
    throw corrupt('The archive does not start with a ZIP entry.', 'leading-data', 0);
  }
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const cur = spans[i];
    if (prev !== undefined && cur !== undefined && cur.start < prev.end) {
      throw corrupt(
        `ZIP entries "${prev.entry.name}" and "${cur.entry.name}" overlap.`,
        'overlapping-entries',
        cur.start,
        { name: cur.entry.name },
      );
    }
  }
  for (const span of spans) {
    const { entry } = span;
    const at = entry.headerOffset;
    const nameLength = b.u16(at + 26);
    const localName = b.slice(at + LOCAL_SIZE, at + LOCAL_SIZE + nameLength);
    if (!sameBytes(localName, entry.nameBytes) || b.u16(at + 8) !== entry.method) {
      throw corrupt(`The local header of "${entry.name}" does not match the central directory.`, 'local-header-mismatch', at, {
        name: entry.name,
      });
    }
    entries[span.index] = { ...entry, dataOffset: at + LOCAL_SIZE + nameLength + b.u16(at + 28) };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

class Reader implements ZipReader {
  readonly entries: readonly ZipEntry[];
  private readonly byName: Map<string, ZipEntry>;
  bytesRead = 0;

  constructor(
    private readonly b: Bytes,
    entries: RawEntry[],
    private readonly limits: ReadLimits,
  ) {
    this.entries = entries.map(({ nameBytes: _nameBytes, ...entry }) => entry);
    this.byName = new Map(this.entries.map((e) => [e.name.toLowerCase(), e]));
  }

  find(name: string): ZipEntry | undefined {
    return this.byName.get(name.toLowerCase());
  }

  raw(entry: ZipEntry): { readonly method: 0 | 8; readonly crc32: number; readonly uncompressedSize: number; readonly body: Uint8Array } | null {
    if (entry.method === METHOD_STORED && entry.compressedSize === entry.uncompressedSize) {
      return { method: 0, crc32: entry.crc32, uncompressedSize: entry.uncompressedSize, body: this.b.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize) };
    }
    if (entry.method === METHOD_DEFLATE) {
      return { method: 8, crc32: entry.crc32, uncompressedSize: entry.uncompressedSize, body: this.b.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize) };
    }
    return null;
  }

  read(entryOrName: ZipEntry | string): Uint8Array {
    const entry = typeof entryOrName === 'string' ? this.find(entryOrName) : entryOrName;
    if (entry === undefined) {
      throw new TvError('TV_E_PART_MISSING', `The archive has no entry "${String(entryOrName)}".`, {
        location: { part: `/${String(entryOrName)}` },
        hint: 'The document is incomplete. Re-save it in the application that made it.',
      });
    }
    const { limits } = this;
    // An entry read again counts once against maxTotalBytes (tplvane reads some parts twice, D-071).
    const counted = this.counted.has(entry);
    const base = counted ? this.bytesRead - entry.uncompressedSize : this.bytesRead;
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw limitExceeded('maxEntryBytes', limits.maxEntryBytes, `ZIP entry "${entry.name}" declares ${entry.uncompressedSize} bytes, more than the limit.`, entry.name);
    }
    if (base + entry.uncompressedSize > limits.maxTotalBytes) {
      throw limitExceeded('maxTotalBytes', limits.maxTotalBytes, 'The decompressed parts of the file are larger than the limit.', entry.name);
    }
    const compressed = this.b.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    let out: Uint8Array;
    if (entry.method === METHOD_STORED) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw corrupt(`Stored ZIP entry "${entry.name}" has inconsistent sizes.`, 'size-mismatch', entry.headerOffset, { name: entry.name });
      }
      out = compressed;
    } else if (entry.method === METHOD_DEFLATE) {
      out = this.inflate(entry, compressed, base);
    } else {
      throw unsupported(
        `ZIP entry "${entry.name}" uses compression method ${entry.method}.`,
        'compression-method',
        'Only stored and Deflate-compressed entries are supported. Re-save the document in the application that made it.',
        entry.name,
      );
    }
    if (out.length !== entry.uncompressedSize) {
      throw corrupt(`ZIP entry "${entry.name}" is ${out.length} bytes, but its header says ${entry.uncompressedSize}.`, 'size-mismatch', entry.headerOffset, {
        name: entry.name,
      });
    }
    if (crc32(out) !== entry.crc32) {
      throw corrupt(`ZIP entry "${entry.name}" failed its CRC-32 check.`, 'crc-mismatch', entry.headerOffset, { name: entry.name });
    }
    if (!counted) {
      this.bytesRead += out.length;
      this.counted.add(entry);
    }
    return out;
  }

  private readonly counted = new Set<ZipEntry>();

  private inflate(entry: ZipEntry, compressed: Uint8Array, base: number): Uint8Array {
    const { limits } = this;
    const chunks: Uint8Array[] = [];
    let produced = 0;
    let ended = false;
    const inflater = new Inflate();
    inflater.ondata = (chunk: Uint8Array, final: boolean) => {
      produced += chunk.length;
      if (produced > limits.maxEntryBytes) {
        throw limitExceeded('maxEntryBytes', limits.maxEntryBytes, `ZIP entry "${entry.name}" decompresses to more than the limit.`, entry.name);
      }
      if (base + produced > limits.maxTotalBytes) {
        throw limitExceeded('maxTotalBytes', limits.maxTotalBytes, 'The decompressed parts of the file are larger than the limit.', entry.name);
      }
      if (produced > limits.compressionRatioMinBytes && produced / Math.max(1, entry.compressedSize) > limits.maxCompressionRatio) {
        throw limitExceeded(
          'maxCompressionRatio',
          limits.maxCompressionRatio,
          `ZIP entry "${entry.name}" expands more than ${String(limits.maxCompressionRatio)} times, which is typical of a zip bomb.`,
          entry.name,
        );
      }
      if (chunk.length > 0) chunks.push(chunk);
      if (final) ended = true;
    };
    try {
      if (compressed.length === 0) inflater.push(compressed, true);
      for (let at = 0; at < compressed.length; at += INFLATE_CHUNK) {
        inflater.push(compressed.subarray(at, at + INFLATE_CHUNK), at + INFLATE_CHUNK >= compressed.length);
      }
    } catch (error) {
      if (error instanceof TvError) throw error;
      throw new TvError('TV_E_ZIP_CORRUPT', `ZIP entry "${entry.name}" is not a valid Deflate stream.`, {
        location: { part: `/${entry.name}`, offset: entry.headerOffset },
        hint: CORRUPT_HINT,
        details: { reason: 'deflate', name: entry.name },
        cause: error,
      });
    }
    if (!ended) throw corrupt(`ZIP entry "${entry.name}" ends early.`, 'deflate', entry.headerOffset, { name: entry.name });
    if (chunks.length === 1) return chunks[0] as Uint8Array;
    const out = new Uint8Array(produced);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}
