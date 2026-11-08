// Copied from DevXord/xlvane tests/unit/xml.test.ts, at aeaefbc, adapted for
// tplvane (D-009): imports, TvError and TV_E_* codes.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';
import { TvError } from '../../packages/tplvane/src/errors';
import { decodeXml, parseXml, type XmlHandler } from '../../packages/tplvane/src/xml/parser';
import { parseXmlTree } from '../../packages/tplvane/src/xml/tree';

type Event =
  | ['start', string, string, Record<string, string>]
  | ['end', string, string]
  | ['text', string];

function events(xml: string, limits = DEFAULT_LIMITS): Event[] {
  const out: Event[] = [];
  const handler: XmlHandler = {
    start: (ns, local, attrs) => out.push(['start', ns, local, Object.fromEntries(attrs)]),
    end: (ns, local) => out.push(['end', ns, local]),
    text: (value) => {
      const last = out[out.length - 1];
      if (last?.[0] === 'text') last[1] += value;
      else out.push(['text', value]);
    },
  };
  parseXml(xml, handler, { part: '/test.xml', limits });
  return out;
}

function failure(fn: () => unknown): TvError {
  try {
    fn();
  } catch (error) {
    if (error instanceof TvError) return error;
    throw error;
  }
  throw new Error('expected an TvError');
}

const enc = new TextEncoder();

describe('parseXml', () => {
  it('reports elements, attributes and text in document order', () => {
    expect(events('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a x="1" y=\'2\'><b/>hi</a>')).toEqual([
      ['start', '', 'a', { x: '1', y: '2' }],
      ['start', '', 'b', {}],
      ['end', '', 'b'],
      ['text', 'hi'],
      ['end', '', 'a'],
    ]);
  });

  it('resolves default and prefixed namespaces; unprefixed attributes have no namespace', () => {
    const xml = '<a xmlns="urn:a" xmlns:r="urn:r" r:id="rId1" name="n"><r:b/><c xmlns="urn:c"/><d/></a>';
    expect(events(xml)).toEqual([
      ['start', 'urn:a', 'a', { '{urn:r}id': 'rId1', name: 'n' }],
      ['start', 'urn:r', 'b', {}],
      ['end', 'urn:r', 'b'],
      ['start', 'urn:c', 'c', {}],
      ['end', 'urn:c', 'c'],
      ['start', 'urn:a', 'd', {}],
      ['end', 'urn:a', 'd'],
      ['end', 'urn:a', 'a'],
    ]);
  });

  it('restores outer namespace bindings after an element that redeclares them', () => {
    const xml = '<p:a xmlns:p="urn:1"><p:b xmlns:p="urn:2"/><p:c/></p:a>';
    expect(events(xml).filter((e) => e[0] === 'start')).toEqual([
      ['start', 'urn:1', 'a', {}],
      ['start', 'urn:2', 'b', {}],
      ['start', 'urn:1', 'c', {}],
    ]);
  });

  it('binds the xml prefix without a declaration', () => {
    expect(events('<t xml:space="preserve"> x </t>')[0]).toEqual([
      'start',
      '',
      't',
      { '{http://www.w3.org/XML/1998/namespace}space': 'preserve' },
    ]);
  });

  it('expands the predefined entities and character references in text and attributes', () => {
    expect(events('<a v="&lt;&amp;&#65;&#x42;&quot;&apos;&gt;">&lt;&amp;&#65;&#x42;&#x1F600;&quot;&apos;&gt;</a>')).toEqual([
      ['start', '', 'a', { v: '<&AB"\'>' }],
      ['text', '<&AB😀"\'>'],
      ['end', '', 'a'],
    ]);
  });

  it('accepts character references with leading zeros (XML 1.0 allows any number of digits)', () => {
    expect(events('<a>&#x000000041;&#0000000066;</a>')[1]).toEqual(['text', 'AB']);
  });

  it('does not apply the name length limit to character references', () => {
    const limits = { ...DEFAULT_LIMITS, maxXmlNameLength: 1 };
    expect(events('<a>&#65;&#x10FFFF;</a>', limits)[1]).toEqual(['text', 'A\u{10FFFF}']);
  });

  it('applies the name length limit to entity names with a limit error', () => {
    const error = failure(() => events('<a>&abcdefgh;</a>', { ...DEFAULT_LIMITS, maxXmlNameLength: 4 }));
    expect(error.code).toBe('TV_E_LIMIT_EXCEEDED');
    expect(error.details['limit']).toBe('maxXmlNameLength');
  });

  it('returns CDATA content as text and skips comments and processing instructions', () => {
    expect(events('<!-- c --><a><![CDATA[<b>&amp;]]><!-- x --><?pi data?>z</a><!-- end -->')).toEqual([
      ['start', '', 'a', {}],
      ['text', '<b>&amp;z'],
      ['end', '', 'a'],
    ]);
  });

  it('normalises line ends to LF but keeps a CR written as a character reference', () => {
    expect(events('<a>1\r\n2\r3&#13;4</a>')[1]).toEqual(['text', '1\n2\n3\r4']);
  });

  it('normalises literal whitespace in attribute values but keeps character references', () => {
    expect(events('<a v="x\ty\nz\r\nw&#10;&#9;"/>')[0]).toEqual(['start', '', 'a', { v: 'x y z w\n\t' }]);
  });

  it('accepts whitespace around "=" and before the end of a tag', () => {
    expect(events('<a  x = "1"\n\t/>')[0]).toEqual(['start', '', 'a', { x: '1' }]);
  });

  it('accepts non-ASCII names', () => {
    expect(events('<zażółć ąę="1"/>')[0]).toEqual(['start', '', 'zażółć', { ąę: '1' }]);
  });

  it('keeps attributes in a Map so that names like __proto__ are plain data', () => {
    let attrs: ReadonlyMap<string, string> | undefined;
    parseXml('<a __proto__="x" constructor="y" prototype="z"/>', {
      start: (_ns, _local, a) => {
        attrs = a;
      },
      end: () => {},
      text: () => {},
    }, { part: '/t.xml', limits: DEFAULT_LIMITS });
    expect(attrs).toBeInstanceOf(Map);
    expect(attrs?.get('__proto__')).toBe('x');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it.each([
    ['mismatched end tag', '<a></b>'],
    ['unclosed root', '<a><b></b>'],
    ['two root elements', '<a/><b/>'],
    ['text before the root', 'x<a/>'],
    ['text after the root', '<a/>x'],
    ['no root element', '<!-- only a comment -->'],
    ['empty document', ''],
    ['"<" in an attribute value', '<a v="<"/>'],
    ['bare "&"', '<a>&</a>'],
    ['unterminated reference', '<a>&amp</a>'],
    ['character reference to U+0000', '<a>&#0;</a>'],
    ['character reference to a surrogate', '<a>&#xD800;</a>'],
    ['character reference beyond U+10FFFF', '<a>&#x110000;</a>'],
    ['raw control character', '<a>\u0001</a>'],
    ['raw U+FFFE', '<a>￾</a>'],
    ['"]]>" in text', '<a>]]></a>'],
    ['duplicate attribute', '<a x="1" x="2"/>'],
    ['duplicate attribute by expanded name', '<a xmlns:p="urn:x" xmlns:q="urn:x" p:v="1" q:v="2"/>'],
    ['unbound element prefix', '<p:a/>'],
    ['unbound attribute prefix', '<a p:v="1"/>'],
    ['undeclaring a prefix', '<a xmlns:p=""/>'],
    ['binding the xmlns prefix', '<a xmlns:xmlns="urn:x"/>'],
    ['binding xml to another namespace', '<a xmlns:xml="urn:x"/>'],
    ['"--" inside a comment', '<a><!-- a -- b --></a>'],
    ['XML declaration after the start', '<a><?xml version="1.0"?></a>'],
    ['XML declaration after whitespace', ' <?xml version="1.0"?><a/>'],
    ['attribute without value', '<a x/>'],
    ['attribute without quotes', '<a x=1/>'],
    ['missing whitespace between attributes', '<a x="1"y="2"/>'],
    ['invalid name start character', '<1a/>'],
    ['unterminated comment', '<a><!-- x </a>'],
    ['unterminated CDATA section', '<a><![CDATA[x</a>'],
    ['CDATA outside the root', '<![CDATA[x]]><a/>'],
    ['markup declaration other than DOCTYPE', '<a><!ELEMENT a ANY></a>'],
    ['"xmlns:" with an empty prefix', '<a xmlns:="urn:x"/>'],
    ['an uppercase X in a hexadecimal character reference', '<a>&#X41;</a>'],
    ['a character reference with too large a value', '<a>&#99999999999;</a>'],
    ['an XML declaration without a version', '<?xml?><a/>'],
    ['an XML declaration that does not start with the version', '<?xml encoding="UTF-8" version="1.0"?><a/>'],
  ])('rejects %s', (_label, xml) => {
    const error = failure(() => events(xml));
    expect(error.code).toBe('TV_E_XML_MALFORMED');
    expect(error.location.part).toBe('/test.xml');
  });

  it('reports the line and column of a syntax error', () => {
    const error = failure(() => events('<a>\n  <b>\n  </c>\n</a>'));
    expect(error.location).toMatchObject({ part: '/test.xml', line: 3, column: 3 });
  });

  it('rejects any document type declaration', () => {
    const error = failure(() => events('<!DOCTYPE a><a/>'));
    expect(error.code).toBe('TV_E_XML_DTD_FORBIDDEN');
  });

  it('rejects references to entities other than the predefined ones', () => {
    const error = failure(() => events('<a>&nbsp;</a>'));
    expect(error.code).toBe('TV_E_XML_ENTITY_FORBIDDEN');
    expect(error.details['entity']).toBe('nbsp');
  });

  describe('limits', () => {
    const tight = { ...DEFAULT_LIMITS, maxXmlDepth: 3, maxXmlAttributes: 2, maxXmlNameLength: 8, maxXmlTextLength: 10 };
    it.each([
      ['maxXmlDepth', '<a><b><c><d/></c></b></a>'],
      ['maxXmlAttributes', '<a x="1" y="2" z="3"/>'],
      ['maxXmlNameLength', '<abcdefghi/>'],
      ['maxXmlNameLength', '<a abcdefghi="1"/>'],
      ['maxXmlTextLength', '<a>12345678901</a>'],
      ['maxXmlTextLength', '<a>12345&amp;67890</a>'],
      ['maxXmlTextLength', '<a><![CDATA[123456]]>789012</a>'],
      ['maxXmlTextLength', '<a v="12345678901"/>'],
    ])('enforces %s', (limit, xml) => {
      const error = failure(() => events(xml, tight));
      expect(error.code).toBe('TV_E_LIMIT_EXCEEDED');
      expect(error.details['limit']).toBe(limit);
    });

    it('accepts input exactly at the limits', () => {
      expect(() => events('<a><b><c x="1" y="2">1234567890</c></b></a>', tight)).not.toThrow();
    });
  });
});

describe('decodeXml', () => {
  it('decodes UTF-8 with and without a byte order mark', () => {
    expect(decodeXml(enc.encode('<a>ż</a>'), '/t.xml')).toBe('<a>ż</a>');
    expect(decodeXml(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('<a/>')]), '/t.xml')).toBe('<a/>');
  });

  it('decodes UTF-16 little and big endian with a byte order mark', () => {
    const text = '<?xml version="1.0" encoding="UTF-16"?><a>ż</a>';
    const le = new Uint8Array(2 + text.length * 2);
    const be = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    be.set([0xfe, 0xff]);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      le[2 + i * 2] = code & 0xff;
      le[3 + i * 2] = code >> 8;
      be[2 + i * 2] = code >> 8;
      be[3 + i * 2] = code & 0xff;
    }
    expect(decodeXml(le, '/t.xml')).toBe(text);
    expect(decodeXml(be, '/t.xml')).toBe(text);
  });

  it('rejects invalid UTF-8', () => {
    const error = failure(() => decodeXml(new Uint8Array([0x3c, 0x61, 0x3e, 0xc3, 0x28, 0x3c]), '/t.xml'));
    expect(error.code).toBe('TV_E_XML_ENCODING');
    expect(error.location.part).toBe('/t.xml');
  });

  it('rejects encodings other than UTF-8 and UTF-16', () => {
    const error = failure(() => decodeXml(enc.encode('<?xml version="1.0" encoding="ISO-8859-1"?><a/>'), '/t.xml'));
    expect(error.code).toBe('TV_E_XML_ENCODING');
  });

  it('accepts an encoding declaration of UTF-8 in any letter case', () => {
    expect(decodeXml(enc.encode('<?xml version="1.0" encoding="utf-8"?><a/>'), '/t.xml')).toContain('<a/>');
  });
});

describe('parseXmlTree', () => {
  it('builds a tree of elements with their attributes and direct text', () => {
    const root = parseXmlTree('<a xmlns="urn:a"><b k="v">x<c/>y</b></a>', { part: '/t.xml', limits: DEFAULT_LIMITS });
    expect(root.ns).toBe('urn:a');
    expect(root.local).toBe('a');
    const b = root.children[0];
    expect(b?.local).toBe('b');
    expect(b?.attrs.get('k')).toBe('v');
    expect(b?.text).toBe('xy');
    expect(b?.children[0]?.local).toBe('c');
  });

  it('enforces maxXmlTreeElements', () => {
    const error = failure(() =>
      parseXmlTree('<a><b/><b/><b/></a>', { part: '/t.xml', limits: { ...DEFAULT_LIMITS, maxXmlTreeElements: 3 } }),
    );
    expect(error.code).toBe('TV_E_LIMIT_EXCEEDED');
    expect(error.details['limit']).toBe('maxXmlTreeElements');
  });
});
