// Copied from DevXord/xlvane tests/helpers/raw-zip.ts, at aeaefbc, adapted for
// docvane (D-009): imports, DvError and DV_E_* codes.
// Builds ZIP archives byte by byte, including deliberately broken or hostile ones.
// Compression and CRC-32 come from node:zlib, so the tests do not rely on the code under test.
// Layouts follow APPNOTE.TXT 6.3.10 sections 4.3.7 (local header), 4.3.12 (central directory),
// 4.3.14-4.3.16 (ZIP64 and end of central directory) - see the Z-* notes of xlvane.
import { crc32, deflateRawSync } from 'node:zlib';

export interface RawEntry {
  name: string;
  /** Uncompressed content. */
  data: Uint8Array | string;
  /** 0 = stored, 8 = deflated (default), anything else is written as is. */
  method?: number;
  /** Replaces the compressed bytes. */
  compressed?: Uint8Array;
  /** General purpose bit flags. Bit 11 (UTF-8 names) is added automatically for non-ASCII names. */
  flags?: number;
  /** Replaces the CRC-32 in both headers. */
  crc?: number;
  /** Replaces the uncompressed size in both headers. */
  declaredSize?: number;
  /** Replaces the compressed size in both headers. */
  declaredCompressedSize?: number;
  /** Name written in the local header (default: `name`). */
  localName?: string;
  /** Writes sizes and offset through the ZIP64 extended information extra field. */
  zip64?: boolean;
  /** Replaces the local header offset in the central directory (e.g. to make entries overlap). */
  localOffset?: number;
  /** Disk number start in the central directory. */
  diskStart?: number;
  /** Writes sizes as zero in the local header and appends a data descriptor (flag bit 3). */
  dataDescriptor?: boolean;
}

export interface RawZipOptions {
  comment?: string;
  /** Writes a ZIP64 end of central directory record and locator. */
  zip64?: boolean;
  /** Replaces "number of this disk" in the end of central directory record. */
  diskNumber?: number;
  /** Replaces both entry counts in the end of central directory record. */
  entryCount?: number;
  /** Replaces the central directory offset in the end of central directory record. */
  centralOffset?: number;
  /** Bytes inserted before the first local header. */
  prefix?: Uint8Array;
  /** Bytes appended after the end of central directory record. */
  suffix?: Uint8Array;
}

const enc = new TextEncoder();

function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? enc.encode(data) : data;
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  u8(v: number): this {
    return this.raw(new Uint8Array([v & 0xff]));
  }
  u16(v: number): this {
    return this.raw(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number): this {
    return this.raw(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  u64(v: number): this {
    return this.u32(v % 0x1_0000_0000).u32(Math.floor(v / 0x1_0000_0000));
  }
  raw(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

export function deflate(data: Uint8Array | string, level = 9): Uint8Array {
  return new Uint8Array(deflateRawSync(bytesOf(data), { level }));
}

export function buildZip(entries: RawEntry[], options: RawZipOptions = {}): Uint8Array {
  const w = new Writer();
  if (options.prefix) w.raw(options.prefix);
  const central = new Writer();
  for (const entry of entries) {
    const data = bytesOf(entry.data);
    const method = entry.method ?? 8;
    const compressed = entry.compressed ?? (method === 8 ? deflate(data) : data);
    const nameBytes = enc.encode(entry.name);
    const localNameBytes = enc.encode(entry.localName ?? entry.name);
    // eslint-disable-next-line no-control-regex
    const utf8 = /[^\x00-\x7f]/.test(entry.name) ? 0x0800 : 0;
    const flags = (entry.flags ?? 0) | utf8 | (entry.dataDescriptor ? 0x0008 : 0);
    const crc = entry.crc ?? crc32(data);
    const size = entry.declaredSize ?? data.length;
    const csize = entry.declaredCompressedSize ?? compressed.length;
    const offset = w.length;

    const zip64Extra = new Writer();
    if (entry.zip64) zip64Extra.u16(0x0001).u16(24).u64(size).u64(csize).u64(offset);

    // Local file header (APPNOTE 4.3.7)
    w.u32(0x04034b50).u16(entry.zip64 ? 45 : 20).u16(flags).u16(method).u16(0).u16(0x21);
    if (entry.dataDescriptor) w.u32(0).u32(0).u32(0);
    else w.u32(crc).u32(entry.zip64 ? 0xffffffff : csize).u32(entry.zip64 ? 0xffffffff : size);
    const localExtra = entry.zip64 ? new Writer().u16(0x0001).u16(16).u64(size).u64(csize).bytes() : new Uint8Array();
    w.u16(localNameBytes.length).u16(localExtra.length).raw(localNameBytes).raw(localExtra);
    w.raw(compressed);
    if (entry.dataDescriptor) w.u32(0x08074b50).u32(crc).u32(csize).u32(size);

    // Central directory file header (APPNOTE 4.3.12)
    const extra = zip64Extra.bytes();
    central
      .u32(0x02014b50)
      .u16(entry.zip64 ? 45 : 20)
      .u16(entry.zip64 ? 45 : 20)
      .u16(flags)
      .u16(method)
      .u16(0)
      .u16(0x21)
      .u32(crc)
      .u32(entry.zip64 ? 0xffffffff : csize)
      .u32(entry.zip64 ? 0xffffffff : size)
      .u16(nameBytes.length)
      .u16(extra.length)
      .u16(0)
      .u16(entry.diskStart ?? 0)
      .u16(0)
      .u32(0)
      .u32(entry.zip64 ? 0xffffffff : (entry.localOffset ?? offset))
      .raw(nameBytes)
      .raw(extra);
  }
  const centralBytes = central.bytes();
  const centralOffset = options.centralOffset ?? w.length;
  w.raw(centralBytes);
  const count = options.entryCount ?? entries.length;
  const comment = enc.encode(options.comment ?? '');
  if (options.zip64) {
    const zip64EocdOffset = w.length;
    // ZIP64 end of central directory record (APPNOTE 4.3.14) and locator (4.3.15)
    w.u32(0x06064b50).u64(44).u16(45).u16(45).u32(options.diskNumber ?? 0).u32(0);
    w.u64(count).u64(count).u64(centralBytes.length).u64(centralOffset);
    w.u32(0x07064b50).u32(0).u64(zip64EocdOffset).u32(1);
  }
  // End of central directory record (APPNOTE 4.3.16)
  w.u32(0x06054b50)
    .u16(options.zip64 ? 0xffff : (options.diskNumber ?? 0))
    .u16(0)
    .u16(options.zip64 ? 0xffff : count)
    .u16(options.zip64 ? 0xffff : count)
    .u32(options.zip64 ? 0xffffffff : centralBytes.length)
    .u32(options.zip64 ? 0xffffffff : centralOffset)
    .u16(comment.length)
    .raw(comment);
  if (options.suffix) w.raw(options.suffix);
  return w.bytes();
}
