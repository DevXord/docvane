// Opens a template package and finds the WordprocessingML parts that hold text: the main
// document, then its headers, footers, footnotes and endnotes, all found through relationships
// (ECMA-376 Part 2 §6.5), never by file names. The format is recognised from the root element of
// the main part, which the officeDocument relationship of the package points to.
import { DvError, type DvStory, type DvWarning } from '../errors';
import type { ReadLimits } from '../limits';
import { openPackage, type OpcPackage, type Relationship } from '../opc/package';
import { partKey } from '../opc/part-name';
import { clip } from '../util/clip';
import { parseXml } from '../xml/parser';
import { openZip, type ZipReader } from '../zip/reader';
import { WML_NAMESPACES } from './paragraphs';
import { presentationStories } from '../pptx/package';
import { PML_NAMESPACES } from '../pptx/paragraphs';

// Relationship type prefixes of both conformance classes, as in src/sml/namespaces.ts of xlvane.
const STRICT_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const TRANSITIONAL_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

/** The relationship name of a type URI of either conformance class, or null. */
function relationshipName(type: string): string | null {
  if (type.startsWith(STRICT_REL)) return type.slice(STRICT_REL.length);
  if (type.startsWith(TRANSITIONAL_REL)) return type.slice(TRANSITIONAL_REL.length);
  return null;
}

/** SpreadsheetML namespaces: Transitional and Strict (ECMA-376 Part 1 and Part 4), as in src/sml/namespaces.ts of xlvane. */
const SML_NAMESPACES: ReadonlySet<string> = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']);

/** The relationships of the main part that lead to stories, in reading order. */
const STORY_RELATIONSHIPS: readonly (readonly [string, DvStory])[] = [
  ['header', 'header'],
  ['footer', 'footer'],
  ['footnotes', 'footnote'],
  ['endnotes', 'endnote'],
];

/** A part that holds text, and the kind of text flow it is. */
export interface StoryPart {
  readonly part: string;
  readonly story: DvStory;
  /** For slides and their notes: the slide, counted from 1 in the order of the presentation. */
  readonly slide?: number;
}

/** An opened template: a WordprocessingML document, a PresentationML presentation or a SpreadsheetML workbook. */
export interface DocxPackage {
  readonly format: 'docx' | 'pptx' | 'xlsx';
  readonly zip: ZipReader;
  readonly pkg: OpcPackage;
  readonly main: string;
  /** Documents: the main part, then headers, footers, footnotes and endnotes. Presentations: each slide, then its notes. Workbooks: none (xlvane reads the sheets). */
  readonly stories: readonly StoryPart[];
  readonly warnings: readonly DvWarning[];
}

class RootFound extends Error {
  constructor(
    readonly ns: string,
    readonly local: string,
  ) {
    super('root');
  }
}

/** The namespace and local name of the root element; parses only up to the first start tag. */
function rootElement(xml: string, part: string, limits: ReadLimits): { ns: string; local: string } {
  try {
    parseXml(
      xml,
      {
        start(ns, local) {
          throw new RootFound(ns, local);
        },
        end() {},
        text() {},
      },
      { part, limits },
    );
  } catch (error) {
    if (error instanceof RootFound) return { ns: error.ns, local: error.local };
    throw error;
  }
  // parseXml rejects a document without a root element, so this is not reached.
  throw new DvError('DV_E_INTERNAL', 'The main part has no root element.', { location: { part }, hint: 'This is an internal error; please report it with the file.' });
}

function find(rels: readonly Relationship[], name: string): Relationship | undefined {
  return rels.find((r) => !r.external && relationshipName(r.type) === name);
}

/**
 * Opens `bytes` as a template package: a document, a presentation or a workbook. Throws
 * `DV_E_NOT_SUPPORTED` for other packages, and the ZIP, XML and package errors of the layers below.
 */
export function openDocx(bytes: Uint8Array, limits: ReadLimits): DocxPackage {
  const zip = openZip(bytes, limits);
  const pkg = openPackage(zip, limits);
  const officeDocument = find(pkg.relationships(null), 'officeDocument');
  if (officeDocument === undefined || !pkg.hasPart(officeDocument.target)) {
    throw new DvError('DV_E_PART_MISSING', 'The package has no main document part.', {
      location: officeDocument === undefined ? { part: '/_rels/.rels' } : { part: officeDocument.target },
      hint: 'This is not a complete Office document: the package does not point to its main part. Check that the file is a .docx, .pptx or .xlsx file and re-save it in the application that made it.',
    });
  }
  const main = officeDocument.target;
  const xml = pkg.readXml(main) ?? '';
  const root = rootElement(xml, main, limits);
  if (PML_NAMESPACES.has(root.ns) && root.local === 'presentation') {
    const { stories, warnings } = presentationStories(pkg, main, limits);
    return { format: 'pptx', zip, pkg, main, stories, warnings };
  }
  if (SML_NAMESPACES.has(root.ns) && root.local === 'workbook') return { format: 'xlsx', zip, pkg, main, stories: [], warnings: [] };
  if (!(WML_NAMESPACES.has(root.ns) && root.local === 'document')) {
    throw new DvError('DV_E_NOT_SUPPORTED', `The file is not a Word document, a PowerPoint presentation or an Excel workbook: its main part is a "${clip(root.local)}" element.`, {
      location: { part: main },
      hint: 'Pass a Word document (.docx), a PowerPoint presentation (.pptx) or an Excel workbook (.xlsx).',
      details: { root: clip(root.local), namespace: clip(root.ns) },
    });
  }

  const warnings: DvWarning[] = [];
  const stories: StoryPart[] = [{ part: main, story: 'body' }];
  // Part names compare without regard to case (ECMA-376 Part 2), so one header named twice in
  // different case is one story (D-071).
  const seen = new Set<string>([partKey(main)]);
  const rels = pkg.relationships(main);
  for (const [name, story] of STORY_RELATIONSHIPS) {
    for (const rel of rels) {
      if (rel.external || relationshipName(rel.type) !== name || seen.has(partKey(rel.target))) continue;
      seen.add(partKey(rel.target));
      if (!pkg.hasPart(rel.target)) {
        warnings.push({
          code: 'DV_W_PART_MISSING',
          message: `The document refers to a ${story} part that does not exist; it was skipped.`,
          location: { part: rel.target },
          hint: 'Re-save the document in Word or LibreOffice to repair it.',
        });
        continue;
      }
      stories.push({ part: rel.target, story });
    }
  }
  return { format: 'docx', zip, pkg, main, stories, warnings };
}
