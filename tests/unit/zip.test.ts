// Copied from DevXord/xlvane tests/unit/zip.test.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes.
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';
import { crc32 } from '../../packages/tplvane/src/zip/crc32';
import { openZip } from '../../packages/tplvane/src/zip/reader';
import { buildZip } from '../helpers/raw-zip';
import { crc32 as zlibCrc32 } from 'node:zlib';

const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (bytes: Uint8Array): string => dec.decode(bytes);

describe('crc32', () => {
  it('matches node:zlib on sample inputs', () => {
    for (const sample of ['', 'a', '123456789', 'x'.repeat(10_000), 'zażółć gęślą jaźń']) {
      const bytes = enc.encode(sample);
      expect(crc32(bytes)).toBe(zlibCrc32(bytes));
    }
  });

  it('can be computed incrementally', () => {
    const bytes = enc.encode('hello, incremental world');
    expect(crc32(bytes.subarray(5), crc32(bytes.subarray(0, 5)))).toBe(zlibCrc32(bytes));
  });
});

describe('openZip', () => {
  it('reads stored and deflated entries', () => {
    const zip = openZip(
      buildZip([
        { name: 'a.txt', data: 'stored content', method: 0 },
        { name: 'dir/b.xml', data: '<b>deflated</b>'.repeat(100) },
      ]),
      DEFAULT_LIMITS,
    );
    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.xml']);
    expect(text(zip.read('a.txt'))).toBe('stored content');
    expect(text(zip.read('dir/b.xml'))).toBe('<b>deflated</b>'.repeat(100));
    expect(zip.bytesRead).toBe(14 + 1500);
  });

  it('reads archives written by fflate', () => {
    const data = zipSync({ 'x/y.txt': enc.encode('fflate'), 'z.txt': enc.encode('second') });
    const zip = openZip(data, DEFAULT_LIMITS);
    expect(text(zip.read('x/y.txt'))).toBe('fflate');
    expect(text(zip.read('z.txt'))).toBe('second');
  });

  it('reads entries that use a data descriptor', () => {
    const zip = openZip(buildZip([{ name: 'd.txt', data: 'with descriptor', dataDescriptor: true }]), DEFAULT_LIMITS);
    expect(text(zip.read('d.txt'))).toBe('with descriptor');
  });

  it('reads ZIP64 archives', () => {
    const zip = openZip(
      buildZip(
        [
          { name: 'a.txt', data: 'sixty-four', zip64: true },
          { name: 'b.txt', data: 'plain' },
        ],
        { zip64: true },
      ),
      DEFAULT_LIMITS,
    );
    expect(text(zip.read('a.txt'))).toBe('sixty-four');
    expect(text(zip.read('b.txt'))).toBe('plain');
  });

  it('reads archives with a comment', () => {
    const zip = openZip(buildZip([{ name: 'a.txt', data: 'x' }], { comment: 'PK\u0005\u0006 looks like a signature' }), DEFAULT_LIMITS);
    expect(text(zip.read('a.txt'))).toBe('x');
  });

  it('decodes UTF-8 names and finds entries case-insensitively', () => {
    const zip = openZip(buildZip([{ name: 'xl/Arkusz-ż.xml', data: 'z' }]), DEFAULT_LIMITS);
    expect(zip.entries[0]?.name).toBe('xl/Arkusz-ż.xml');
    expect(zip.find('XL/arkusz-ż.XML')?.name).toBe('xl/Arkusz-ż.xml');
    expect(zip.find('missing.xml')).toBeUndefined();
  });

  it('opens an empty archive', () => {
    expect(openZip(buildZip([]), DEFAULT_LIMITS).entries).toEqual([]);
  });

  it('keeps names such as __proto__ as plain data', () => {
    const zip = openZip(buildZip([{ name: '__proto__', data: 'p' }, { name: 'constructor', data: 'c' }]), DEFAULT_LIMITS);
    expect(text(zip.read('__proto__'))).toBe('p');
    expect(text(zip.read('constructor'))).toBe('c');
    expect(({} as Record<string, unknown>)['p']).toBeUndefined();
  });
});
