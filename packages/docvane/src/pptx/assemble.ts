// Puts a rendered presentation together (D-036): slides repeated by slide sections become copies
// with new parts, relationships, notes slides and p:sldId entries; slides that a section shows no
// time are taken out with their notes. The shapes follow LibreOffice 24.2 (F-018).
import { limitError } from '../limits';
import { relationshipsPartName } from '../opc/package';
import type { StoryAnalysis, TemplateAnalysis } from '../template/analyze';
import type { SectionTree, TreeChild } from '../template/structure';
import { parseRawTree, rawXmlText, type RawElement } from '../xml/raw-tree';
import { escapeAttr } from '../xml/writer';
import type { PreparedStory, RenderContext } from '../docx/render';
import { relativeTarget } from '../docx/resources';
import { isPml } from './paragraphs';
import { presentationSlides, type SlideRef } from './package';

const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
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
    let slideRels = pkg.readXml(relationshipsPartName(ref.part)) ?? '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let notesPart: string | undefined;
    if (notes !== undefined) {
      notesPart = ctx.resources.newPartName('/ppt/notesSlides/', 'docvane', 'xml');
      ctx.resources.addOverride(notesPart, pkg.contentType(notes.part) ?? 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
      slideRels = retarget(slideRels, relativeTarget(ref.part, notes.part), relativeTarget(part, notesPart));
      const notesRels = pkg.readXml(relationshipsPartName(notes.part)) ?? '';
      ctx.resources.seedRelationships(notesPart, retarget(notesRels, relativeTarget(notes.part, ref.part), relativeTarget(notesPart, part)), pkg.relationships(notes.part).map((r) => r.id));
    }
    ctx.resources.seedRelationships(part, slideRels, pkg.relationships(ref.part).map((r) => r.id));
    changed.set(part, renderSlide(instance.scopes, true, part));
    if (notes !== undefined && notesPart !== undefined) changed.set(notesPart, (prepared.get(notes) as PreparedStory).render(instance.scopes, true, notesPart));
    const rId = ctx.resources.relationship(main, SLIDE_REL, relativeTarget(main, part), false);
    if (nextId > MAX_SLIDE_ID) throw limitError('maxIterations', ctx.limits.maxIterations, 'The presentation would get more slides than slide ids allow.');
    entries.push(`<${prefix}sldId xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" id="${String(nextId++)}" r:id="${escapeAttr(rId)}"/>`);
  }

  // Slides that are shown no time go, with their notes.
  slides.forEach((ref, i) => {
    if (used.has(i + 1)) return;
    ctx.resources.removeRelationship(main, ref.rId);
    ctx.resources.removePart(ref.part);
    if (ref.notes !== undefined) ctx.resources.removePart(ref.notes);
    changed.delete(ref.part);
  });

  if (list !== undefined && (sections.length > 0 || instances.length !== slides.length)) {
    const xml = rawXmlText(presentation.root);
    const listXml = rawXmlText(list);
    const open = list.open.endsWith('/>') ? `<${list.qname}>` : list.open;
    const close = list.close === '' ? `</${list.qname}>` : list.close;
    changed.set(main, presentation.prolog + xml.replace(listXml, `${open}${entries.join('')}${close}`) + presentation.epilog);
  }
  return changed;
}

/** Replaces the Target of the relationship whose Target is `from`. */
function retarget(rels: string, from: string, to: string): string {
  return rels.replace(new RegExp(`(Target=")${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`), `$1${escapeAttr(to)}$2`);
}

