// Reads back the text of a rendered DOCX, story by story, with the same text model as inspect.
import { openDocx } from '../../packages/docvane/src/docx/package';
import { readParagraphs } from '../../packages/docvane/src/docx/paragraphs';
import { DEFAULT_LIMITS } from '../../packages/docvane/src/limits';
import { openZip } from '../../packages/docvane/src/zip/reader';

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

/** The text of a ZIP entry, such as "[Content_Types].xml". */
export function zipText(bytes: Uint8Array, name: string): string {
  const zip = openZip(bytes, DEFAULT_LIMITS);
  return new TextDecoder().decode(zip.read(name));
}

/** The names of the ZIP entries. */
export function zipNames(bytes: Uint8Array): string[] {
  return openZip(bytes, DEFAULT_LIMITS).entries.map((e) => e.name);
}

