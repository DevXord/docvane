// Reads the tags of a template: the paragraphs of every story, the tags in their text, their
// expressions and formatters, and the section tree of each part. `inspect` and `render` both start
// here, so they agree on every tag and every problem.
import { openDocx, type DocxPackage, type StoryPart } from '../docx/package';
import { sourceOffset, walkParagraphs, type ParagraphRecord } from '../docx/paragraphs';
import { DvError, type DvLocation } from '../errors';
import { formattersOf } from '../expr/ast';
import { checkFormatter } from '../expr/formatters';
import { limitError, type Limits } from '../limits';
import type { TagInfo } from '../model';
import { clip } from '../util/clip';
import { parseRawTree, type RawDocument, type RawElement } from '../xml/raw-tree';
import { lexText, type LexProblem } from './lexer';
import { buildTree, type SectionTree, type TreeChild } from './structure';
import { shapeOf, shapeText, walkSlideParagraphs } from '../pptx/paragraphs';
import { parseTag, type ParsedTag } from './tag';
import { analyzeWorkbook, type WorkbookAnalysis } from '../xlsx/analyze';

/** A tag with what it was parsed into and where its text is. */
export interface TagRecord {
  readonly info: TagInfo;
  readonly parsed: ParsedTag;
  readonly paragraph: ParagraphRecord;
  /** Offsets of the tag in the paragraph text, braces included. */
  readonly start: number;
  readonly end: number;
}

/** One story part: its tree, its paragraphs, its tags in document order and its section tree. */
export interface StoryAnalysis extends StoryPart {
  readonly doc: RawDocument;
  readonly paragraphs: readonly ParagraphRecord[];
  readonly tags: readonly TagRecord[];
  readonly tree: readonly TreeChild[];
}

/** A whole template. */
export interface TemplateAnalysis {
  readonly docx: DocxPackage;
  readonly stories: readonly StoryAnalysis[];
  /** The section trees: one per story for documents, one for the whole presentation. */
  readonly trees: readonly (readonly TreeChild[])[];
  /** Presentations: the sections that repeat slides (D-036). */
  readonly slideSections: ReadonlySet<SectionTree>;
  /** Presentations: the shapes that hold only the tag of a slide section; they are left out of the result. */
  readonly droppedShapes: ReadonlySet<RawElement>;
  /** Every tag, in reading order. */
  readonly tags: readonly TagRecord[];
  /** Workbooks: the sheets and their cells, read through xlvane; null for other formats. */
  readonly workbook: WorkbookAnalysis | null;
}

function lexProblem(problem: LexProblem, location: DvLocation, limits: Limits): DvError {
  switch (problem.code) {
    case 'DV_E_TAG_UNCLOSED':
      return new DvError('DV_E_TAG_UNCLOSED', `The tag "${problem.raw}" is not closed.`, {
        location,
        hint: 'End the tag with "}". A tag must start and end in the same paragraph and cannot contain another "{"; braces are reserved for tags.',
        details: { tag: problem.raw },
      });
    case 'DV_E_TAG_UNOPENED':
      return new DvError('DV_E_TAG_UNOPENED', 'The text has a "}" without a "{" before it.', {
        location,
        hint: 'Delete the "}" or add the missing "{"; braces are reserved for tags. A tag must start and end in the same paragraph.',
        details: { tag: problem.raw },
      });
    case 'DV_E_LIMIT_EXCEEDED':
      return limitError('maxTagLength', limits.maxTagLength, `The tag "${clip(problem.raw.slice(0, 40))}" is longer than ${String(limits.maxTagLength)} characters.`, location);
  }
}

/**
 * Reads the template. Throws `DV_E_TEMPLATE_INVALID` with every problem of its tags and sections
 * (up to `limits.maxErrors`), and the package, ZIP, XML and limit errors of the layers below.
 */
export function analyzeTemplate(bytes: Uint8Array, limits: Limits): TemplateAnalysis {
  const docx = openDocx(bytes, limits);
  const problems: DvError[] = [];
  const full = (): boolean => problems.length >= limits.maxErrors;
  const report = (error: DvError): void => {
    if (!full()) problems.push(error);
  };
  let tagCount = 0;
  /** Lexes and parses the tags of paragraphs, in paragraph order. */
  const scan = (paragraphs: readonly ParagraphRecord[]): TagRecord[] => {
    const records: TagRecord[] = [];
    for (const paragraph of paragraphs) {
      if (full()) break;
      const lexed = lexText(paragraph.text, limits.maxTagLength, limits.maxErrors - problems.length);
      const at = (offset: number): DvLocation => ({ ...paragraph.location, character: offset + 1 });
      for (const problem of lexed.problems) report(lexProblem(problem, at(problem.start), limits));
      for (const raw of lexed.tags) {
        if (++tagCount > limits.maxTags) throw limitError('maxTags', limits.maxTags, `The template has more than ${String(limits.maxTags)} tags.`, at(raw.start));
        const parsed = parseTag(raw.inner, limits.maxExpressionDepth);
        if ('code' in parsed) {
          const details = { tag: clip(raw.raw), position: parsed.position + 2 };
          report(
            parsed.code === 'DV_E_LIMIT_EXCEEDED'
              ? limitError('maxExpressionDepth', limits.maxExpressionDepth, `${parsed.message} (in "${clip(raw.raw)}")`, at(raw.start))
              : new DvError(parsed.code, `${parsed.message} (in "${clip(raw.raw)}")`, { location: at(raw.start), hint: parsed.hint, details }),
          );
          continue;
        }
        let formatterOk = true;
        for (const call of [...formattersOf(parsed.expr), ...parsed.formatters]) {
          const problem = checkFormatter(call);
          if (problem === null) continue;
          formatterOk = false;
          report(new DvError(problem.code, `${problem.message} (in "${clip(raw.raw)}")`, { location: at(raw.start), hint: problem.hint, details: { tag: clip(raw.raw), formatter: call.name } }));
        }
        if (!formatterOk) continue;
        const info: TagInfo = { kind: parsed.kind, raw: raw.raw, path: parsed.path, paths: parsed.paths, formatters: parsed.formatters, location: at(raw.start) };
        records.push({ info, parsed, paragraph, start: raw.start, end: raw.end });
      }
    }
    return records;
  };
  const stories: StoryAnalysis[] = [];
  const workbook = docx.format === 'xlsx' ? analyzeWorkbook(bytes, limits, scan, report) : null;

  for (const story of docx.stories) {
    if (full()) break;
    const xml = docx.pkg.readXml(story.part);
    if (xml === undefined) continue;
    const doc = parseRawTree(xml, { part: story.part, limits });
    const paragraphs = docx.format === 'pptx' ? walkSlideParagraphs(doc, { part: story.part, story: story.story, slide: story.slide ?? 0 }) : walkParagraphs(doc, story);
    const tags = scan(paragraphs).map((record) => ({ record, at: sourceOffset(record.paragraph, record.start) }));
    // Paragraphs of text boxes sit inside other paragraphs: order the tags by where they are in the XML.
    tags.sort((a, b) => a.at - b.at);
    const ordered = tags.map((t) => t.record);
    if (docx.format === 'pptx') {
      stories.push({ ...story, doc, paragraphs, tags: ordered, tree: [] });
      continue;
    }
    const tree = buildTree(ordered, limits);
    for (const problem of tree.problems) report(problem);
    stories.push({ ...story, doc, paragraphs, tags: ordered, tree: tree.children });
  }

  let trees: (readonly TreeChild[])[] = workbook === null ? stories.map((s) => s.tree) : workbook.sheets.map((s) => s.tree);
  const slideSections = new Set<SectionTree>();
  const droppedShapes = new Set<RawElement>();
  if (docx.format === 'pptx' && !full()) {
    // One tree over the slides and their notes in order, so that a section can repeat slides.
    const tree = buildTree(
      stories.flatMap((s) => s.tags),
      limits,
    );
    for (const problem of tree.problems) report(problem);
    const local = presentationTrees(tree.children, stories, slideSections, droppedShapes, report);
    for (let i = 0; i < stories.length; i++) stories[i] = { ...(stories[i] as StoryAnalysis), tree: local.get(stories[i] as StoryAnalysis) ?? [] };
    trees = [tree.children];
  }

  if (problems.length > 0) {
    const first = problems[0] as DvError;
    const count = problems.length;
    throw new DvError(
      'DV_E_TEMPLATE_INVALID',
      count === 1 ? `The template has a problem: ${first.message}` : `The template has ${String(count)}${full() ? ' or more' : ''} problems. The first: ${first.message}`,
      {
        location: first.location,
        hint: `Fix the problems listed in "errors"; each one has its place in the document and a hint. The first: ${first.hint}`,
        details: { count, truncated: full() },
        errors: problems,
      },
    );
  }
  const tags = workbook === null ? stories.flatMap((s) => s.tags) : workbook.sheets.flatMap((s) => s.tags);
  return { docx, stories, trees, slideSections, droppedShapes, tags, workbook };
}

/**
 * Splits the tree of a presentation (D-036). A section whose opening and closing tags each fill a
 * shape of their own on a slide repeats the slides from the one of its opening tag to the one of
 * its closing tag; its two shapes are left out of the result, and what is inside it belongs to the
 * slides. Every other section must open and close in one part. Returns the tree of each story,
 * with the slide sections taken out.
 */
function presentationTrees(
  children: readonly TreeChild[],
  stories: readonly StoryAnalysis[],
  slideSections: Set<SectionTree>,
  droppedShapes: Set<RawElement>,
  report: (error: DvError) => void,
): Map<StoryAnalysis, TreeChild[]> {
  const storyOf = new Map<TagRecord, StoryAnalysis>();
  for (const s of stories) for (const t of s.tags) storyOf.set(t, s);
  const local = new Map<StoryAnalysis, TreeChild[]>();
  const list = (s: StoryAnalysis): TreeChild[] => {
    let l = local.get(s);
    if (l === undefined) {
      l = [];
      local.set(s, l);
    }
    return l;
  };
  const aloneInShape = (tag: TagRecord, story: StoryAnalysis): RawElement | undefined => {
    if (story.story !== 'slide') return undefined;
    const shape = shapeOf(tag.paragraph.element);
    return shape !== undefined && shapeText(shape, story.paragraphs).trim() === tag.info.raw ? shape : undefined;
  };
  const walk = (nodes: readonly TreeChild[], insideOther: boolean): void => {
    for (const child of nodes) {
      if ('tag' in child) {
        list(storyOf.get(child.tag) as StoryAnalysis).push(child);
        continue;
      }
      const section = child.section;
      const openStory = storyOf.get(section.open) as StoryAnalysis;
      const closeStory = storyOf.get(section.close) as StoryAnalysis;
      const openShape = aloneInShape(section.open, openStory);
      const closeShape = aloneInShape(section.close, closeStory);
      if (openShape !== undefined && closeShape !== undefined && openShape !== closeShape) {
        if (insideOther) {
          report(
            new DvError('DV_E_SECTION_PLACEMENT', `The section "${section.open.info.raw}" repeats slides, but it is inside a section that does not.`, {
              location: section.open.info.location,
              hint: 'A section that repeats slides can only be inside other sections that repeat slides. Put the outer section in shapes of its own too.',
              details: { tag: section.open.info.raw },
            }),
          );
          continue;
        }
        slideSections.add(section);
        droppedShapes.add(openShape);
        droppedShapes.add(closeShape);
        walk(section.children, false);
        continue;
      }
      if (openStory !== closeStory) {
        report(
          new DvError('DV_E_SECTION_PLACEMENT', `The section "${section.open.info.raw}" opens and closes on different slides, but its tags do not each fill a shape of their own.`, {
            location: section.open.info.location,
            hint: `To repeat slides, put ${section.open.info.raw} alone in a shape on the first slide and {/${section.open.info.path}} alone in another shape on the last slide; otherwise keep the section within one slide or its notes.`,
            details: { tag: section.open.info.raw },
          }),
        );
        continue;
      }
      list(openStory).push(child);
      checkNested(section.children, true);
    }
  };
  // Sections inside a section of one part stay with it; only a slide section among them is wrong.
  const checkNested = (nodes: readonly TreeChild[], insideOther: boolean): void => {
    for (const child of nodes) {
      if ('tag' in child) continue;
      const section = child.section;
      const openStory = storyOf.get(section.open) as StoryAnalysis;
      const openShape = aloneInShape(section.open, openStory);
      const closeShape = aloneInShape(section.close, storyOf.get(section.close) as StoryAnalysis);
      if (insideOther && openShape !== undefined && closeShape !== undefined && openShape !== closeShape) {
        report(
          new DvError('DV_E_SECTION_PLACEMENT', `The section "${section.open.info.raw}" repeats slides, but it is inside a section that does not.`, {
            location: section.open.info.location,
            hint: 'A section that repeats slides can only be inside other sections that repeat slides.',
            details: { tag: section.open.info.raw },
          }),
        );
      }
      checkNested(section.children, insideOther);
    }
  };
  walk(children, false);
  return local;
}

