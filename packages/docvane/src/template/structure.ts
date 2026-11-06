// Builds the section tree of one part from its tags in document order. A section opens with
// `{#name}` or `{^name}` and closes with `{/name}`; sections nest and never cross a part.
import { DvError } from '../errors';
import { limitError, type TemplateLimits } from '../limits';
import type { SectionKind, SectionNode } from '../model';
import type { TagRecord } from './analyze';

/** A section with its content in document order (the public SectionNode splits it by kind). */
export interface SectionTree {
  readonly kind: SectionKind;
  readonly open: TagRecord;
  readonly close: TagRecord;
  readonly children: readonly TreeChild[];
}

/** A value, image or Markdown tag, or a section. */
export type TreeChild = { readonly tag: TagRecord } | { readonly section: SectionTree };

interface Frame {
  readonly open: TagRecord;
  readonly children: TreeChild[];
}

const sectionText = (tag: TagRecord): string => `{${tag.info.kind === 'inverted' ? '^' : '#'}${tag.info.path}}`;

/**
 * Builds the tree of one part. Problems (unclosed, unopened and crossed sections, and `{.}` outside
 * a section) are returned, not thrown; nesting deeper than `maxSectionDepth` throws
 * `DV_E_LIMIT_EXCEEDED`.
 */
export function buildTree(tags: readonly TagRecord[], limits: Pick<TemplateLimits, 'maxSectionDepth'>): { children: TreeChild[]; problems: DvError[] } {
  const root: TreeChild[] = [];
  const stack: Frame[] = [];
  const problems: DvError[] = [];
  const children = (): TreeChild[] => stack[stack.length - 1]?.children ?? root;

  for (const record of tags) {
    const tag = record.info;
    switch (tag.kind) {
      case 'section':
      case 'inverted':
        if (stack.length >= limits.maxSectionDepth) {
          throw limitError('maxSectionDepth', limits.maxSectionDepth, `Sections are nested more than ${String(limits.maxSectionDepth)} levels deep.`, tag.location);
        }
        stack.push({ open: record, children: [] });
        break;
      case 'close': {
        let at = stack.length - 1;
        // {/} closes the innermost section; {/name} the innermost section of that name.
        if (tag.path !== '') while (at >= 0 && (stack[at] as Frame).open.info.path !== tag.path) at--;
        if (at < 0) {
          problems.push(
            new DvError('DV_E_SECTION_UNOPENED', `"${tag.raw}" closes a section that is not open.`, {
              location: tag.location,
              hint: `Add {#${tag.path}} before it, or delete it. A section must open and close in the same part of the document (the body, a header, a footer or the notes).`,
              details: { tag: tag.raw },
            }),
          );
          break;
        }
        if (at !== stack.length - 1) {
          const inner = stack[stack.length - 1] as Frame;
          problems.push(
            new DvError('DV_E_SECTION_MISMATCH', `"{/${tag.path}}" comes before the end of "${sectionText(inner.open)}", which is inside it.`, {
              location: tag.location,
              hint: `Close the inner section first: put {/${inner.open.info.path}} before {/${tag.path}}.`,
              details: { tag: tag.raw, open: inner.open.info.raw },
            }),
          );
        }
        const frame = stack[at] as Frame;
        stack.length = at;
        // Only a section over a plain path can be a loop; one over an expression such as
        // {#total > 100} tests the truth of the result.
        const hasContent = frame.children.length > 0;
        const plain = frame.open.parsed.segments !== null && frame.open.parsed.formatters.length === 0;
        const kind: SectionKind = frame.open.info.kind === 'inverted' ? 'inverted' : hasContent && plain ? 'loop' : 'condition';
        children().push({ section: { kind, open: frame.open, close: record, children: frame.children } });
        break;
      }
      default:
        if (record.parsed.paths.includes('.') && stack.length === 0) {
          problems.push(
            new DvError('DV_E_TAG_SYNTAX', `"${tag.raw}" stands for the current item of a loop, but it is not inside a section.`, {
              location: tag.location,
              hint: 'Use {.} only between {#list} and {/list}, or write the name of the field, for example {name}.',
              details: { tag: tag.raw },
            }),
          );
        }
        children().push({ tag: record });
    }
  }
  for (const frame of stack) {
    problems.push(
      new DvError('DV_E_SECTION_UNCLOSED', `The section "${sectionText(frame.open)}" is not closed.`, {
        location: frame.open.info.location,
        hint: `Add {/${frame.open.info.path}} after the content of the section, in the same part of the document (the body, a header, a footer or the notes).`,
        details: { tag: frame.open.info.raw },
      }),
    );
  }
  return { children: root, problems };
}

/** The public form of a section. */
export function toSectionNode(tree: SectionTree): SectionNode {
  const tags: SectionNode['tags'][number][] = [];
  const sections: SectionNode[] = [];
  for (const child of tree.children) {
    if ('tag' in child) tags.push(child.tag.info);
    else sections.push(toSectionNode(child.section));
  }
  return { kind: tree.kind, path: tree.open.info.path, formatters: tree.open.info.formatters, open: tree.open.info, close: tree.close.info, tags, sections };
}
