// Puts a rendered presentation together (D-036): slides repeated by slide sections become copies
// with new parts, relationships, notes slides and p:sldId entries; slides that a section shows no
// time are taken out with their notes. The shapes follow LibreOffice 24.2 (F-018).
import { DvError } from '../errors';
import { limitError } from '../limits';
import type { OpcPackage } from '../opc/package';
import { partKey } from '../opc/part-name';
import type { StoryAnalysis, TemplateAnalysis } from '../template/analyze';
import type { SectionTree, TreeChild } from '../template/structure';
import { parseRawTree, rawXmlText, type RawElement } from '../xml/raw-tree';
import { escapeAttr } from '../xml/writer';
import type { PreparedStory, RenderContext } from '../docx/render';
import { relationshipXml, relativeTarget } from '../docx/resources';
import { isPml } from './paragraphs';
import { presentationSlides, type SlideRef } from './package';

const MAX_SLIDE_ID = 2147483647;

interface SlideSection {
  readonly tree: SectionTree;
  readonly from: number;
  readonly to: number;
  readonly inner: SlideSection[];
}

/** One slide of the result: which slide of the template, with which scopes. */
interface Instance {
  readonly slide: number;
  readonly scopes: readonly unknown[];
}

/**
 * Renders the stories of a presentation and returns the XML of every changed or new part, keyed
 * by part name. Relationships, Overrides and removed parts are recorded in `ctx.resources`.
 */
export function renderPresentation(analysis: TemplateAnalysis, ctx: RenderContext, prepared: ReadonlyMap<StoryAnalysis, PreparedStory>, data: unknown): Map<string, string> {
  const { pkg, main } = analysis.docx;
  const { slides } = presentationSlides(pkg, main, ctx.limits);
  const slideStory = new Map<number, StoryAnalysis>();
  const notesStory = new Map<number, StoryAnalysis>();
  for (const s of analysis.stories) (s.story === 'notes' ? notesStory : slideStory).set(s.slide ?? 0, s);
  const slideOf = (tagStory: StoryAnalysis | undefined): number => tagStory?.slide ?? 0;
  const storyOf = new Map<object, StoryAnalysis>();
  for (const s of analysis.stories) for (const t of s.tags) storyOf.set(t, s);

  const collect = (children: readonly TreeChild[]): SlideSection[] => {
    const out: SlideSection[] = [];
    for (const c of children) {
      if (!('section' in c)) continue;
      if (analysis.slideSections.has(c.section)) {
        out.push({ tree: c.section, from: slideOf(storyOf.get(c.section.open)), to: slideOf(storyOf.get(c.section.close)), inner: collect(c.section.children) });
      }
    }
    return out;
  };
  const sections = collect(analysis.trees[0] ?? []);

  const expand = (from: number, to: number, secs: readonly SlideSection[], scopes: readonly unknown[], out: Instance[]): void => {
    for (let i = from; i <= to; ) {
      const sec = secs.find((s) => s.from === i);
      if (sec === undefined) {
        out.push({ slide: i, scopes });
        i++;
        continue;
      }
      const story = storyOf.get(sec.tree.open) as StoryAnalysis;
      const renderer = (prepared.get(story) as PreparedStory).renderer;
      for (const itemScopes of renderer.sectionScopes(sec.tree, scopes)) {
        if (++ctx.iterations > ctx.limits.maxIterations) {
          throw limitError('maxIterations', ctx.limits.maxIterations, `Sections repeat their content more than ${String(ctx.limits.maxIterations)} times in all.`, sec.tree.open.info.location);
        }
        expand(sec.from, sec.to, sec.inner, itemScopes, out);
      }
      i = sec.to + 1;
    }
  };
  const instances: Instance[] = [];
  expand(1, slides.length, sections, [data], instances);

  const changed = new Map<string, string>();
  const used = new Map<number, number>();
  const entries: string[] = [];
  const presentation = parseRawTree(pkg.readXml(main) ?? '', { part: main, limits: ctx.limits });
  const list = presentation.root.children.find((c): c is RawElement => c.kind === 'element' && isPml(c, 'sldIdLst'));
  const originals = new Map<string, string>();
  for (const c of list?.children ?? []) if (c.kind === 'element' && isPml(c, 'sldId')) originals.set(c.attrs.get('id') ?? '', rawXmlText(c));
  let nextId = Math.max(255, ...slides.map((s) => Number(s.id)).filter(Number.isSafeInteger)) + 1;
  const prefix = list === undefined ? 'p:' : list.qname.slice(0, list.qname.indexOf(':') + 1);

  for (const instance of instances) {
    const ref = slides[instance.slide - 1] as SlideRef;
    const story = slideStory.get(instance.slide) as StoryAnalysis;
    const notes = notesStory.get(instance.slide);
    const k = used.get(instance.slide) ?? 0;
    used.set(instance.slide, k + 1);
    const renderSlide = (prepared.get(story) as PreparedStory).render;
    if (k === 0) {
      // A slide shown once keeps its part; it is rewritten only when it has tags.
      if (story.tags.length > 0 || analysis.droppedShapes.size > 0) changed.set(ref.part, renderSlide(instance.scopes));
      if (notes !== undefined && notes.tags.length > 0) changed.set(notes.part, (prepared.get(notes) as PreparedStory).render(instance.scopes));
      entries.push(originals.get(ref.id) ?? '');
      continue;
    }
    // A copy: new slide part, its relationships copied from the original, new notes, new p:sldId.
    // The relationships are seeded before rendering, which may add images and links to them.
    const part = ctx.resources.newPartName('/ppt/slides/', 'docvane', 'xml');
    ctx.resources.addOverride(part, pkg.contentType(ref.part) ?? 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    // Parts that belong to one slide (a chart, comments, embedded objects) would be shared by the
    // copies, which ECMA-376 does not allow (Part 1 §13.3, §14.2.1; D-071).
    const owned = pkg.relationships(ref.part).find((r) => !r.external && SLIDE_OWNED.test(r.type));
    if (owned !== undefined) {
      throw new DvError('DV_E_NOT_SUPPORTED', `Slide ${String(instance.slide)} cannot be repeated: it has a part of its own (${owned.type.slice(owned.type.lastIndexOf('/') + 1)}) that a copy would share.`, {
        location: { part: ref.part, slide: instance.slide },
        hint: 'Repeat slides without charts, SmartArt, comments or embedded objects; put those on slides that are shown once.',
        details: { relationship: owned.type },
      });
    }
    const moved = new Map<string, string>();
    let notesPart: string | undefined;
    if (notes !== undefined) {
      notesPart = ctx.resources.newPartName('/ppt/notesSlides/', 'docvane', 'xml');
      ctx.resources.addOverride(notesPart, pkg.contentType(notes.part) ?? 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
      moved.set(partKey(notes.part), notesPart);
      const notesRels = copiedRelationships(pkg, notes.part, notesPart, new Map([[partKey(ref.part), part]]));
      ctx.resources.seedRelationships(notesPart, notesRels, pkg.relationships(notes.part).map((r) => r.id));
    }
    const slideRels = copiedRelationships(pkg, ref.part, part, moved);
    ctx.resources.seedRelationships(part, slideRels, pkg.relationships(ref.part).map((r) => r.id));
    // The relationships of every copy are written too: they count against maxOutputBytes (D-062).
    ctx.output += slideRels.join('').length + (notes === undefined ? 0 : copiedRelationships(pkg, notes.part, part, new Map()).join('').length);
    if (ctx.output > ctx.limits.maxOutputBytes) throw limitError('maxOutputBytes', ctx.limits.maxOutputBytes, `The result would be larger than ${String(ctx.limits.maxOutputBytes)} characters of XML.`, { part: ref.part });
    changed.set(part, renderSlide(instance.scopes, true, part));
    if (notes !== undefined && notesPart !== undefined) changed.set(notesPart, (prepared.get(notes) as PreparedStory).render(instance.scopes, true, notesPart));
    const rId = ctx.resources.relationship(main, ctx.resources.vocabulary.slideRel, relativeTarget(main, part), false);
    if (nextId > MAX_SLIDE_ID) throw limitError('maxIterations', ctx.limits.maxIterations, 'The presentation would get more slides than slide ids allow.');
    entries.push(`<${prefix}sldId xmlns:r="${ctx.resources.vocabulary.r}" id="${String(nextId++)}" r:id="${escapeAttr(rId)}"/>`);
  }

  // Slides that are shown no time go, with their notes.
  slides.forEach((ref, i) => {
    if (used.has(i + 1)) return;
    ctx.resources.removeRelationship(main, ref.rId);
    ctx.resources.removePart(ref.part);
    if (ref.notes !== undefined) ctx.resources.removePart(ref.notes);
    changed.delete(ref.part);
  });
  removeUnreferencedParts(pkg, ctx, slides.filter((_, i) => !used.has(i + 1)));

  if (list !== undefined && (sections.length > 0 || instances.length !== slides.length)) {
    const xml = rawXmlText(presentation.root);
    const listXml = rawXmlText(list);
    const open = list.open.endsWith('/>') ? `<${list.qname}>` : list.open;
    const close = list.close === '' ? `</${list.qname}>` : list.close;
    // A function as the replacement: "$&" or "$'" in the template's XML are text, not patterns (D-071).
    const newList = `${open}${entries.join('')}${close}`;
    changed.set(main, presentation.prolog + xml.replace(listXml, () => newList) + presentation.epilog);
  }
  return changed;
}

/**
 * Leaves out the parts that only removed slides and notes used: their images, comments, charts and
 * the workbooks embedded in those charts. Every image part shall be the target of a relationship
 * (ECMA-376 Part 1 §15.2.14, F-025), and the text of a removed slide's comments or chart must not
 * stay in the file (D-071). A part another kept part refers to (a layout, a shared image) stays,
 * and so do parts the template already left unused.
 */
function removeUnreferencedParts(pkg: OpcPackage, ctx: RenderContext, removedSlides: readonly SlideRef[]): void {
  if (removedSlides.length === 0) return;
  const removed = ctx.resources.removed;
  const referencedByKept = new Set<string>();
  const keptSources = (): void => {
    referencedByKept.clear();
    for (const part of pkg.partNames) {
      if (removed.has(partKey(part))) continue;
      for (const rel of pkg.relationships(part)) if (!rel.external) referencedByKept.add(partKey(rel.target));
    }
    for (const rel of pkg.relationships(null)) if (!rel.external) referencedByKept.add(partKey(rel.target));
  };
  let sources: string[] = removedSlides.flatMap((ref) => (ref.notes === undefined ? [ref.part] : [ref.part, ref.notes]));
  for (let round = 0; round < 8 && sources.length > 0; round++) {
    keptSources();
    const next: string[] = [];
    for (const source of sources) {
      for (const rel of pkg.relationships(source)) {
        const key = partKey(rel.target);
        if (rel.external || removed.has(key) || referencedByKept.has(key) || !pkg.hasPart(rel.target)) continue;
        ctx.resources.removePart(rel.target);
        next.push(rel.target);
      }
    }
    sources = next;
  }
}

/** Relationship types of parts that belong to one slide. */
const SLIDE_OWNED = /\/(?:chart|chartUserShapes|comments|oleObject|package|diagramData|diagramLayout|diagramQuickStyle|diagramColors|diagramDrawing|control|activeXControl|ctrlProp)$/;

/**
 * The relationships of `source` for its copy `copy`, written from the parsed relationships rather
 * than edited as text (a target may be written relative or absolute, D-071): internal targets
 * relative to the copy, and targets in `moved` replaced by their new parts.
 */
function copiedRelationships(pkg: OpcPackage, source: string, copy: string, moved: ReadonlyMap<string, string>): string[] {
  return pkg.relationships(source).map((r) => relationshipXml(r.id, r.type, r.external ? r.target : relativeTarget(copy, moved.get(partKey(r.target)) ?? r.target), r.external));
}

