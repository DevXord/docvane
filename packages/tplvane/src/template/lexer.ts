// Splits the text of one paragraph into tags. A tag is the text from the start delimiter (`{`) to
// the next end delimiter (`}`); it never crosses a paragraph, because the caller lexes each
// paragraph on its own. Delimiters inside strings are not special, so a string argument cannot
// contain them (docs/syntax.md). The delimiters can be set by an option, and changed in the
// template by a tag such as {=[[ ]]=}, as in docxtemplater (D-056). One pass with indexOf: linear
// in the length of the text.
import { clip } from '../util/clip';

/** The strings that start and end a tag. */
export interface Delimiters {
  readonly start: string;
  readonly end: string;
}

/** `{` and `}`. */
export const DEFAULT_DELIMITERS: Delimiters = { start: '{', end: '}' };

/** A tag in the text: `raw` is `text.slice(start, end)`, delimiters included; `inner` is without them. */
export interface RawTag {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly inner: string;
  /** For a tag that changes the delimiters (`{=[[ ]]=}`), the new ones. */
  readonly changes?: Delimiters;
}

/** A delimiter problem. `raw` is the text concerned, shortened for messages. */
export interface LexProblem {
  readonly code: 'TV_E_TAG_UNCLOSED' | 'TV_E_TAG_UNOPENED' | 'TV_E_LIMIT_EXCEEDED' | 'TV_E_TAG_SYNTAX';
  readonly start: number;
  readonly raw: string;
}

/** Why two strings cannot be delimiters, or null when they can. */
export function delimiterProblem(d: Delimiters): string | null {
  if (d.start === '' || d.end === '') return 'a delimiter is empty';
  if (/\s/.test(d.start + d.end)) return 'a delimiter contains a space or a line break';
  if (d.start.length > 10 || d.end.length > 10) return 'a delimiter is longer than 10 characters';
  if (d.start.includes(d.end) || d.end.includes(d.start)) return 'one delimiter contains the other';
  return null;
}

/** The delimiters a tag such as `=[[ ]]=` sets, a problem, or null when it is not such a tag (D-056). */
function delimiterChange(inner: string): Delimiters | string | null {
  if (inner.length < 3 || !inner.startsWith('=') || !inner.endsWith('=')) return null;
  const parts = inner.slice(1, -1).trim().split(/\s+/);
  if (parts.length !== 2) return 'write the new start and end delimiters separated by a space, for example {=[[ ]]=}';
  const next = { start: parts[0] as string, end: parts[1] as string };
  return delimiterProblem(next) ?? next;
}

/**
 * Finds the tags of `text` between `delimiters`. A tag longer than `maxTagLength` (delimiters
 * included) is reported as a `TV_E_LIMIT_EXCEEDED` problem and not parsed. A tag `=start end=`
 * changes the delimiters for the rest of the text; the delimiters in force at the end are
 * returned, for the next paragraph. Stops collecting problems after `maxProblems`.
 */
export function lexText(text: string, maxTagLength: number, maxProblems: number = Number.POSITIVE_INFINITY, delimiters: Delimiters = DEFAULT_DELIMITERS): { tags: RawTag[]; problems: LexProblem[]; delimiters: Delimiters } {
  const tags: RawTag[] = [];
  const problems: LexProblem[] = [];
  const problem = (p: LexProblem): void => {
    if (problems.length < maxProblems) problems.push(p);
  };
  let { start: openText, end: closeText } = delimiters;
  // The next start and end delimiter at or after `at`, each searched again only once `at` has
  // passed it, so that every character is scanned a constant number of times.
  let cachedOpen = -2;
  let cachedClose = -2;
  const next = (which: 'open' | 'close', from: number): number => {
    const cached = which === 'open' ? cachedOpen : cachedClose;
    if (cached !== -2 && (cached === -1 || cached >= from)) return cached;
    const found = text.indexOf(which === 'open' ? openText : closeText, from);
    if (which === 'open') cachedOpen = found;
    else cachedClose = found;
    return found;
  };
  let at = 0;
  while (at < text.length) {
    const open = next('open', at);
    const close = next('close', at);
    if (close !== -1 && (open === -1 || close < open)) {
      problem({ code: 'TV_E_TAG_UNOPENED', start: close, raw: closeText });
      at = close + closeText.length;
      continue;
    }
    if (open === -1) break;
    const inside = open + openText.length;
    const closeAfter = next('close', inside);
    const nextOpen = next('open', inside);
    if (closeAfter === -1 || (nextOpen !== -1 && nextOpen < closeAfter)) {
      const end = nextOpen === -1 ? text.length : nextOpen;
      problem({ code: 'TV_E_TAG_UNCLOSED', start: open, raw: clip(text.slice(open, end)) });
      if (nextOpen === -1) break;
      at = nextOpen;
      continue;
    }
    const end = closeAfter + closeText.length;
    const raw = text.slice(open, end);
    const inner = text.slice(inside, closeAfter);
    at = end;
    if (raw.length > maxTagLength) {
      problem({ code: 'TV_E_LIMIT_EXCEEDED', start: open, raw: clip(raw) });
      continue;
    }
    const change = delimiterChange(inner);
    if (typeof change === 'string') {
      problem({ code: 'TV_E_TAG_SYNTAX', start: open, raw: clip(raw) });
      continue;
    }
    if (change !== null) {
      tags.push({ start: open, end, raw, inner, changes: change });
      openText = change.start;
      closeText = change.end;
      cachedOpen = -2;
      cachedClose = -2;
      continue;
    }
    tags.push({ start: open, end, raw, inner });
  }
  return { tags, problems, delimiters: { start: openText, end: closeText } };
}
