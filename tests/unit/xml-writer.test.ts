// Copied from DevXord/xlvane tests/unit/xml-writer.test.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes; the encodeXstring tests left out (SpreadsheetML only), firstInvalidXmlChar tests
// added.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeText, firstInvalidXmlChar, firstLoneSurrogate } from '../../packages/tplvane/src/xml/writer';
import { parseXml } from '../../packages/tplvane/src/xml/parser';
import { parseXmlTree } from '../../packages/tplvane/src/xml/tree';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';

const ctx = () => ({ part: '/t.xml', limits: DEFAULT_LIMITS });

function roundTripText(s: string): string {
  const root = parseXmlTree(`<a>${escapeText(s)}</a>`, ctx());
  return root.text;
}

function roundTripAttr(s: string): string | undefined {
  return parseXmlTree(`<a v="${escapeAttr(s)}"/>`, ctx()).attrs.get('v');
}

describe('escapeText / escapeAttr', () => {
  it('escapes markup characters', () => {
    expect(escapeText('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
    expect(escapeAttr('"<&>\'')).toBe('&quot;&lt;&amp;&gt;\'');
  });

  it('keeps CR in text and tab, LF, CR in attributes through XML normalisation', () => {
    expect(roundTripText('a\r\nb\rc\n')).toBe('a\r\nb\rc\n');
    expect(roundTripAttr('a\tb\nc\r\nd ')).toBe('a\tb\nc\r\nd ');
  });

  it('round-trips any XML-representable string', () => {
    const isXmlChar = (cp: number): boolean =>
      cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || cp >= 0x10000;
    const xmlChar = fc.string({ unit: 'binary' }).map((s) => [...s].filter((ch) => isXmlChar(ch.codePointAt(0) ?? 0)).join(''));
    fc.assert(
      fc.property(xmlChar, (s) => {
        expect(roundTripText(s)).toBe(s);
        expect(roundTripAttr(s)).toBe(s);
      }),
    );
  });
});

describe('firstLoneSurrogate', () => {
  it('finds unpaired surrogates only', () => {
    expect(firstLoneSurrogate('ok 😀')).toBe(-1);
    expect(firstLoneSurrogate('a\uD800b')).toBe(1);
    expect(firstLoneSurrogate('\uDC00')).toBe(0);
    expect(firstLoneSurrogate('x\uD83D')).toBe(1);
  });
});

describe('firstInvalidXmlChar', () => {
  it('finds characters outside the XML 1.0 Char production and unpaired surrogates', () => {
    expect(firstInvalidXmlChar('ok\t\n\r ż 😀 \uFFFD \u{10FFFF}')).toBe(-1);
    expect(firstInvalidXmlChar('a\u0001b')).toBe(1);
    expect(firstInvalidXmlChar('\u0000')).toBe(0);
    expect(firstInvalidXmlChar('ab\uFFFE')).toBe(2);
    expect(firstInvalidXmlChar('ab\uFFFF')).toBe(2);
    expect(firstInvalidXmlChar('a\uD800b')).toBe(1);
    expect(firstInvalidXmlChar('a\uDC00')).toBe(1);
    expect(firstInvalidXmlChar('x\uD83D')).toBe(1);
    expect(firstInvalidXmlChar('\u001F')).toBe(0);
  });

  it('agrees with the parser: a string is accepted as element content exactly when it has no invalid character', () => {
    const tricky = fc.constantFrom('a', '\u0001', '\u0008', '\uFFFE', '\uFFFF', '\uD800', '\uDC00', '😀', '\t', '\uE000');
    const str = fc.oneof(fc.string({ unit: 'binary', maxLength: 20 }), fc.array(tricky, { maxLength: 8 }).map((a) => a.join('')));
    fc.assert(
      fc.property(str, (s) => {
        let parsed = true;
        try {
          parseXml(`<a>${escapeText(s)}</a>`, { start() {}, end() {}, text() {} }, { part: '/t.xml', limits: DEFAULT_LIMITS });
        } catch {
          parsed = false;
        }
        expect(parsed).toBe(firstInvalidXmlChar(s) === -1);
      }),
    );
  });
});
