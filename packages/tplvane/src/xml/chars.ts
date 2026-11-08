// The Char production of XML 1.0, shared by the parser and the writer. Moved out of
// packages/xlvane/src/xml/parser.ts of DevXord/xlvane at aeaefbc (unchanged since ada547b), where
// it is private, so that `firstInvalidXmlChar` uses the same rule as the parser (xlvane D-008 gap 2).

/** The Char production of XML 1.0 (§2.2) for a code point. */
export function isXmlChar(c: number): boolean {
  return (
    c === 0x09 ||
    c === 0x0a ||
    c === 0x0d ||
    (c >= 0x20 && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0x10ffff)
  );
}
