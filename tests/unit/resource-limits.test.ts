// Regression tests of the second security review (D-062): templates and data that made rendering
// use far more memory or time than the limits allow. Each must now fail fast with
// DV_E_LIMIT_EXCEEDED, or render in time proportional to its output.
import { describe, expect, it } from 'vitest';
import { render, inspect } from 'docvane';
import { buildDocx, p, run } from '../helpers/docx';
import { ap, buildPptx, sp } from '../helpers/pptx';
import { buildXlsx, type SheetSpec } from '../helpers/xlsx';
import { png } from '../helpers/images';
import { partXml, zipNames } from '../helpers/read-docx';
import { expectDvError } from '../helpers/expect-error';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('resource limits', () => {
  it('counts the copied cells of repeated rows against maxOutputBytes before building them', () => {
    const sheet: Record<string, unknown> = { A1: '{#items}{.}' };
    for (let c = 1; c <= 200; c++) sheet[`${String.fromCharCode(66 + (c % 20))}${String(1 + Math.floor(c / 20))}`] = 'constant text';
    sheet['A11'] = '{/items}';
    const started = Date.now();
    expectDvError(() => render(buildXlsx({ Data: sheet as SheetSpec }), { items: Array.from({ length: 500 }, (_, i) => i) }, { limits: { maxOutputBytes: 100_000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxOutputBytes' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('counts the relationships of repeated slides against maxOutputBytes', () => {
    const rels = Array.from({ length: 2000 }, (_, i) => `<Relationship Id="rIdX${String(i)}" Type="${REL}/hyperlink" Target="https://example.com/${String(i)}/${'x'.repeat(60)}" TargetMode="External"/>`);
    const template = buildPptx([{ shapes: sp('S', ap('{#items}')) + sp('N', ap('{name}')) + sp('E', ap('{/items}')), rels }]);
    expectDvError(() => render(template, { items: Array.from({ length: 200 }, (_, i) => ({ name: String(i) })) }, { limits: { maxOutputBytes: 1_000_000 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxOutputBytes' });
  });

  it('checks maxIterations before building the repetitions of a long list', () => {
    const started = Date.now();
    expectDvError(() => render(buildDocx({ body: p('{#items}{.}{/items}') }), { items: new Array<number>(2_000_000).fill(0) }, { limits: { maxIterations: 10 } }), 'DV_E_LIMIT_EXCEEDED', { limit: 'maxIterations' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reads list items as own data properties: a getter on an item is not called', () => {
    const items: unknown[] = [];
    let called = false;
    Object.defineProperty(items, '0', { get: () => ((called = true), 'x'), enumerable: true });
    items.length = 1;
    render(buildDocx({ body: p('{#items}[{.}]{/items}') }), { items }, { missing: 'empty' });
    expect(called).toBe(false);
  });

  it('adds one media part for an image repeated in a loop, and decodes it once', () => {
    const big = new Uint8Array(4 * 1024 * 1024);
    big.set(png(4, 4));
    const url = 'data:image/png;base64,' + btoa(Array.from(big, (b) => String.fromCharCode(b)).join(''));
    const template = buildDocx({ body: p('{#items}') + p('{%img}') + p('{/items}') });
    for (const img of [big, url]) {
      const started = Date.now();
      const out = render(template, { items: Array.from({ length: 300 }, () => ({ img })) });
      expect(Date.now() - started, typeof img).toBeLessThan(5000);
      expect(zipNames(out).filter((n) => n.startsWith('word/media/'))).toHaveLength(1);
    }
  });

  it('isolates many tags of one paragraph in time proportional to their number', () => {
    const body = p(...Array.from({ length: 20_000 }, (_, i) => run(`{a${String(i % 50)}}`)));
    const data = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`a${String(i)}`, 'v']));
    const started = Date.now();
    expect(inspect(buildDocx({ body })).tags).toHaveLength(20_000);
    render(buildDocx({ body }), data);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('keeps every side of an image within 1000 cm, whatever size its header claims', () => {
    // A PNG header that claims 1 × 100 000 000 pixels.
    const tall = png(1, 1);
    new DataView(tall.buffer, tall.byteOffset).setUint32(20, 100_000_000);
    const xml = partXml(render(buildDocx({ body: p('{%img}') }), { img: tall }, { limits: { maxImagePixels: 1e9 } }));
    const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml) ?? [];
    expect(Number(cy)).toBeLessThanOrEqual(1000 * 360000);
    expect(Number(cx)).toBeGreaterThanOrEqual(1);
  });
});
