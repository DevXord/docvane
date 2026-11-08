// Charts and SmartArt diagrams in repeated content of a Word document (D-078). ECMA-376 Part 1
// §14.2.1: "A package shall contain a Chart part for each chart in the document"; §14.2.4: "A
// package shall contain exactly one Diagram Data part per diagram". A copy of repeated content
// would point at the same part as the first one, so the second and later copies are refused, as
// for footnotes and as for slides with charts.
import { describe, expect, it } from 'vitest';
import { inspect, render, validate } from 'tplvane';
import { buildDocx, p } from '../helpers/docx';
import { expectDvError } from '../helpers/expect-error';
import { partXml } from '../helpers/read-docx';
import { openZip } from '../../packages/tplvane/src/zip/reader';
import { writeZip } from '../../packages/tplvane/src/zip/writer';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const STRICT_CHART = 'http://purl.oclc.org/ooxml/drawingml/chart';
const DIAGRAM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';

const chartPart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${CHART}" xmlns:a="${A}" xmlns:r="${R}"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;

/** A paragraph with an inline drawing whose graphic data is `graphic`. */
const drawing = (uri: string, graphic: string): string =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:extent cx="3000000" cy="2000000"/><wp:docPr id="1" name="Graphic 1"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${uri}">${graphic}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
const chart = (ns = CHART): string => drawing(ns, `<c:chart xmlns:c="${ns}" r:id="rIdChart"/>`);
const diagram = drawing(DIAGRAM, `<dgm:relIds xmlns:dgm="${DIAGRAM}" r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/>`);

/** A document with a chart part, its relationship and its content type. */
function withChart(body: string): Uint8Array {
  const raw = buildDocx({ body, documentRels: [`<Relationship Id="rIdChart" Type="${R}/chart" Target="charts/chart1.xml"/>`], extra: { 'word/charts/chart1.xml': chartPart } });
  const zip = openZip(raw, DEFAULT_LIMITS);
  return writeZip(
    zip.entries.map((e) => {
      const data = zip.read(e);
      if (e.name !== '[Content_Types].xml') return { name: e.name, data };
      const xml = new TextDecoder().decode(data).replace('</Types>', '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>');
      return { name: e.name, data: new TextEncoder().encode(xml) };
    }),
  );
}

const loop = (inner: string): string => p('{#items}') + p('{name}') + inner + p('{/items}');
const two = { items: [{ name: 'one' }, { name: 'two' }] };

describe('charts in repeated content of a document', () => {
  it('are refused when the content repeats more than once, by render and by validate', () => {
    const template = withChart(loop(chart()));
    const error = expectDvError(() => render(template, two), 'TV_E_NOT_SUPPORTED');
    expect(error.message).toMatch(/chart/);
    expect(error.hint).toMatch(/chart/);
    expect(validate(template, two).errors.map((e) => e.code)).toContain('TV_E_NOT_SUPPORTED');
  });

  it('are kept when the content is shown once, or when the chart is outside the repeated content', () => {
    const once = partXml(render(withChart(loop(chart())), { items: [{ name: 'one' }] }));
    expect(once.match(/<c:chart /g)).toHaveLength(1);
    const outside = partXml(render(withChart(chart() + loop('')), two));
    expect(outside.match(/<c:chart /g)).toHaveLength(1);
    expect(outside).toContain('two');
  });

  it('are refused in Strict documents too', () => {
    expectDvError(() => render(withChart(loop(chart(STRICT_CHART))), two), 'TV_E_NOT_SUPPORTED');
  });

  it('do not stop inspect, which reads the template without data', () => {
    expect(inspect(withChart(loop(chart()))).tags.map((t) => t.raw)).toEqual(['{#items}', '{name}', '{/items}']);
  });
});

describe('SmartArt diagrams in repeated content of a document', () => {
  it('are refused when the content repeats more than once', () => {
    const template = buildDocx({ body: loop(diagram) });
    const error = expectDvError(() => render(template, two), 'TV_E_NOT_SUPPORTED');
    expect(error.message).toMatch(/SmartArt|diagram/);
  });
});

describe('validate and content that cannot repeat', () => {
  it('lists a footnote in content that repeats as an error, and still throws for a broken template', () => {
    const ref = '<w:r><w:footnoteReference w:id="2"/></w:r>';
    const template = buildDocx({ body: p('{#items}') + p('{name}', ref) + p('{/items}'), footnotes: [p('Note')] });
    const result = validate(template, two);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['TV_E_NOT_SUPPORTED']);
    expect(validate(template, { items: [{ name: 'one' }] }).valid).toBe(true);
    expectDvError(() => validate(buildDocx({ body: p('{#items}') }), two), 'TV_E_TEMPLATE_INVALID');
  });
});
