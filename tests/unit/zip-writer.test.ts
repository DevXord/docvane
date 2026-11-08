// Copied from DevXord/xlvane tests/unit/zip-writer.test.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes.
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';
import { openZip } from '../../packages/tplvane/src/zip/reader';
import { MAX_ZIP_ENTRIES, writeZip } from '../../packages/tplvane/src/zip/writer';
import { expectDvError } from '../helpers/expect-error';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('writeZip', () => {
  const entries = [
    { name: '[Content_Types].xml', data: enc.encode('<Types/>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode('<row/>'.repeat(5000)) },
    { name: 'empty.bin', data: new Uint8Array(0) },
  ];

  it('produces an archive that the strict reader accepts', () => {
    const zip = openZip(writeZip(entries), DEFAULT_LIMITS);
    expect(zip.entries.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const e of entries) expect(zip.read(e.name)).toEqual(e.data);
  });

  it('produces an archive that fflate accepts', () => {
    const out = unzipSync(writeZip(entries));
    expect(dec.decode(out['xl/worksheets/sheet1.xml'])).toBe('<row/>'.repeat(5000));
  });

  it('is deterministic', () => {
    expect(writeZip(entries)).toEqual(writeZip(entries));
  });

  it('deflates compressible data and stores data that does not shrink', () => {
    const zip = openZip(writeZip(entries), DEFAULT_LIMITS);
    expect(zip.find('xl/worksheets/sheet1.xml')?.method).toBe(8);
    expect(zip.find('empty.bin')?.method).toBe(0);
  });

  it('writes the fixed timestamp 1980-01-01 00:00 and no flags', () => {
    const bytes = writeZip([entries[0]!]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0); // flags
    expect(view.getUint16(10, true)).toBe(0); // time
    expect(view.getUint16(12, true)).toBe(0x21); // date: day 1, month 1, year 1980
  });

  it('rejects non-ASCII and duplicate names', () => {
    expectDvError(() => writeZip([{ name: 'ż.xml', data: new Uint8Array(1) }]), 'TV_E_INVALID_INPUT');
    expectDvError(
      () => writeZip([{ name: 'a.xml', data: new Uint8Array(1) }, { name: 'A.xml', data: new Uint8Array(1) }]),
      'TV_E_INVALID_INPUT',
    );
  });

  it('refuses more entries than a ZIP without ZIP64 can hold', () => {
    const many = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ name: `f${String(i)}`, data: new Uint8Array(0) }));
    expectDvError(() => writeZip(many), 'TV_E_LIMIT_EXCEEDED');
  });
});
