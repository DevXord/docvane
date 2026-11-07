// The context of a render of a document or presentation, and its stories prepared: tags isolated
// and the places where sections repeat found.
import { maxDrawingId, prepareStory, textWidthOf, type PreparedStory, type RenderContext } from './docx/render';
import { Resources } from './docx/resources';
import { readStyles } from './docx/styles';
import { Numbering } from './docx/numbering';
import type { DvError } from './errors';
import { Formatting } from './expr/formatters';
import type { Limits } from './limits';
import { vocabularyOf } from './opc/conformance';
import { SlideRenderer } from './pptx/render';
import type { StoryAnalysis, TemplateAnalysis } from './template/analyze';

/** What a render of a document or presentation needs besides the analysis. */
export interface ContextOptions {
  readonly locale: string;
  readonly timeZone: string;
  readonly missing: 'error' | 'empty';
  readonly fetched: ReadonlyMap<string, Uint8Array>;
  readonly collect: Set<string> | undefined;
}

/** A new render context for a document or presentation (not a workbook). */
export function createContext(analysis: TemplateAnalysis, limits: Limits, options: ContextOptions): RenderContext {
  const { zip, pkg, main } = analysis.docx;
  const mainStory = analysis.stories.find((s) => s.story === 'body');
  return {
    limits,
    formatting: new Formatting({ locale: options.locale, timeZone: options.timeZone }),
    missing: options.missing,
    problems: [],
    iterations: 0,
    output: 0,
    nextDrawingId: Math.max(0, ...analysis.stories.map((s) => maxDrawingId(s.doc))) + 1,
    resources: new Resources(pkg, zip, limits, analysis.docx.format === 'pptx' ? '/ppt/media/' : '/word/media/', vocabularyOf(pkg.relationships(null).find((r) => r.type.endsWith('/officeDocument'))?.type ?? '')),
    styles: readStyles(pkg, main, limits),
    numbering: new Numbering(pkg, main, limits),
    textWidth: mainStory === undefined ? 16 * 360000 : textWidthOf(mainStory.doc),
    fetched: options.fetched,
    collect: options.collect,
    warnings: [],
    scopePaths: new WeakMap(),
  };
}

/** Prepares every story; returns them with the problems of placement. */
export function prepareStories(analysis: TemplateAnalysis, ctx: RenderContext): { prepared: Map<StoryAnalysis, PreparedStory>; problems: DvError[] } {
  const pptx = analysis.docx.format === 'pptx';
  const prepared = new Map<StoryAnalysis, PreparedStory>();
  for (const story of analysis.stories) prepared.set(story, pptx ? prepareStory(story, ctx, (s, c) => new SlideRenderer(s, c), analysis.droppedShapes) : prepareStory(story, ctx));
  return { prepared, problems: [...prepared.values()].flatMap((p) => p.problems) };
}
