// Copied from DevXord/xlvane packages/xlvane/src/xml/writer.ts at aeaefbc (unchanged since ada547b),
// adapted for docvane (D-009): `firstInvalidXmlChar` added (xlvane D-008 gap 2), `encodeXstring`
// left out. Identifiers such as X-07 or D-XS-3 below refer to the notes of xlvane.
//
// Helpers for writing XML text. The output is parsed back by our own reader, so every rule here
// is the inverse of a reader rule:
// - `&`, `<`, `>` are written as the predefined entities (XML 1.0 §4.6, X-07); `"` too in
//   attribute values, which are always quoted with `"`.
// - CR is written as `&#13;` because a literal CR would be turned into LF by end-of-line
//   handling (X-04); in attribute values tab, LF and CR are written as character references
//   because attribute-value normalisation turns literal ones into spaces (X-05).
// - Characters outside the XML Char production (F-XML-CHAR) cannot be written at all; callers
//   find them with `firstInvalidXmlChar`. (The ST_Xstring encoder of xlvane, which is
//   SpreadsheetML only, is left out.)

import { isXmlChar } from './chars';

/** Escapes character data for element content. */
export function escapeText(s: string): string {
  return /[&<>\r]/.test(s)
    ? s.replace(/[&<>\r]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&#13;'))
    : s;
}

const ATTR_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ['\t', '&#9;'],
  ['\n', '&#10;'],
  ['\r', '&#13;'],
]);

/** Escapes an attribute value that will be enclosed in double quotes. */
export function escapeAttr(s: string): string {
  return /[&<>"\t\n\r]/.test(s) ? s.replace(/[&<>"\t\n\r]/g, (c) => ATTR_ESCAPES.get(c) ?? c) : s;
}

function hex4(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}

/** Index of the first unpaired surrogate code unit in `s`, or -1 if `s` is well-formed UTF-16. */
export function firstLoneSurrogate(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c > 0xdfff) continue;
    if (c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    return i;
  }
  return -1;
}

/**
 * Index (in UTF-16 code units) of the first character of `s` that XML 1.0 cannot hold at all, or
 * -1 if there is none: a code point outside the Char production (§2.2), such as U+0001 or U+FFFE,
 * or an unpaired surrogate. `escapeText` and `escapeAttr` leave such characters in place, so
 * text from untrusted data must be checked with this before it is written.
 */
export function firstInvalidXmlChar(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (!isXmlChar(((c - 0xd800) << 10) + (next - 0xdc00) + 0x10000)) return i;
        i++;
        continue;
      }
      return i;
    }
    if (!isXmlChar(c)) return i;
  }
  return -1;
}
