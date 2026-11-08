// Images that only removed slides used leave the result with them: every image part shall be the
// target of an explicit relationship (ECMA-376 Part 1 §15.2.14, F-025). Images other slides, layouts
// or kept slides still use stay, and so do images the template already left unused.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from 'tplvane';
import { ap, buildPptx, sp } from '../helpers/pptx';
import { png } from '../helpers/images';

const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const rel = (id: string, target: string): string => `<Relationship Id="${id}" Type="${IMAGE}" Target="../media/${target}"/>`;

/** The template with PNG declared in the Media Types stream, so that the media parts are images. */
function withPng(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const types = strFromU8(files['[Content_Types].xml'] as Uint8Array).replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"');
  files['[Content_Types].xml'] = strToU8(types);
  return zipSync(files);
}

const media = (bytes: Uint8Array): string[] => Object.keys(unzipSync(bytes)).filter((n) => n.startsWith('ppt/media/')).sort();

describe('images of removed slides', () => {
  const template = withPng(
    buildPptx(
      [
        { shapes: sp('T', ap('Title')), rels: [rel('rIdA', 'shared.png')] },
        { shapes: sp('S', ap('{#items}')) + sp('N', ap('{name}')), rels: [rel('rIdA', 'only-loop.png'), rel('rIdB', 'shared.png')] },
        { shapes: sp('E', ap('{/items}')) },
      ],
      { 'ppt/media/shared.png': png(2, 2), 'ppt/media/only-loop.png': png(3, 3), 'ppt/media/unused.png': png(4, 4) },
    ),
  );

  it('leave the result when no kept part uses them', () => {
    expect(media(render(template, { items: [] }))).toEqual(['ppt/media/shared.png', 'ppt/media/unused.png']);
  });

  it('stay when the slides are kept or copied', () => {
    expect(media(render(template, { items: [{ name: 'a' }, { name: 'b' }] }))).toEqual(['ppt/media/only-loop.png', 'ppt/media/shared.png', 'ppt/media/unused.png']);
  });
});
