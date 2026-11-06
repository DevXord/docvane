// Copied from DevXord/xlvane tests/unit/xml-spans.test.ts, at aeaefbc, adapted for
// docvane (D-009): imports, DvError and DV_E_* codes.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';
import { normalizeLineEnds, parseXml, type XmlSpan } from '../../packages/docvane/src/xml/parser';

function spans(xml: string): { event: string; local: string; text: string; span: XmlSpan }[] {
  const out: { event: string; local: string; text: string; span: XmlSpan }[] = [];
  const s = normalizeLineEnds(xml);
  parseXml(
    xml,
    {
      start: (_ns, local, _attrs, span) => out.push({ event: 'start', local, text: s.slice(span.start, span.end), span }),
      end: (_ns, local, span) => out.push({ event: 'end', local, text: s.slice(span.start, span.end), span }),
      text: () => undefined,
    },
    { part: '/t.xml', limits: DEFAULT_LIMITS },
  );
  return out;
}

describe('XML tag spans', () => {
  it('give the exact source of start, end and empty-element tags', () => {
    const got = spans('<?xml version="1.0"?>\r\n<x:a xmlns:x="urn:x"><x:b k="1" >t</x:b ><x:c/></x:a>');
    expect(got.map((e) => [e.event, e.local, e.text])).toEqual([
      ['start', 'a', '<x:a xmlns:x="urn:x">'],
      ['start', 'b', '<x:b k="1" >'],
      ['end', 'b', '</x:b >'],
      ['start', 'c', '<x:c/>'],
      ['end', 'c', ''],
      ['end', 'a', '</x:a>'],
    ]);
    expect(got[0]?.span.qname).toBe('x:a');
    expect(got[3]?.span.empty).toBe(true);
  });

  it('use offsets into the line-end-normalised text', () => {
    const xml = '<a>\r\n<b/>\r</a>';
    const got = spans(xml);
    expect(normalizeLineEnds(xml)).toBe('<a>\n<b/>\n</a>');
    expect(got.find((e) => e.local === 'b')?.span.start).toBe(4);
  });
});
