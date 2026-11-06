// Copied from DevXord/xlvane tests/unit/opc.test.ts, at aeaefbc, adapted for
// docvane (D-009): imports, DvError and DV_E_* codes.
// OPC package layer: part names, the Media Types stream and relationships (ECMA-376 Part 2;
// facts F-OPC-01 … F-OPC-15 of xlvane).
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ReadLimits } from '../../packages/docvane/src/limits';
import { openPackage, relationshipsPartName, resolveTarget, type OpcPackage } from '../../packages/docvane/src/opc/package';
import { isPartName } from '../../packages/docvane/src/opc/part-name';
import { openZip } from '../../packages/docvane/src/zip/reader';
import { expectDvError } from '../helpers/expect-error';
import { buildZip } from '../helpers/raw-zip';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WORKSHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

type Files = [name: string, data: string | Uint8Array][];

function types(...items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${CT_NS}">${items.join('')}</Types>`;
}

function rels(...items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${items.join('')}</Relationships>`;
}

const DEFAULT_TYPES = types(
  `<Default Extension="rels" ContentType="${RELS_TYPE}"/>`,
  '<Default Extension="xml" ContentType="application/xml"/>',
  `<Override PartName="/xl/workbook.xml" ContentType="${MAIN_TYPE}"/>`,
);

function open(files: Files, limits: ReadLimits = DEFAULT_LIMITS): OpcPackage {
  const zip = openZip(buildZip(files.map(([name, data]) => ({ name, data }))), limits);
  return openPackage(zip, limits);
}

/** A package with a content types stream plus the given files. */
function withTypes(files: Files, contentTypes = DEFAULT_TYPES): OpcPackage {
  return open([['[Content_Types].xml', contentTypes], ...files]);
}

describe('part names (ZIP item names to part names)', () => {
  it('adds a leading slash and leaves the Media Types stream and folders out', () => {
    const pkg = withTypes([
      ['_rels/.rels', rels()],
      ['xl/', ''],
      ['xl/workbook.xml', '<workbook/>'],
      ['docProps/core.xml', '<x/>'],
    ]);
    expect(pkg.partNames).toEqual(['/_rels/.rels', '/xl/workbook.xml', '/docProps/core.xml']);
    expect(pkg.hasPart('/[Content_Types].xml')).toBe(false);
    expect(pkg.hasPart('/xl')).toBe(false);
    expect(pkg.hasPart('/xl/')).toBe(false);
  });

  it('un-percent-encodes non-ASCII characters only (§7.3.5)', () => {
    const pkg = withTypes([
      ['xl/media/%D1%86.png', 'png'],
      ['xl/a%20b.xml', '<x/>'],
    ]);
    expect(pkg.partNames).toEqual(['/xl/media/ц.png', '/xl/a%20b.xml']);
    expect(pkg.readBytes('/xl/media/ц.png')).toEqual(new TextEncoder().encode('png'));
  });

  it('maps a raw UTF-8 ZIP name to the same decoded part name', () => {
    const pkg = withTypes([['xl/ц.xml', '<x/>']]);
    expect(pkg.partNames).toEqual(['/xl/ц.xml']);
  });

  it('rejects two ZIP items that map to equivalent part names', () => {
    const error = expectDvError(
      () => withTypes([['xl/ц.xml', '<x/>'], ['xl/%D1%86.xml', '<y/>']]),
      'DV_E_PART_INVALID',
    );
    expect(error.location.part).toBe('/xl/ц.xml');
  });

  it('does not map items whose names break the part name grammar (§7.2.5.5)', () => {
    const pkg = withTypes([
      ['[trash]/0000.dat', 'old'],
      ['a b.xml', '<x/>'],
      ['x/../y.xml', '<x/>'],
      ['x/./y.xml', '<x/>'],
      ['seg./x.xml', '<x/>'],
      ['dir\\file.xml', '<x/>'],
      ['a//b.xml', '<x/>'],
      ['xl/%41.xml', '<x/>'],
      ['xl/%2Fx.xml', '<x/>'],
      ['xl/%5cx.xml', '<x/>'],
      ['xl/100%.xml', '<x/>'],
      ['xl/q?.xml', '<x/>'],
      ['xl/h#.xml', '<x/>'],
      ['spine.xml/[0].piece', 'p'],
      ['spine.xml/[1].last.piece', 'p'],
      ['ok.xml', '<x/>'],
    ]);
    expect(pkg.partNames).toEqual(['/ok.xml']);
    expect(pkg.readBytes('/[trash]/0000.dat')).toBeUndefined();
  });

  it('compares part names ASCII case-insensitively (§6.2.2.3)', () => {
    const pkg = withTypes([['xl/Workbook.xml', '<w/>'], ['x/ż.xml', '<z/>']]);
    expect(pkg.hasPart('/XL/WORKBOOK.XML')).toBe(true);
    expect(pkg.hasPart('/xl/workbook.xml')).toBe(true);
    expect(pkg.readXml('/xl/workbook.XML')).toBe('<w/>');
    // Only A-Z are folded; other letters are compared exactly.
    expect(pkg.hasPart('/x/ż.xml')).toBe(true);
    expect(pkg.hasPart('/X/Ż.xml')).toBe(false);
  });
});

describe('isPartName', () => {
  it('accepts names that match the grammar', () => {
    for (const name of ['/a', '/xl/workbook.xml', '/_rels/.rels', "/a!$&'()*+,;=:@-._~/b", '/%20', '/ü/日本.xml', '/a%25b']) {
      expect(isPartName(name), name).toBe(true);
    }
  });

  it('rejects names that break the grammar or its constraints', () => {
    for (const name of [
      '',
      '/',
      'a.xml',
      '/a/',
      '//a',
      '/a.',
      '/a/../b',
      '/a/./b',
      '/a%2fb',
      '/a%5Cb',
      '/%41',
      '/%7e',
      '/%C3%BC',
      '/%',
      '/%4',
      '/%zz',
      '/a b',
      '/a[1]',
      '/a\\b',
      '/a?b',
      '/a#b',
      '/a"b',
      '/a\u0000b',
      '/',
    ]) {
      expect(isPartName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe('Media Types stream', () => {
  it('is required: a package without it is rejected with a hint', () => {
    const error = expectDvError(() => open([['xl/workbook.xml', '<w/>']]), 'DV_E_PART_MISSING');
    expect(error.location.part).toBe('/[Content_Types].xml');
    expect(error.hint).toMatch(/\.xlsx|Re-save/);
  });

  it('is found case-insensitively', () => {
    const pkg = open([
      ['[content_types].XML', DEFAULT_TYPES],
      ['xl/workbook.xml', '<w/>'],
    ]);
    expect(pkg.contentType('/xl/workbook.xml')).toBe(MAIN_TYPE);
    expect(pkg.partNames).toEqual(['/xl/workbook.xml']);
  });

  it('explains when only interleaved pieces of it exist', () => {
    const error = expectDvError(
      () => open([['[Content_Types].xml/[0].last.piece', DEFAULT_TYPES]]),
      'DV_E_PART_MISSING',
    );
    expect(error.message).toMatch(/interleav/i);
  });

  it('applies Override first, then Default by extension (§7.2.3.5)', () => {
    const pkg = withTypes(
      [
        ['xl/workbook.xml', '<w/>'],
        ['xl/styles.xml', '<s/>'],
        ['xl/media/image1.PNG', 'png'],
        ['a/b.tar.gz', 'gz'],
        ['noext', 'x'],
        ['a.b/noext', 'x'],
        ['special', 'x'],
      ],
      types(
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Default Extension="png" ContentType="image/png"/>',
        '<Default Extension="GZ" ContentType="application/gzip"/>',
        '<Default Extension="b" ContentType="wrong/dot-in-folder"/>',
        `<Override PartName="/XL/Workbook.xml" ContentType="${MAIN_TYPE}"/>`,
        '<Override PartName="/special" ContentType="text/special"/>',
      ),
    );
    expect(pkg.contentType('/xl/workbook.xml')).toBe(MAIN_TYPE);
    expect(pkg.contentType('/xl/styles.xml')).toBe('application/xml');
    expect(pkg.contentType('/xl/media/image1.PNG')).toBe('image/png');
    expect(pkg.contentType('/a/b.tar.gz')).toBe('application/gzip');
    expect(pkg.contentType('/noext')).toBeUndefined();
    expect(pkg.contentType('/a.b/noext')).toBeUndefined();
    expect(pkg.contentType('/special')).toBe('text/special');
    expect(pkg.contentType('/missing.png')).toBe('image/png');
  });

  it('matches Override part names written with percent-encoded non-ASCII characters', () => {
    const pkg = withTypes(
      [['xl/%D1%86.xml', '<x/>']],
      types('<Override PartName="/xl/%D1%86.xml" ContentType="text/x-test"/>'),
    );
    expect(pkg.contentType('/xl/ц.xml')).toBe('text/x-test');
  });

  it('gives Relationships parts the relationships media type when the stream does not list them', () => {
    const pkg = withTypes([['_rels/.rels', rels()], ['xl/_rels/workbook.xml.rels', rels()]], types());
    expect(pkg.contentType('/_rels/.rels')).toBe(RELS_TYPE);
    expect(pkg.contentType('/xl/_rels/workbook.xml.rels')).toBe(RELS_TYPE);
    expect(pkg.contentType('/xl/workbook.xml')).toBeUndefined();
  });

  it('accepts an empty Types element, ignores unknown elements and attributes', () => {
    expect(withTypes([['a.xml', '<a/>']], types()).contentType('/a.xml')).toBeUndefined();
    const pkg = withTypes(
      [['a.xml', '<a/>']],
      `<Types xmlns="${CT_NS}" xmlns:x="urn:x" x:extra="1"><x:Foo/><Default Extension="xml" ContentType="text/xml" Unknown="y"/><x:Default Extension="xml" ContentType="bad/type"/></Types>`,
    );
    expect(pkg.contentType('/a.xml')).toBe('text/xml');
  });

  it('decodes UTF-16 content', () => {
    const text = DEFAULT_TYPES.replace('UTF-8', 'UTF-16');
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    const pkg = open([['[Content_Types].xml', bytes], ['xl/workbook.xml', '<w/>']]);
    expect(pkg.contentType('/xl/workbook.xml')).toBe(MAIN_TYPE);
  });

  it('rejects a root element that is not Types in the content-types namespace', () => {
    for (const xml of [
      `<Types xmlns="${REL_NS}"/>`,
      '<Types/>',
      `<Relationships xmlns="${CT_NS}"/>`,
      `<ct:Types xmlns:ct="${CT_NS}.wrong"/>`,
    ]) {
      const error = expectDvError(() => withTypes([], xml), 'DV_E_PART_INVALID');
      expect(error.location.part).toBe('/[Content_Types].xml');
    }
    expect(withTypes([['a.xml', '']], `<ct:Types xmlns:ct="${CT_NS}"><ct:Default Extension="xml" ContentType="t/x"/></ct:Types>`).contentType('/a.xml')).toBe('t/x');
  });

  it('rejects Default and Override elements without their required attributes', () => {
    for (const item of [
      '<Default ContentType="text/xml"/>',
      '<Default Extension="xml"/>',
      '<Override ContentType="text/xml"/>',
      '<Override PartName="/a.xml"/>',
    ]) {
      expectDvError(() => withTypes([], types(item)), 'DV_E_PART_INVALID');
    }
  });

  it('rejects two Defaults for one extension and two Overrides for one part name (case-insensitive)', () => {
    expectDvError(
      () => withTypes([], types('<Default Extension="xml" ContentType="a/b"/>', '<Default Extension="XML" ContentType="c/d"/>')),
      'DV_E_PART_INVALID',
    );
    expectDvError(
      () => withTypes([], types('<Override PartName="/a.xml" ContentType="a/b"/>', '<Override PartName="/A.XML" ContentType="c/d"/>')),
      'DV_E_PART_INVALID',
    );
  });

  it('rejects DTDs and non-UTF encodings (§6.2.5 a, b)', () => {
    expectDvError(
      () => withTypes([], `<!DOCTYPE Types [<!ENTITY x "y">]><Types xmlns="${CT_NS}"/>`),
      'DV_E_XML_DTD_FORBIDDEN',
    );
    expectDvError(
      () => withTypes([], `<?xml version="1.0" encoding="ISO-8859-1"?><Types xmlns="${CT_NS}"/>`),
      'DV_E_XML_ENCODING',
    );
    expectDvError(() => withTypes([], `<Types xmlns="${CT_NS}">`), 'DV_E_XML_MALFORMED');
  });
});

describe('relationshipsPartName', () => {
  it('follows §6.5.2.2 and §6.5.2.3', () => {
    expect(relationshipsPartName(null)).toBe('/_rels/.rels');
    expect(relationshipsPartName('/foo')).toBe('/_rels/foo.rels');
    expect(relationshipsPartName('/foo/bar.xml')).toBe('/foo/_rels/bar.xml.rels');
    expect(relationshipsPartName('/xl/workbook.xml')).toBe('/xl/_rels/workbook.xml.rels');
    expect(relationshipsPartName('/xl/worksheets/sheet1.xml')).toBe('/xl/worksheets/_rels/sheet1.xml.rels');
  });
});

describe('resolveTarget', () => {
  it('resolves the examples of §6.4.3 against a part', () => {
    expect(resolveTarget('/a/b/foo.xml', '/b/bar.xml')).toBe('/b/bar.xml');
    expect(resolveTarget('/a/b/foo.xml', 'bar.xml')).toBe('/a/b/bar.xml');
    expect(resolveTarget('/a/b/foo.xml', './bar.xml')).toBe('/a/b/bar.xml');
    expect(resolveTarget('/a/b/foo.xml', '../bar.xml')).toBe('/a/bar.xml');
  });

  it('resolves the examples of §6.4.3 against the package root', () => {
    expect(resolveTarget(null, '/b/bar.xml')).toBe('/b/bar.xml');
    expect(resolveTarget(null, 'bar.xml')).toBe('/bar.xml');
    expect(resolveTarget(null, './bar.xml')).toBe('/bar.xml');
    expect(resolveTarget(null, '../bar.xml')).toBe('/bar.xml');
    expect(resolveTarget(null, 'xl/workbook.xml')).toBe('/xl/workbook.xml');
  });

  it('collapses dot segments that climb above the root (RFC 3986 remove_dot_segments)', () => {
    expect(resolveTarget('/xl/workbook.xml', '../../../etc/passwd')).toBe('/etc/passwd');
    expect(resolveTarget('/xl/workbook.xml', '/../x.xml')).toBe('/x.xml');
    expect(resolveTarget('/xl/worksheets/sheet1.xml', '../drawings/./a/../drawing1.xml')).toBe('/xl/drawings/drawing1.xml');
    expect(resolveTarget('/xl/workbook.xml', 'a/..')).toBeNull();
    expect(resolveTarget('/xl/workbook.xml', '..')).toBeNull();
  });

  it('ignores query and fragment (§6.3.2)', () => {
    expect(resolveTarget('/xl/workbook.xml', 'worksheets/sheet1.xml#A1')).toBe('/xl/worksheets/sheet1.xml');
    expect(resolveTarget('/xl/workbook.xml', 'sheet.xml?x=1#y')).toBe('/xl/sheet.xml');
    expect(resolveTarget('/xl/workbook.xml', '#only')).toBe('/xl/workbook.xml');
  });

  it('decodes percent-encoded unreserved characters before resolving', () => {
    expect(resolveTarget('/xl/workbook.xml', '%77orksheets/s%2Exml')).toBe('/xl/worksheets/s.xml');
    expect(resolveTarget('/xl/workbook.xml', 'media/%D1%86.png')).toBe('/xl/media/ц.png');
    expect(resolveTarget('/xl/workbook.xml', 'media/ц.png')).toBe('/xl/media/ц.png');
    expect(resolveTarget('/xl/workbook.xml', '%2E%2E/x.xml')).toBe('/x.xml');
    expect(resolveTarget('/xl/workbook.xml', 'a%20b.xml')).toBe('/xl/a%20b.xml');
    expect(resolveTarget('/xl/workbook.xml', 'a%2fb.xml')).toBeNull();
  });

  it('returns null for references that are not relative references to a part', () => {
    for (const target of [
      'http://example.com/a.xml',
      'https://example.com/',
      'pack://http%3c,,www.example.com,a.package/a.xml',
      'mailto:a@example.com',
      'c:x.xml',
      '//host/a.xml',
      '..\\x.xml',
      'a b.xml',
      'dir/',
      'a.',
      'x//y.xml',
      'a[1].xml',
      '%zz.xml',
    ]) {
      expect(resolveTarget('/xl/workbook.xml', target), target).toBeNull();
    }
    expect(resolveTarget(null, '')).toBeNull();
    expect(resolveTarget('/xl/workbook.xml', '')).toBe('/xl/workbook.xml');
    expect(resolveTarget('/xl/workbook.xml', './c:x.xml')).toBe('/xl/c:x.xml');
  });
});

describe('relationships', () => {
  const pkgRels = rels(
    `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="xl/workbook.xml"/>`,
    `<Relationship Id="rId2" Type="http://example.com/x" Target="docProps/app.xml" TargetMode="Internal"/>`,
  );
  const wbRels = rels(
    `<Relationship Id="rId1" Type="${WORKSHEET}" Target="worksheets/sheet1.xml"/>`,
    `<Relationship Id="rId2" Type="${WORKSHEET}" Target="/xl/worksheets/sheet2.xml"/>`,
    `<Relationship Id="rId3" Type="${HYPERLINK}" Target="https://example.com/a?b=1#c" TargetMode="External"/>`,
    `<Relationship Id="rId4" Type="${HYPERLINK}" Target="..\\not a part" TargetMode="External"/>`,
  );

  it('reads package relationships, resolved against the root', () => {
    const pkg = withTypes([['_rels/.rels', pkgRels], ['xl/workbook.xml', '<w/>']]);
    expect(pkg.relationships(null)).toEqual([
      { id: 'rId1', type: OFFICE_DOC, target: '/xl/workbook.xml', external: false },
      { id: 'rId2', type: 'http://example.com/x', target: '/docProps/app.xml', external: false },
    ]);
  });

  it('reads part relationships, resolved against the source part; external targets stay as written', () => {
    const pkg = withTypes([['xl/workbook.xml', '<w/>'], ['xl/_rels/workbook.xml.rels', wbRels]]);
    expect(pkg.relationships('/xl/workbook.xml')).toEqual([
      { id: 'rId1', type: WORKSHEET, target: '/xl/worksheets/sheet1.xml', external: false },
      { id: 'rId2', type: WORKSHEET, target: '/xl/worksheets/sheet2.xml', external: false },
      { id: 'rId3', type: HYPERLINK, target: 'https://example.com/a?b=1#c', external: true },
      { id: 'rId4', type: HYPERLINK, target: '..\\not a part', external: true },
    ]);
  });

  it('returns an empty list when the Relationships part is absent', () => {
    const pkg = withTypes([['xl/workbook.xml', '<w/>']]);
    expect(pkg.relationships(null)).toEqual([]);
    expect(pkg.relationships('/xl/workbook.xml')).toEqual([]);
    expect(pkg.relationships('/does/not/exist.xml')).toEqual([]);
  });

  it('finds the Relationships part case-insensitively and caches the result', () => {
    const pkg = withTypes([['XL/_RELS/Workbook.xml.rels', wbRels]]);
    const first = pkg.relationships('/xl/workbook.xml');
    expect(first).toHaveLength(4);
    expect(pkg.relationships('/XL/WORKBOOK.XML')).toBe(first);
  });

  it('keeps Type exactly as written (case-sensitive)', () => {
    const pkg = withTypes([['_rels/.rels', rels(`<Relationship Id="a" Type="HTTP://Example.com/T" Target="x.xml"/>`)]]);
    expect(pkg.relationships(null)[0]?.type).toBe('HTTP://Example.com/T');
  });

  it('accepts an empty Relationships element and ignores unknown elements and attributes', () => {
    expect(withTypes([['_rels/.rels', rels()]]).relationships(null)).toEqual([]);
    const pkg = withTypes([
      [
        '_rels/.rels',
        `<Relationships xmlns="${REL_NS}" xmlns:x="urn:x"><x:Note/><Relationship Id="a" Type="t" Target="x.xml" x:extra="1" Other="2"/><x:Relationship Id="b" Type="t" Target="y.xml"/></Relationships>`,
      ],
    ]);
    expect(pkg.relationships(null)).toEqual([{ id: 'a', type: 't', target: '/x.xml', external: false }]);
  });

  it('rejects a duplicate Id (§6.5.3.4)', () => {
    const pkg = withTypes([
      ['_rels/.rels', rels('<Relationship Id="rId1" Type="t" Target="a.xml"/>', '<Relationship Id="rId1" Type="u" Target="b.xml"/>')],
    ]);
    const error = expectDvError(() => pkg.relationships(null), 'DV_E_PART_INVALID');
    expect(error.location.part).toBe('/_rels/.rels');
    // Ids are xsd:ID values and compare case-sensitively.
    const ok = withTypes([
      ['_rels/.rels', rels('<Relationship Id="rId1" Type="t" Target="a.xml"/>', '<Relationship Id="RID1" Type="u" Target="b.xml"/>')],
    ]);
    expect(ok.relationships(null)).toHaveLength(2);
  });

  it('rejects relationships without Id, Type or Target', () => {
    for (const item of [
      '<Relationship Type="t" Target="a.xml"/>',
      '<Relationship Id="a" Target="a.xml"/>',
      '<Relationship Id="a" Type="t"/>',
    ]) {
      const pkg = withTypes([['xl/_rels/workbook.xml.rels', rels(item)]]);
      const error = expectDvError(() => pkg.relationships('/xl/workbook.xml'), 'DV_E_PART_INVALID');
      expect(error.location.part).toBe('/xl/_rels/workbook.xml.rels');
    }
  });

  it('rejects an unknown TargetMode', () => {
    for (const mode of ['external', 'Extern', '']) {
      const pkg = withTypes([['_rels/.rels', rels(`<Relationship Id="a" Type="t" Target="a.xml" TargetMode="${mode}"/>`)]]);
      expectDvError(() => pkg.relationships(null), 'DV_E_PART_INVALID');
    }
  });

  it('rejects an internal Target that is not a relative reference to a part', () => {
    for (const target of ['http://example.com/a.xml', '//host/a.xml', 'a\\b.xml', 'dir/']) {
      const pkg = withTypes([['_rels/.rels', rels(`<Relationship Id="a" Type="t" Target="${target}"/>`)]]);
      const error = expectDvError(() => pkg.relationships(null), 'DV_E_PART_INVALID');
      expect(error.details).toMatchObject({ id: 'a', target });
    }
  });

  it('rejects a root element that is not Relationships in the relationships namespace', () => {
    for (const xml of [`<Relationships xmlns="${CT_NS}"/>`, '<Relationships/>', `<Types xmlns="${REL_NS}"/>`]) {
      const pkg = withTypes([['_rels/.rels', xml]]);
      expectDvError(() => pkg.relationships(null), 'DV_E_PART_INVALID');
    }
  });

  it('rejects DTDs in Relationships parts', () => {
    const pkg = withTypes([['_rels/.rels', `<!DOCTYPE Relationships><Relationships xmlns="${REL_NS}"/>`]]);
    expectDvError(() => pkg.relationships(null), 'DV_E_XML_DTD_FORBIDDEN');
  });
});

describe('reading parts', () => {
  it('returns bytes and decoded text, or undefined for missing parts', () => {
    const utf16 = new Uint8Array([0xfe, 0xff, 0, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e]);
    const pkg = withTypes([
      ['xl/workbook.xml', '﻿<w>zażółć</w>'],
      ['xl/u16.xml', utf16],
      ['xl/media/a.bin', new Uint8Array([1, 2, 3])],
    ]);
    expect(pkg.readXml('/xl/workbook.xml')).toBe('<w>zażółć</w>');
    expect(pkg.readXml('/xl/u16.xml')).toBe('<a/>');
    expect(pkg.readBytes('/xl/media/a.bin')).toEqual(new Uint8Array([1, 2, 3]));
    expect(pkg.readXml('/xl/missing.xml')).toBeUndefined();
    expect(pkg.readBytes('/xl/missing.bin')).toBeUndefined();
    expect(pkg.readXml('/[Content_Types].xml')).toBeUndefined();
    expect(pkg.readBytes('[Content_Types].xml')).toBeUndefined();
  });

  it('reports encoding errors with the part name', () => {
    const pkg = withTypes([['xl/bad.xml', new Uint8Array([0x3c, 0xff, 0x3e])]]);
    const error = expectDvError(() => pkg.readXml('/xl/bad.xml'), 'DV_E_XML_ENCODING');
    expect(error.location.part).toBe('/xl/bad.xml');
  });
});
