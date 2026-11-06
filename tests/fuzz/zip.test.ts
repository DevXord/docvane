// Copied from DevXord/xlvane tests/fuzz/zip.test.ts, at aeaefbc, adapted for
// docvane (D-009): imports, DvError and DV_E_* codes.
// Property tests for the ZIP reader and CRC-32: random or damaged archives only ever fail with an
// DvError, intact archives read back exactly, and the size limits are enforced exactly.
import fc from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DvError, type DvErrorCode } from '../../packages/docvane/src/errors';
import { DEFAULT_LIMITS, type ReadLimits } from '../../packages/docvane/src/limits';
import { crc32 } from '../../packages/docvane/src/zip/crc32';
import { openZip, type ZipReader } from '../../packages/docvane/src/zip/reader';
import { buildZip, deflate, type RawZipOptions } from '../helpers/raw-zip';
import { NUM_RUNS } from './runs';

const enc = new TextEncoder();

const OPEN_CODES: readonly DvErrorCode[] = [
  'DV_E_NOT_ZIP',
  'DV_E_UNSUPPORTED_CONTAINER',
  'DV_E_ZIP_CORRUPT',
  'DV_E_ZIP_UNSUPPORTED',
  'DV_E_LIMIT_EXCEEDED',
];
const READ_CODES: readonly DvErrorCode[] = ['DV_E_ZIP_CORRUPT', 'DV_E_ZIP_UNSUPPORTED', 'DV_E_LIMIT_EXCEEDED'];

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Like toEqual on byte arrays, but fast when they are equal. */
function expectBytes(actual: Uint8Array | undefined, expected: Uint8Array | undefined): void {
  if (actual === undefined || expected === undefined || !sameBytes(actual, expected)) expect(actual).toEqual(expected);
}

function xlvErrorOf(error: unknown): DvError {
  if (error instanceof DvError) return error;
  throw error;
}

interface Outcome {
  /** The error thrown by openZip, or null if the archive opened. */
  readonly open: DvError | null;
  /** For each entry in central directory order: its content or the error thrown by read(). */
  readonly reads: (Uint8Array | DvError)[];
  readonly bytesRead: number;
}

/** Opens `data` and reads every entry. Any exception other than DvError fails the property. */
function readEach(data: Uint8Array, limits: ReadLimits = DEFAULT_LIMITS): Outcome {
  let opened: ZipReader;
  try {
    opened = openZip(data, limits);
  } catch (error) {
    return { open: xlvErrorOf(error), reads: [], bytesRead: 0 };
  }
  const zip = opened;
  const reads = zip.entries.map((entry) => {
    try {
      return zip.read(entry);
    } catch (error) {
      return xlvErrorOf(error);
    }
  });
  return { open: null, reads, bytesRead: zip.bytesRead };
}

function expectOnlyKnownErrors(outcome: Outcome): void {
  if (outcome.open !== null) expect(OPEN_CODES).toContain(outcome.open.code);
  for (const read of outcome.reads) {
    if (read instanceof DvError) expect(READ_CODES).toContain(read.code);
  }
}

// ----- archives -------------------------------------------------------------------------------

interface GenEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method: 0 | 8;
  readonly zip64: boolean;
  readonly dataDescriptor: boolean;
}

interface GenArchive {
  readonly entries: readonly GenEntry[];
  readonly comment: string | undefined;
  readonly zip64: boolean;
}

const NAME_UNITS = ['a', 'b', 'Z', '0', '/', '.', '_', '-', ' ', 'ż', 'É', '中', '\u{1F600}'];
// No unit contains a zero byte and comments stay under 160 bytes, so a signature inside a comment
// can never form a second end of central directory record that ends the file exactly.
const COMMENT_UNITS = ['a', 'Z', ' ', '-', 'ż', '€', 'PK\u0005\u0006', 'PK\u0001\u0002', 'PK\u0003\u0004'];

const genEntry: Arbitrary<GenEntry> = fc.record({
  name: fc.string({ unit: fc.constantFrom(...NAME_UNITS), minLength: 1, maxLength: 12 }),
  data: fc.oneof(
    fc.uint8Array({ maxLength: 300, size: 'max' }),
    // Compressible text, so deflated entries are much smaller than their content.
    fc.string({ unit: fc.constantFrom('a', 'b', '<x/>', '\n', 'ż'), maxLength: 200, size: 'max' }).map((s) => enc.encode(s)),
  ),
  method: fc.constantFrom(0, 8),
  zip64: fc.boolean(),
  dataDescriptor: fc.boolean(),
});

const genArchive: Arbitrary<GenArchive> = fc.record({
  // The reader rejects names that differ only in letter case, and compares them with toLowerCase.
  entries: fc.uniqueArray(genEntry, { maxLength: 5, selector: (e) => e.name.toLowerCase() }),
  comment: fc.option(fc.string({ unit: fc.constantFrom(...COMMENT_UNITS), maxLength: 40 }), { nil: undefined }),
  zip64: fc.boolean(),
});

function build(archive: GenArchive): Uint8Array {
  const options: RawZipOptions = { zip64: archive.zip64, ...(archive.comment === undefined ? {} : { comment: archive.comment }) };
  return buildZip(
    archive.entries.map((e) => ({ name: e.name, data: e.data, method: e.method, zip64: e.zip64, dataDescriptor: e.dataDescriptor })),
    options,
  );
}

// ----- mutations ------------------------------------------------------------------------------

interface Position {
  /** Mutations near the start hit the first local header, near the end the central directory. */
  readonly from: 'start' | 'end' | 'any';
  readonly offset: number;
}

type Mutation =
  | { readonly kind: 'flip'; readonly at: Position; readonly bit: number }
  | { readonly kind: 'truncate'; readonly at: Position }
  | { readonly kind: 'insert'; readonly at: Position; readonly bytes: Uint8Array }
  | { readonly kind: 'delete'; readonly at: Position; readonly length: number }
  | { readonly kind: 'overwrite'; readonly at: Position; readonly bytes: Uint8Array };

const position: Arbitrary<Position> = fc.record({ from: fc.constantFrom('start', 'end', 'any'), offset: fc.nat() });

const mutation: Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constant('flip'), at: position, bit: fc.integer({ min: 0, max: 7 }) }),
  fc.record({ kind: fc.constant('truncate'), at: position }),
  fc.record({ kind: fc.constant('insert'), at: position, bytes: fc.uint8Array({ minLength: 1, maxLength: 16 }) }),
  fc.record({ kind: fc.constant('delete'), at: position, length: fc.integer({ min: 1, max: 16 }) }),
  fc.record({ kind: fc.constant('overwrite'), at: position, bytes: fc.uint8Array({ minLength: 2, maxLength: 8 }) }),
);

function resolve({ from, offset }: Position, length: number): number {
  if (length === 0) return 0;
  if (from === 'start') return offset % Math.min(length, 64);
  if (from === 'end') return length - 1 - (offset % Math.min(length, 512));
  return offset % length;
}

function mutate(data: Uint8Array, m: Mutation): Uint8Array {
  const at = resolve(m.at, data.length);
  switch (m.kind) {
    case 'flip': {
      const out = data.slice();
      if (at < out.length) out[at] = (out[at] ?? 0) ^ (1 << m.bit);
      return out;
    }
    case 'truncate':
      return data.slice(0, at);
    case 'insert':
      return concat(data.subarray(0, at), m.bytes, data.subarray(at));
    case 'delete':
      return concat(data.subarray(0, at), data.subarray(at + m.length));
    case 'overwrite': {
      const out = data.slice();
      out.set(m.bytes.subarray(0, Math.max(0, out.length - at)), at);
      return out;
    }
  }
}

// ----- random bytes ---------------------------------------------------------------------------

const SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x01, 0x02],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x06, 0x06],
  [0x50, 0x4b, 0x06, 0x07],
  [0x50, 0x4b, 0x07, 0x08],
  [0xff, 0xff, 0xff, 0xff],
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
];
const zipish = fc
  .array(fc.oneof(fc.uint8Array({ maxLength: 12 }), fc.constantFrom(...SIGNATURES).map((s) => new Uint8Array(s))), { maxLength: 24 })
  .map((parts) => concat(...parts));
/** Random bytes, random signatures, and random bytes that end in a plausible end of central directory record. */
const eocdFields = fc.oneof(
  fc.uint8Array({ minLength: 16, maxLength: 16 }),
  // Disk numbers zero and equal entry counts, so the reader goes on to the central directory.
  fc
    .tuple(fc.integer({ min: 0, max: 5 }), fc.uint8Array({ minLength: 8, maxLength: 8 }))
    .map(([count, rest]) => concat(new Uint8Array([0, 0, 0, 0, count, 0, count, 0]), rest)),
);
const randomArchive = fc.oneof(
  fc.uint8Array({ maxLength: 600, size: 'max' }),
  zipish,
  fc
    .tuple(zipish, eocdFields)
    .map(([body, fields]) => concat(body, new Uint8Array([0x50, 0x4b, 0x05, 0x06]), fields, new Uint8Array([0, 0]))),
);

// ----- properties -----------------------------------------------------------------------------

describe('openZip on hostile input', () => {
  it('throws only DvError on arbitrary bytes', () => {
    fc.assert(
      fc.property(randomArchive, (data) => expectOnlyKnownErrors(readEach(data))),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws only DvError on damaged archives and never returns wrong content', () => {
    fc.assert(
      fc.property(genArchive, fc.array(mutation, { minLength: 1, maxLength: 3 }), (archive, mutations) => {
        const damaged = mutations.reduce(mutate, build(archive));
        const outcome = readEach(damaged);
        expectOnlyKnownErrors(outcome);
        // A damaged archive that still reads without any error must hold the original contents:
        // every changed byte that matters is caught by a structure check, a size or the CRC-32.
        if (outcome.open === null && outcome.reads.every((r) => r instanceof Uint8Array)) {
          expect(outcome.reads.length).toBe(archive.entries.length);
          outcome.reads.forEach((read, i) => {
            expect(sameBytes(read as Uint8Array, archive.entries[i]?.data ?? new Uint8Array())).toBe(true);
          });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('openZip on intact archives', () => {
  it('reads back exactly the names and contents that were written', () => {
    fc.assert(
      fc.property(genArchive, (archive) => {
        const zip = openZip(build(archive), DEFAULT_LIMITS);
        expect(zip.entries.map((e) => e.name)).toEqual(archive.entries.map((e) => e.name));
        for (const [i, entry] of zip.entries.entries()) {
          const original = archive.entries[i];
          expect(entry.method).toBe(original?.method);
          expectBytes(zip.read(entry), original?.data);
          expect(zip.find(entry.name.toUpperCase())).toBe(entry);
        }
        expect(zip.bytesRead).toBe(archive.entries.reduce((n, e) => n + e.data.length, 0));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Each limit is either the default or tight enough to be hit by the small generated archives.
  const maybeTight = (name: keyof ReadLimits, tight: Arbitrary<number>): Arbitrary<number> =>
    fc.oneof({ arbitrary: fc.constant(DEFAULT_LIMITS[name]), weight: 2 }, { arbitrary: tight, weight: 1 });
  const tightLimits: Arbitrary<ReadLimits> = fc
    .record({
      maxInputBytes: maybeTight('maxInputBytes', fc.integer({ min: 1, max: 4096 })),
      maxEntries: maybeTight('maxEntries', fc.integer({ min: 1, max: 5 })),
      maxEntryBytes: maybeTight('maxEntryBytes', fc.integer({ min: 1, max: 400 })),
      maxTotalBytes: maybeTight('maxTotalBytes', fc.integer({ min: 1, max: 1500 })),
      maxCompressionRatio: maybeTight('maxCompressionRatio', fc.double({ min: 1, max: 20, noNaN: true })),
      compressionRatioMinBytes: maybeTight('compressionRatioMinBytes', fc.integer({ min: 1, max: 300 })),
    })
    .map((tight) => ({ ...DEFAULT_LIMITS, ...tight }));

  it('fails exactly when a limit is exceeded, naming that limit', () => {
    fc.assert(
      fc.property(genArchive, tightLimits, (archive, limits) => {
        const data = build(archive);
        const outcome = readEach(data, limits);

        // Model of the checks in openZip and ZipReader.read, in the order the reader makes them.
        let expectedOpen: string | null = null;
        if (data.length > limits.maxInputBytes) expectedOpen = 'maxInputBytes';
        else if (archive.entries.length > limits.maxEntries) expectedOpen = 'maxEntries';
        expect(outcome.open?.code ?? null).toBe(expectedOpen === null ? null : 'DV_E_LIMIT_EXCEEDED');
        expect(outcome.open?.details['limit'] ?? null).toBe(expectedOpen);
        if (expectedOpen !== null) return;

        let total = 0;
        archive.entries.forEach((entry, i) => {
          const size = entry.data.length;
          let expected: string | null = null;
          if (size > limits.maxEntryBytes) expected = 'maxEntryBytes';
          else if (total + size > limits.maxTotalBytes) expected = 'maxTotalBytes';
          else if (entry.method === 8) {
            const compressed = Math.max(1, deflate(entry.data).length);
            if (size > limits.compressionRatioMinBytes && size / compressed > limits.maxCompressionRatio) expected = 'maxCompressionRatio';
          }
          const read = outcome.reads[i];
          if (read instanceof DvError) {
            expect([read.code, read.details['limit']]).toEqual(['DV_E_LIMIT_EXCEEDED', expected]);
          } else {
            expect(expected).toBeNull();
            expectBytes(read, entry.data);
            total += size;
          }
        });
        expect(outcome.bytesRead).toBe(total);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const uint32 = fc
  .tuple(fc.integer({ min: 0, max: 0xffff }), fc.integer({ min: 0, max: 0xffff }))
  .map(([high, low]) => high * 0x10000 + low);

describe('crc32', () => {
  it('equals crc32 from node:zlib', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048, size: 'max' }), (bytes) => {
        expect(crc32(bytes)).toBe(zlibCrc32(bytes));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives the same result when computed in two parts', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024, size: 'max' }), fc.uint8Array({ maxLength: 1024, size: 'max' }), (a, b) => {
        const whole = concat(a, b);
        expect(crc32(b, crc32(a))).toBe(crc32(whole));
        expect(crc32(whole)).toBe(zlibCrc32(whole));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('continues from any starting value as node:zlib does', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512, size: 'max' }), uint32, (bytes, start) => {
        expect(crc32(bytes, start)).toBe(zlibCrc32(bytes, start));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
