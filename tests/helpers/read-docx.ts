// Reads back the text of a rendered DOCX, story by story, with the same text model as inspect.
import { openDocx } from '../../packages/docvane/src/docx/package';
import { readParagraphs } from '../../packages/docvane/src/docx/paragraphs';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';

/** The paragraph texts of each story part, keyed by part name. */
export function storyTexts(bytes: Uint8Array): Record<string, string[]> {
  const docx = openDocx(bytes, DEFAULT_LIMITS);
  const out: Record<string, string[]> = {};
  for (const { part, story } of docx.stories) out[part] = readParagraphs(docx.pkg.readXml(part) ?? '', { part, story, limits: DEFAULT_LIMITS }).map((p) => p.text);
  return out;
}

/** The paragraph texts of the main part. */
export function bodyText(bytes: Uint8Array): string[] {
  return storyTexts(bytes)['/word/document.xml'] ?? [];
}

/** The XML of a part. */
export function partXml(bytes: Uint8Array, part = '/word/document.xml'): string {
  return openDocx(bytes, DEFAULT_LIMITS).pkg.readXml(part) ?? '';
}
