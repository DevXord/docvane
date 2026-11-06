// Copied from DevXord/xlvane tests/fuzz/xml.test.ts, at aeaefbc, adapted for
// docvane (D-009): imports, DvError and DV_E_* codes.
// Property tests for the XML parser and decoder: hostile input only ever fails with an DvError,
// and well-formed documents survive a serialise / parse round trip unchanged.
import fc from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DvError, type DvErrorCode } from '../../packages/docvane/src/errors';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';
import { decodeXml, parseXml, XML_NAMESPACE, type XmlHandler, type XmlLimits } from '../../packages/docvane/src/xml/parser';
import { parseXmlTree, type XmlElement } from '../../packages/docvane/src/xml/tree';
import { NUM_RUNS } from './runs';

const PART = '/xl/fuzz.xml';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const XML_CODES: readonly DvErrorCode[] = [
  'DV_E_XML_MALFORMED',
  'DV_E_XML_DTD_FORBIDDEN',
  'DV_E_XML_ENTITY_FORBIDDEN',
  'DV_E_LIMIT_EXCEEDED',
];
const XML_LIMITS: readonly string[] = ['maxXmlDepth', 'maxXmlAttributes', 'maxXmlNameLength', 'maxXmlTextLength', 'maxXmlTreeElements'];

type TreeLimits = XmlLimits & { readonly maxXmlTreeElements: number };

/** Runs `fn`; returns the DvError it threw, or null. Any other exception fails the property. */
function attempt(fn: () => unknown): DvError | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof DvError) return error;
    throw error;
  }
}

function expectXmlError(error: DvError): void {
  expect(XML_CODES).toContain(error.code);
  expect(error.location.part).toBe(PART);
  expect(error.hint.length).toBeGreaterThan(0);
  for (const n of [error.location.line, error.location.column]) {
    if (n !== undefined) expect(Number.isSafeInteger(n) && n >= 1).toBe(true);
  }
  if (error.code === 'DV_E_LIMIT_EXCEEDED') expect(XML_LIMITS).toContain(error.details['limit']);
}

/** A handler that checks the event stream is well nested: one root, matching ends, text only inside elements. */
function nestingHandler(): XmlHandler & { finish(): void } {
  const open: [string, string][] = [];
  let roots = 0;
  return {
    start(ns, local, attrs) {
      if (open.length === 0) roots++;
      expect(local.length).toBeGreaterThan(0);
      expect(local).not.toContain(':');
      expect(ns).not.toBe(XMLNS_NAMESPACE);
      expect(attrs).toBeInstanceOf(Map);
      for (const key of attrs.keys()) expect(key === 'xmlns' || key.startsWith('xmlns:')).toBe(false);
      open.push([ns, local]);
    },
    end(ns, local) {
      expect(open.pop()).toEqual([ns, local]);
    },
    text(value) {
      expect(open.length).toBeGreaterThan(0);
      expect(value.length).toBeGreaterThan(0);
    },
    finish() {
      expect(open).toEqual([]);
      expect(roots).toBe(1);
    },
  };
}

// ----- arbitraries for hostile input ------------------------------------------------------

/** Any UTF-16 code unit, including lone surrogates (the fast-check 4 replacement for char16bits). */
const codeUnit = fc.integer({ min: 0, max: 0xffff }).map((n) => String.fromCharCode(n));

const anyString = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 300, size: 'max' }),
  fc.string({ unit: codeUnit, maxLength: 300, size: 'max' }),
);

const XMLISH_UNITS = [
  '<', '>', '/', '&', ';', '#', 'x', '=', '"', "'", '!', '-', '?', '[', ']', ':', ' ', '\t', '\n', '\r', '\r\n',
  'a', 'b', 'Z', '_', '0', '9', 'é', 'ż', '中', '\u{B7}', '\u{1F600}', '\u{10000}',
  // Characters outside the Char production.
  '\u0000', '\u0001', '\u{FFFE}', '\uD800', '\uDC00',
  '<!DOCTYPE', '<!doctype', '<![CDATA[', ']]>', '<!--', '-->', '--', '<?xml', '<?xml ', '<?pi ', '?>',
  '&amp;', '&lt;', '&gt;', '&quot;', '&apos;', '&#x41;', '&#65;', '&#x1F600;', '&#0;', '&#xD800;', '&#x110000;', '&nbsp;', '&#',
  'xmlns:p="u"', 'xmlns="u"', 'xmlns=""', 'xmlns:p=""', 'xmlns:xml="u"', 'xmlns:xmlns="u"', 'xml:lang="en"', ' p:v="1"', ' v="1"',
  'p:', '<a>', '</a>', '<a/>', '<p:b ', '</p:b>', '/>',
];
const xmlishBody = fc.string({ unit: fc.constantFrom(...XMLISH_UNITS), maxLength: 120, size: 'medium' });
const xmlish = fc
  .tuple(
    fc.constantFrom('', '<a>', '<?xml version="1.0"?>\n<a x="1">', '<p:r xmlns:p="u">', '<a><![CDATA['),
    xmlishBody,
    fc.constantFrom('', '</a>', '</p:r>', ']]></a>'),
  )
  .map(([head, body, tail]) => head + body + tail);

/** The default limits or tight ones, so that every limit check is reached. */
const treeLimits: Arbitrary<TreeLimits> = fc.oneof(
  fc.constant(DEFAULT_LIMITS),
  fc
    .record({
      maxXmlDepth: fc.integer({ min: 1, max: 6 }),
      maxXmlAttributes: fc.integer({ min: 1, max: 4 }),
      maxXmlNameLength: fc.integer({ min: 1, max: 12 }),
      maxXmlTextLength: fc.integer({ min: 1, max: 40 }),
      maxXmlTreeElements: fc.integer({ min: 1, max: 10 }),
    })
    .map((tight) => ({ ...DEFAULT_LIMITS, ...tight })),
);

/**
 * parseXml either completes with a well-nested event stream or throws an XML/limit DvError;
 * parseXmlTree agrees with it exactly when its own element limit is off.
 */
function checkHostile(xml: string, limits: TreeLimits): void {
  const handler = nestingHandler();
  const streamed = attempt(() => {
    parseXml(xml, handler, { part: PART, limits });
    handler.finish();
  });
  if (streamed !== null) expectXmlError(streamed);

  const unbounded = attempt(() =>
    parseXmlTree(xml, { part: PART, limits: { ...limits, maxXmlTreeElements: Number.POSITIVE_INFINITY } }),
  );
  expect(unbounded === null ? null : [unbounded.code, unbounded.message]).toEqual(
    streamed === null ? null : [streamed.code, streamed.message],
  );

  const bounded = attempt(() => parseXmlTree(xml, { part: PART, limits }));
  if (bounded !== null) {
    expectXmlError(bounded);
    if (streamed === null) expect(bounded.details['limit']).toBe('maxXmlTreeElements');
  }
}

describe('parseXml on hostile input', () => {
  it('throws only DvError with an XML or limit code on arbitrary strings', () => {
    fc.assert(fc.property(anyString, treeLimits, checkHostile), { numRuns: NUM_RUNS });
  });

  it('throws only DvError with an XML or limit code on strings made of XML syntax', () => {
    fc.assert(fc.property(xmlish, treeLimits, checkHostile), { numRuns: NUM_RUNS });
  });
});

// ----- round trip -----------------------------------------------------------------------------

const codePoint = (min: number, max: number): Arbitrary<string> =>
  fc.integer({ min, max }).map((c) => String.fromCodePoint(c));

/** Characters matching the XML 1.0 Char production, biased towards those that need escaping. */
const xmlChar: Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom('&', '<', '>', '"', "'", ']', '\t', '\n', '\r', ' '), weight: 4 },
  { arbitrary: codePoint(0x20, 0x7e), weight: 4 },
  { arbitrary: codePoint(0x20, 0xd7ff), weight: 2 },
  { arbitrary: codePoint(0xe000, 0xfffd), weight: 1 },
  { arbitrary: codePoint(0x10000, 0x10ffff), weight: 1 },
);
const xmlText = (maxLength: number): Arbitrary<string> => fc.string({ unit: xmlChar, maxLength, size: 'max' });

// Name characters: ASCII, Latin and CJK letters, an astral name character, digits, '-', '.',
// U+00B7 and a combining accent. No 'm' or 'l', so no name can start with the reserved "xml".
const NAME_START = ['a', 'b', 'c', 'Q', 'Z', '_', 'é', 'ż', 'Ω', '中', '\u{10000}'];
const NAME_REST = [...NAME_START, '0', '7', '-', '.', '\u{B7}', '\u{301}'];
const ncName = fc
  .tuple(fc.constantFrom(...NAME_START), fc.string({ unit: fc.constantFrom(...NAME_REST), maxLength: 6 }))
  .map(([first, rest]) => first + rest);

const DECLARABLE_PREFIXES = ['p', 'q', 'ns1', 'é'];
/** '' means an unprefixed attribute; `xml` is bound without a declaration. */
const attrPrefix = fc.oneof(
  { arbitrary: fc.constant(''), weight: 3 },
  { arbitrary: fc.constantFrom(...DECLARABLE_PREFIXES, 'xml'), weight: 2 },
);
const namespaceUri = fc
  .oneof(fc.constantFrom('urn:a', 'urn:b', 'http://example.com/ns', ''), xmlText(12))
  .filter((uri) => uri !== XML_NAMESPACE && uri !== XMLNS_NAMESPACE);
const tagSpace = fc.constantFrom(' ', '  ', '\n', '\t', '\r\n');

interface GenAttr {
  readonly prefix: string;
  readonly local: string;
  /** Namespace bound to `prefix` if it is not in scope yet. */
  readonly uri: string;
  readonly value: string;
  readonly quote: '"' | "'";
  readonly space: string;
}

interface GenText {
  readonly text: string;
  readonly mode: 'escaped' | 'cdata' | 'hex' | 'decimal';
  /** Markup that does not contribute text: a comment or processing instruction. */
  readonly after: string;
}

interface GenElement {
  readonly local: string;
  readonly mode: 'inherit' | 'default' | 'prefixed';
  readonly prefix: string;
  readonly uri: string;
  /** For prefixed elements: use the binding in scope, if any, instead of declaring the prefix again. */
  readonly reuse: boolean;
  readonly attrs: readonly GenAttr[];
  readonly texts: readonly GenText[];
  /** Index of the parent element, reduced modulo the element's own index. */
  readonly parent: number;
  readonly selfClose: boolean;
  readonly declarationsFirst: boolean;
  readonly closeSpace: string;
}

interface GenDocument {
  readonly elements: readonly GenElement[];
  readonly declaration: boolean;
  readonly prolog: string;
  readonly epilog: string;
}

const genAttr: Arbitrary<GenAttr> = fc.record({
  prefix: attrPrefix,
  local: ncName,
  uri: namespaceUri,
  value: xmlText(20),
  quote: fc.constantFrom('"', "'"),
  space: tagSpace,
});

const genText: Arbitrary<GenText> = fc.record({
  text: xmlText(20),
  mode: fc.constantFrom('escaped', 'cdata', 'hex', 'decimal'),
  after: fc.constantFrom('', '', '<!-- note -->', '<!---->', '<?pi some data?>'),
});

const genElement: Arbitrary<GenElement> = fc.record({
  local: ncName,
  mode: fc.constantFrom('inherit', 'default', 'prefixed'),
  prefix: fc.constantFrom(...DECLARABLE_PREFIXES),
  uri: namespaceUri,
  reuse: fc.boolean(),
  attrs: fc.array(genAttr, { maxLength: 4 }),
  texts: fc.array(genText, { maxLength: 4 }),
  parent: fc.nat(),
  selfClose: fc.boolean(),
  declarationsFirst: fc.boolean(),
  closeSpace: fc.constantFrom('', ' ', '\n'),
});

const genDocument: Arbitrary<GenDocument> = fc.record({
  elements: fc.array(genElement, { minLength: 1, maxLength: 10 }),
  declaration: fc.boolean(),
  prolog: fc.constantFrom('', '\n', '<!-- prolog -->\n', '<?pi x?>'),
  epilog: fc.constantFrom('', '\n', '<!-- end -->'),
});

/** What parseXmlTree should return, in a form that toEqual can compare. */
interface Expected {
  readonly ns: string;
  readonly local: string;
  readonly attrs: [string, string][];
  readonly text: string;
  readonly children: Expected[];
}

function plain(element: XmlElement): Expected {
  return {
    ns: element.ns,
    local: element.local,
    attrs: [...element.attrs],
    text: element.text,
    children: element.children.map(plain),
  };
}

const TEXT_REFS = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['\r', '&#13;'],
]);
const ATTR_REFS = new Map([...TEXT_REFS, ['"', '&quot;'], ["'", '&apos;'], ['\t', '&#9;'], ['\n', '&#10;']]);

/** Escapes markup characters, and CR so that line-end normalisation keeps it. */
const escapeText = (text: string): string => text.replace(/[&<>\r]/g, (c) => TEXT_REFS.get(c) ?? c);
/** Also escapes quotes, and TAB and LF so that attribute-value normalisation keeps them. */
const escapeAttr = (value: string): string => value.replace(/[&<>"'\t\n\r]/g, (c) => ATTR_REFS.get(c) ?? c);

function renderText({ text, mode }: GenText): string {
  switch (mode) {
    case 'escaped':
      return escapeText(text);
    case 'cdata':
      return text.includes(']]>') || text.includes('\r') ? escapeText(text) : `<![CDATA[${text}]]>`;
    case 'hex':
      return Array.from(text, (c) => `&#x${(c.codePointAt(0) ?? 0).toString(16)};`).join('');
    case 'decimal':
      return Array.from(text, (c) => `&#${String(c.codePointAt(0) ?? 0)};`).join('');
  }
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`index ${index} out of range`);
  return item;
}

/** Serialises a generated document and computes the tree parseXmlTree should build from it. */
function serialise(doc: GenDocument): { xml: string; expected: Expected } {
  const children: number[][] = doc.elements.map(() => []);
  for (let i = 1; i < doc.elements.length; i++) at(children, at(doc.elements, i).parent % i).push(i);

  const element = (index: number, scope: ReadonlyMap<string, string>): { xml: string; expected: Expected } => {
    const el = at(doc.elements, index);
    const inScope = new Map(scope);
    const declarations = new Map<string, string>();
    const declare = (prefix: string, uri: string): void => {
      declarations.set(prefix, uri);
      inScope.set(prefix, uri);
    };

    let qname = el.local;
    if (el.mode === 'default') declare('', el.uri);
    if (el.mode === 'prefixed') {
      if (!(el.reuse && inScope.has(el.prefix))) declare(el.prefix, el.uri === '' ? 'urn:empty' : el.uri);
      qname = `${el.prefix}:${el.local}`;
    }
    const ns = inScope.get(el.mode === 'prefixed' ? el.prefix : '') ?? '';

    const attrs: [string, string][] = [];
    let attrXml = '';
    for (const a of el.attrs) {
      let name = a.local;
      let key = a.local;
      if (a.prefix !== '') {
        if (!inScope.has(a.prefix)) declare(a.prefix, a.uri === '' ? 'urn:empty' : a.uri);
        name = `${a.prefix}:${a.local}`;
        key = `{${inScope.get(a.prefix) ?? ''}}${a.local}`;
      }
      // Attributes must be unique by expanded name.
      if (attrs.some(([existing]) => existing === key)) continue;
      attrs.push([key, a.value]);
      attrXml += `${a.space}${name}=${a.quote}${escapeAttr(a.value)}${a.quote}`;
    }
    let declXml = '';
    for (const [prefix, uri] of declarations) declXml += ` ${prefix === '' ? 'xmlns' : `xmlns:${prefix}`}="${escapeAttr(uri)}"`;

    let content = '';
    let text = '';
    const kids = at(children, index);
    const expectedChildren: Expected[] = [];
    for (let i = 0; i < Math.max(kids.length, el.texts.length); i++) {
      const segment = el.texts[i];
      if (segment !== undefined) {
        content += renderText(segment) + segment.after;
        text += segment.text;
      }
      const kid = kids[i];
      if (kid !== undefined) {
        const child = element(kid, inScope);
        content += child.xml;
        expectedChildren.push(child.expected);
      }
    }

    const open = `<${qname}${el.declarationsFirst ? declXml + attrXml : attrXml + declXml}${el.closeSpace}`;
    const xml = content === '' && el.selfClose ? `${open}/>` : `${open}>${content}</${qname}${el.closeSpace}>`;
    return { xml, expected: { ns, local: el.local, attrs, text, children: expectedChildren } };
  };

  const root = element(0, new Map([['xml', XML_NAMESPACE]]));
  const declaration = doc.declaration ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' : '';
  return { xml: declaration + doc.prolog + root.xml + doc.epilog, expected: root.expected };
}

describe('parseXmlTree round trip', () => {
  it('returns the names, namespaces, attributes and text that were serialised', () => {
    fc.assert(
      fc.property(genDocument, (doc) => {
        const { xml, expected } = serialise(doc);
        const tree = parseXmlTree(xml, { part: PART, limits: DEFAULT_LIMITS });
        expect(plain(tree)).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ----- decodeXml ------------------------------------------------------------------------------

const enc = new TextEncoder();
const BOMS = [[], [0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff]];
const DECLARATIONS = [
  '',
  '<?xml version="1.0"?>',
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<?xml encoding = 'utf-16'?>",
  '<?xml encoding="latin1"?>',
];

/** Random bytes, sometimes after a byte order mark and an XML declaration. */
const xmlBytes = fc.oneof(
  fc.uint8Array({ maxLength: 300, size: 'max' }),
  fc
    .tuple(fc.constantFrom(...BOMS), fc.constantFrom(...DECLARATIONS), fc.uint8Array({ maxLength: 100, size: 'max' }))
    .map(([bom, declaration, rest]) => new Uint8Array([...bom, ...enc.encode(declaration), ...rest])),
);

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2 + (littleEndian ? 0 : 1)] = code & 0xff;
    out[2 + i * 2 + (littleEndian ? 1 : 0)] = code >> 8;
  }
  return out;
}

describe('decodeXml', () => {
  it('returns a string or throws DV_E_XML_ENCODING on arbitrary bytes', () => {
    fc.assert(
      fc.property(xmlBytes, (bytes) => {
        const error = attempt(() => decodeXml(bytes, PART));
        if (error !== null) {
          expect(error.code).toBe('DV_E_XML_ENCODING');
          expect(error.location.part).toBe(PART);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('decodes any well-formed text encoded as UTF-8 or UTF-16 with a byte order mark', () => {
    // A leading U+FEFF would be read as a byte order mark; an XML declaration is tested above.
    const text = fc
      .string({ unit: 'binary', maxLength: 200, size: 'max' })
      .filter((s) => !s.startsWith('\u{FEFF}') && !s.startsWith('<?xml'));
    fc.assert(
      fc.property(text, (s) => {
        expect(decodeXml(enc.encode(s), PART)).toBe(s);
        expect(decodeXml(utf16(s, true), PART)).toBe(s);
        expect(decodeXml(utf16(s, false), PART)).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
