// Copied from DevXord/xlvane packages/xlvane/src/opc/part-name.ts at aeaefbc (unchanged since
// ada547b), adapted for tplvane (D-009): `partNameToZipName` added, the inverse of
// `zipNameToPartName` (xlvane D-008 gap 3, option A). F-OPC-* and D-OPC-* below refer to the notes
// of xlvane.
//
// Part names and references inside an OPC package (ECMA-376 Part 2 §6.2.2, §6.4, §7.3.5;
// facts F-OPC-01 … F-OPC-06, F-OPC-12 and F-OPC-14, decisions D-OPC-01 … D-OPC-03).
//
// Everything here works on code points with explicit loops: no regular expressions run over data
// from the file except a single-character class, and every function is linear in its input.

const SLASH = 0x2f;
const BACKSLASH = 0x5c;
const PERCENT = 0x25;
const DOT = 0x2e;
const COLON = 0x3a;

/** RFC 3986 §2.3 `unreserved`, ASCII part. */
function isUnreservedAscii(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x2d || // -
    c === DOT ||
    c === 0x5f || // _
    c === 0x7e // ~
  );
}

/** RFC 3986 §2.2 `sub-delims`. */
function isSubDelim(c: number): boolean {
  // ! $ & ' ( ) * + , ; =
  return c === 0x21 || c === 0x24 || (c >= 0x26 && c <= 0x2c) || c === 0x3b || c === 0x3d;
}

/** RFC 3987 §2.2 `ucschar` (F-OPC-01). */
function isUcschar(c: number): boolean {
  if (c >= 0xa0 && c <= 0xd7ff) return true;
  if (c >= 0xf900 && c <= 0xfdcf) return true;
  if (c >= 0xfdf0 && c <= 0xffef) return true;
  // %x10000-1FFFD / %x20000-2FFFD / … / %xD0000-DFFFD
  if (c >= 0x10000 && c <= 0xdffff) return (c & 0xffff) <= 0xfffd;
  return c >= 0xe1000 && c <= 0xefffd;
}

/** RFC 3987 §2.2 `iunreserved`. */
function isIunreserved(c: number): boolean {
  return c < 0x80 ? isUnreservedAscii(c) : isUcschar(c);
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

/** The octet encoded by `%HH` at `at`, or -1 if `at` does not start a valid percent-encoding. */
function octetAt(s: string, at: number): number {
  if (s.charCodeAt(at) !== PERCENT) return -1;
  const hi = hexValue(s.charCodeAt(at + 1));
  const lo = hexValue(s.charCodeAt(at + 2));
  return hi < 0 || lo < 0 ? -1 : hi * 16 + lo;
}

// Non-fatal on purpose: invalid sequences come back as U+FFFD instead of throwing, so hostile
// input cannot turn every percent sign into an exception.
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

interface Percent {
  /** The decoded code point, or -1 for an octet that does not start a valid UTF-8 character. */
  readonly cp: number;
  /** Index just past the percent-encoded octets that make up `cp` (one octet when `cp` is -1). */
  readonly end: number;
}

/**
 * Reads a percent-encoded character at `at`: one octet for ASCII, or the UTF-8 sequence of a
 * non-ASCII character (RFC 3987 §3.1 converts characters to UTF-8 octets before percent-encoding
 * them; F-OPC-15). Returns
 * `null` when `at` is a "%" that is not followed by two hexadecimal digits.
 */
function percentAt(s: string, at: number): Percent | null {
  const lead = octetAt(s, at);
  if (lead < 0) return null;
  if (lead < 0x80) return { cp: lead, end: at + 3 };
  const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 0;
  if (length === 0) return { cp: -1, end: at + 3 };
  const bytes = new Uint8Array(length);
  bytes[0] = lead;
  for (let i = 1; i < length; i++) {
    const octet = octetAt(s, at + 3 * i);
    if (octet < 0) return { cp: -1, end: at + 3 };
    bytes[i] = octet;
  }
  const text = utf8.decode(bytes);
  const cp = text.codePointAt(0) ?? -1;
  const single = text.length === (cp > 0xffff ? 2 : 1);
  const replacement = cp === 0xfffd && !(bytes[0] === 0xef && bytes[1] === 0xbf && bytes[2] === 0xbd);
  return single && !replacement && cp >= 0x80 ? { cp, end: at + 3 * length } : { cp: -1, end: at + 3 };
}

/** Replaces the percent-encoded characters for which `decode` returns true by the characters. */
function decodePercent(s: string, decode: (cp: number) => boolean): string {
  if (!s.includes('%')) return s;
  let out = '';
  let from = 0;
  for (let i = 0; i < s.length; ) {
    if (s.charCodeAt(i) !== PERCENT) {
      i++;
      continue;
    }
    const p = percentAt(s, i);
    if (p === null) {
      i++;
      continue;
    }
    if (p.cp >= 0 && decode(p.cp)) {
      out += s.slice(from, i) + String.fromCodePoint(p.cp);
      from = p.end;
    }
    i = p.end;
  }
  return out + s.slice(from);
}

/**
 * Folds A–Z to a–z and nothing else: the ASCII case-insensitive matching that Part 2 uses for
 * part names, logical item names, extensions and Override part names (§6.2.2.3, §7.2.3.5;
 * F-OPC-03). Two names are equivalent exactly when their keys are equal.
 */
export function partKey(name: string): string {
  return name.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * Returns `true` if `name` is a valid part name: `1*( "/" isegment-nz )`, where no segment holds
 * a percent-encoded "/", "\" or `iunreserved` character, and no segment ends with "."
 * (Part 2 §6.2.2.2; F-OPC-01).
 */
export function isPartName(name: string): boolean {
  if (name.length < 2 || name.charCodeAt(0) !== SLASH) return false;
  let segmentLength = 0;
  let lastWasDot = false;
  for (let i = 1; i < name.length; ) {
    const c = name.codePointAt(i) as number;
    if (c === SLASH) {
      if (segmentLength === 0 || lastWasDot) return false;
      segmentLength = 0;
      i++;
      continue;
    }
    segmentLength++;
    lastWasDot = c === DOT;
    if (c === PERCENT) {
      const p = percentAt(name, i);
      if (p === null || p.cp === SLASH || p.cp === BACKSLASH || (p.cp >= 0 && isIunreserved(p.cp))) return false;
      i = p.end;
      continue;
    }
    const allowed = c < 0x80 ? isUnreservedAscii(c) || isSubDelim(c) || c === COLON || c === 0x40 /* @ */ : isUcschar(c);
    if (!allowed) return false;
    i += c > 0xffff ? 2 : 1;
  }
  return segmentLength > 0 && !lastWasDot;
}

/**
 * Maps a ZIP item name to a logical item name: un-percent-encode every non-ASCII character, then
 * add a leading "/" (Part 2 §7.3.5; F-OPC-12). The result is a part only if {@link isPartName}
 * accepts it. Names stored with raw non-ASCII characters (UTF-8 flag) give the same result as
 * their percent-encoded spelling (D-OPC-01).
 */
export function zipNameToPartName(zipName: string): string {
  return `/${decodePercent(zipName, (cp) => cp >= 0x80)}`;
}

/**
 * Maps a part name to the ZIP item name to write: drop the leading "/" and percent-encode the
 * UTF-8 bytes of every non-ASCII character, in upper-case hex. The inverse of
 * {@link zipNameToPartName}: `zipNameToPartName(partNameToZipName(p)) === p` for every part name
 * `p`, and the result is printable ASCII, which `writeZip` requires (xlvane D-008 gap 3, option A).
 * Returns null for a name with an unpaired surrogate, which no part name has.
 */
export function partNameToZipName(partName: string): string | null {
  const name = partName.charCodeAt(0) === SLASH ? partName.slice(1) : partName;
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x80) {
      out += name[i];
      continue;
    }
    let cp = c;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = name.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      cp = ((c - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return null;
    }
    for (const byte of utf8Bytes(cp)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** The UTF-8 bytes of a code point (RFC 3629 §3). */
function utf8Bytes(cp: number): number[] {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
}

/**
 * Decodes percent-encoded `iunreserved` characters, which a valid part name cannot contain
 * (F-OPC-01 b). Annex A (informative) suggests the same step; see D-OPC-02.
 */
export function canonicalReference(reference: string): string {
  return decodePercent(reference, isIunreserved);
}

/**
 * Returns `true` for Relationships part names: `/_rels/.rels`, or a name whose second-to-last
 * segment is equivalent to `_rels` and whose last segment ends with `.rels` (Part 2 §6.2.2.2;
 * F-OPC-02).
 */
export function isRelationshipsPart(name: string): boolean {
  const key = partKey(name);
  const last = key.lastIndexOf('/');
  if (last < 1 || !key.endsWith('.rels')) return false;
  const previous = key.lastIndexOf('/', last - 1);
  return previous >= 0 && key.slice(previous + 1, last) === '_rels';
}

/**
 * RFC 3986 §5.2.4 remove_dot_segments for a path that starts with "/". Works on a segment stack,
 * so it is linear in the length of the path; "/../" at the root collapses to "/" (F-OPC-06).
 */
export function removeDotSegments(path: string): string {
  const segments = path.split('/');
  const out: string[] = [];
  const lastIndex = segments.length - 1;
  for (let i = 1; i <= lastIndex; i++) {
    const segment = segments[i] as string;
    if (segment === '.' || segment === '..') {
      if (segment === '..') out.pop();
      // A final "." or ".." leaves the path ending in "/" (RFC 3986 §5.2.4 steps B and C).
      if (i === lastIndex) out.push('');
      continue;
    }
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

/** Returns `true` if the first segment of a path that does not start with "/" contains ":". */
export function hasColonInFirstSegment(path: string): boolean {
  if (path.charCodeAt(0) === SLASH) return false;
  const slash = path.indexOf('/');
  const colon = path.indexOf(':');
  return colon !== -1 && (slash === -1 || colon < slash);
}
