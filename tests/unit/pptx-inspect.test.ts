// inspect on presentations: tags in shapes, tables, groups and notes, in the order of the slides.
import { describe, expect, it } from 'vitest';
import { inspect } from 'docvane';
import { ap, ar, buildPptx, ptable, sp } from '../helpers/pptx';
import { expectDvError } from '../helpers/expect-error';

describe('inspect on PPTX', () => {
  it('finds tags split over runs in shapes, tables and notes, in the order of the presentation', () => {
    const bytes = buildPptx([
      { shapes: sp('Title', ap(ar('Offer {cust'), ar('omer.na', 'b="1"'), ar('me}'))) + ptable('Lines', [[ap('{#items}{name}'), ap('{price}{/items}')]]), notes: sp('Notes', ap('Say {greeting}')) },
      { shapes: sp('Body', ap('A') + ap('{x}')) },
    ]);
    const result = inspect(bytes);
    expect(result.format).toBe('pptx');
    expect(result.tags.map((t) => [t.raw, t.location.description])).toEqual([
      ['{customer.name}', 'slide 1, shape "Title", paragraph 1'],
      ['{#items}', 'slide 1, shape "Lines", table 1 row 1 cell 1, paragraph 1'],
      ['{name}', 'slide 1, shape "Lines", table 1 row 1 cell 1, paragraph 1'],
      ['{price}', 'slide 1, shape "Lines", table 1 row 1 cell 2, paragraph 1'],
      ['{/items}', 'slide 1, shape "Lines", table 1 row 1 cell 2, paragraph 1'],
      ['{greeting}', 'slide 1 notes, shape "Notes", paragraph 1'],
      ['{x}', 'slide 2, shape "Body", paragraph 2'],
    ]);
    expect(result.tags[0]?.location).toMatchObject({ part: '/ppt/slides/slide1.xml', story: 'slide', slide: 1 });
    expect(Object.keys(result.schema.properties ?? {})).toEqual(['customer', 'items', 'greeting', 'x']);
  });

  it('reads a section whose tags fill shapes of their own as a loop over slides, across slides and notes', () => {
    const bytes = buildPptx([
      { shapes: sp('Intro', ap('{title}')) },
      { shapes: sp('Start', ap('{#products}')) + sp('Name', ap('{name}')), notes: sp('N', ap('{note}')) },
      { shapes: sp('Price', ap('{price}')) + sp('End', ap('{/products}')) },
    ]);
    const { sections, schema } = inspect(bytes);
    expect(sections.map((s) => [s.kind, s.path, s.tags.map((t) => t.raw)])).toEqual([['loop', 'products', ['{name}', '{note}', '{price}']]]);
    expect(Object.keys(schema.properties?.['products']?.items?.properties ?? {})).toEqual(['name', 'note', 'price']);
  });

  it('refuses a section across slides whose tags share their shapes with other text', () => {
    const bytes = buildPptx([{ shapes: sp('A', ap('Start {#items}')) }, { shapes: sp('B', ap('{/items}')) }]);
    expect(expectDvError(() => inspect(bytes), 'DV_E_TEMPLATE_INVALID').errors.map((e) => e.code)).toEqual(['DV_E_SECTION_PLACEMENT']);
  });

  it('does not let a field or a line break split a tag', () => {
    const bytes = buildPptx([{ shapes: sp('A', ap('{na', '<a:br/>', 'me}') + ap('{a', '<a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld>', 'b}')) }]);
    expect(expectDvError(() => inspect(bytes), 'DV_E_TEMPLATE_INVALID').errors.map((e) => e.code)).toEqual(['DV_E_TAG_SYNTAX', 'DV_E_TAG_SYNTAX']);
  });
});
