// The stories of a presentation: its slides in the order of p:sldIdLst in presentation.xml, each
// followed by its notes slide, found through relationships (F-018: relationship types `slide` from
// the presentation and `notesSlide` from a slide, as LibreOffice 24.2 writes them).
import type { DvWarning } from '../errors';
import type { ReadLimits } from '../limits';
import type { OpcPackage, Relationship } from '../opc/package';
import { parseXmlTree, type XmlElement } from '../xml/tree';
import type { StoryPart } from '../docx/package';
import { PML_NAMESPACES } from './paragraphs';

const STRICT_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const TRANSITIONAL_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const R_NAMESPACES = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'];

/** Whether a relationship has the given name in either conformance class. */
export function isRelationship(rel: Relationship, name: string): boolean {
  return !rel.external && (rel.type === TRANSITIONAL_REL + name || rel.type === STRICT_REL + name);
}

/** The r:id of an element, in either conformance class. */
export function relId(e: XmlElement): string | undefined {
  for (const ns of R_NAMESPACES) {
    const id = e.attrs.get(`{${ns}}id`);
    if (id !== undefined) return id;
  }
  return undefined;
}

/** One slide of the presentation: its part, its relationship and its notes. */
export interface SlideRef {
  readonly part: string;
  /** The r:id of p:sldId in presentation.xml. */
  readonly rId: string;
  readonly id: string;
  readonly notes: string | undefined;
}

/** The slides of a presentation in order. */
export function presentationSlides(pkg: OpcPackage, main: string, limits: ReadLimits): { slides: SlideRef[]; warnings: DvWarning[] } {
  const root = parseXmlTree(pkg.readXml(main) ?? '', { part: main, limits });
  const list = root.children.find((c) => PML_NAMESPACES.has(c.ns) && c.local === 'sldIdLst');
  const rels = pkg.relationships(main);
  const slides: SlideRef[] = [];
  const warnings: DvWarning[] = [];
  for (const entry of list?.children ?? []) {
    if (!PML_NAMESPACES.has(entry.ns) || entry.local !== 'sldId') continue;
    const rId = relId(entry);
    const rel = rels.find((r) => r.id === rId);
    if (rId === undefined || rel === undefined || !isRelationship(rel, 'slide') || !pkg.hasPart(rel.target)) {
      warnings.push({ code: 'DV_W_PART_MISSING', message: 'The presentation lists a slide whose part does not exist; it was skipped.', location: { part: main }, hint: 'Re-save the presentation in PowerPoint or LibreOffice to repair it.' });
      continue;
    }
    const notesRel = pkg.relationships(rel.target).find((r) => isRelationship(r, 'notesSlide'));
    const notes = notesRel !== undefined && pkg.hasPart(notesRel.target) ? notesRel.target : undefined;
    slides.push({ part: rel.target, rId, id: entry.attrs.get('id') ?? '', notes });
  }
  return { slides, warnings };
}

/** The stories of a presentation: each slide, then its notes. */
export function presentationStories(pkg: OpcPackage, main: string, limits: ReadLimits): { stories: StoryPart[]; warnings: DvWarning[] } {
  const { slides, warnings } = presentationSlides(pkg, main, limits);
  const stories: StoryPart[] = [];
  slides.forEach((s, i) => {
    stories.push({ part: s.part, story: 'slide', slide: i + 1 });
    if (s.notes !== undefined) stories.push({ part: s.notes, story: 'notes', slide: i + 1 });
  });
  return { stories, warnings };
}
