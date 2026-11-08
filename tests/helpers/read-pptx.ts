// Reads back a rendered presentation: slide and notes texts in the order of the presentation.
import { openDocx } from '../../packages/tplvane/src/docx/package';
import { DEFAULT_LIMITS } from '../../packages/tplvane/src/limits';
import { relationshipsPartName } from '../../packages/tplvane/src/opc/package';
import { walkSlideParagraphs } from '../../packages/tplvane/src/pptx/paragraphs';
import { parseRawTree } from '../../packages/tplvane/src/xml/raw-tree';

/** For each slide: its paragraphs, and those of its notes. */
export function slideTexts(bytes: Uint8Array): { slide: string[]; notes: string[] }[] {
  const docx = openDocx(bytes, DEFAULT_LIMITS);
  const out: { slide: string[]; notes: string[] }[] = [];
  for (const s of docx.stories) {
    const xml = docx.pkg.readXml(s.part) ?? '';
    const texts = walkSlideParagraphs(parseRawTree(xml, { part: s.part, limits: DEFAULT_LIMITS }), { part: s.part, story: s.story, slide: s.slide ?? 0 }).map((p) => p.text);
    if (s.story === 'slide') out.push({ slide: texts, notes: [] });
    else (out[out.length - 1] as { notes: string[] }).notes = texts;
  }
  return out;
}

/** The XML of a part and of its relationships. */
export function pptxPart(bytes: Uint8Array, part: string): { xml: string; rels: string } {
  const { pkg } = openDocx(bytes, DEFAULT_LIMITS);
  return { xml: pkg.readXml(part) ?? '', rels: pkg.readXml(relationshipsPartName(part)) ?? '' };
}
