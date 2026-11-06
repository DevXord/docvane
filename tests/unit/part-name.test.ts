// partNameToZipName, added in docvane to the part name code copied from xlvane (xlvane D-008 gap 3,
// option A): the inverse of zipNameToPartName, so that a template whose parts have non-ASCII
// names can be written back with writeZip, which accepts printable ASCII names only.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isPartName, partNameToZipName, zipNameToPartName } from '../../packages/docvane/src/opc/part-name';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';
import { openZip } from '../../packages/docvane/src/zip/reader';
import { writeZip } from '../../packages/docvane/src/zip/writer';
import { NUM_RUNS } from '../fuzz/runs';

describe('partNameToZipName', () => {
  it('drops the leading slash and percent-encodes non-ASCII characters as UTF-8', () => {
    expect(partNameToZipName('/word/document.xml')).toBe('word/document.xml');
    expect(partNameToZipName('/word/media/żółw.png')).toBe('word/media/%C5%BC%C3%B3%C5%82w.png');
    expect(partNameToZipName('/a/日本.xml')).toBe('a/%E6%97%A5%E6%9C%AC.xml');
    expect(partNameToZipName('/emoji/😀.xml')).toBe('emoji/%F0%9F%98%80.xml');
    expect(partNameToZipName('/a%20b.xml')).toBe('a%20b.xml');
  });

  it('returns null for an unpaired surrogate', () => {
    expect(partNameToZipName('/a\uD800.xml')).toBeNull();
    expect(partNameToZipName('/a\uDC00.xml')).toBeNull();
  });

  it('is the inverse of zipNameToPartName for every part name', () => {
    const segment = fc
      .array(fc.oneof(fc.constantFrom('a', 'Z', '0', '-', '_', '~', '!', '%20', 'ż', 'ü', '日', '😀', '\u00a0'), fc.string({ unit: 'grapheme', minLength: 1, maxLength: 3 })), { minLength: 1, maxLength: 6 })
      .map((parts) => parts.join(''));
    const name = fc.array(segment, { minLength: 1, maxLength: 4 }).map((segments) => `/${segments.join('/')}`).filter(isPartName);
    fc.assert(
      fc.property(name, (partName) => {
        const zipName = partNameToZipName(partName);
        expect(zipName).not.toBeNull();
        expect(zipName).toMatch(/^[\x21-\x7e][\x20-\x7e]*$/);
        expect(zipNameToPartName(zipName as string)).toBe(partName);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('lets writeZip write a part with a non-ASCII name that openZip reads back as the same part', () => {
    const zipName = partNameToZipName('/word/media/żółw.png') as string;
    const zip = openZip(writeZip([{ name: zipName, data: new Uint8Array([1, 2, 3]) }]), DEFAULT_LIMITS);
    expect(zip.entries.map((e) => zipNameToPartName(e.name))).toEqual(['/word/media/żółw.png']);
  });
});
