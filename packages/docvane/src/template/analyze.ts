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
import { parseRawTree, type RawDocument } from '../xml/raw-tree';
import { lexText, type LexProblem } from './lexer';
import { buildTree, type TreeChild } from './structure';
import { parseTag, type ParsedTag } from './tag';

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
  const stories: StoryAnalysis[] = [];

  for (const story of docx.stories) {
    if (full()) break;
    const xml = docx.pkg.readXml(story.part);
    if (xml === undefined) continue;
    const doc = parseRawTree(xml, { part: story.part, limits });
    const paragraphs = walkParagraphs(doc, story);
    const tags: { record: TagRecord; at: number }[] = [];
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
        tags.push({ record: { info, parsed, paragraph, start: raw.start, end: raw.end }, at: sourceOffset(paragraph, raw.start) });
      }
    }
    // Paragraphs of text boxes sit inside other paragraphs: order the tags by where they are in the XML.
    tags.sort((a, b) => a.at - b.at);
    const ordered = tags.map((t) => t.record);
    const tree = buildTree(ordered, limits);
    for (const problem of tree.problems) report(problem);
    stories.push({ ...story, doc, paragraphs, tags: ordered, tree: tree.children });
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
  return { docx, stories };
}
