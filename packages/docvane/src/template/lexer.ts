// Splits the text of one paragraph into tags. A tag is the text from `{` to the next `}`; it
// never crosses a paragraph, because the caller lexes each paragraph on its own. Braces inside
// strings are not special, so a string argument cannot contain `{` or `}` (docs/syntax.md).
// One pass with indexOf: linear in the length of the text.
import { clip } from '../util/clip';

/** A tag in the text: `raw` is `text.slice(start, end)`, braces included; `inner` is without them. */
export interface RawTag {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly inner: string;
}

/** A brace problem. `raw` is the text concerned, shortened for messages. */
export interface LexProblem {
  readonly code: 'DV_E_TAG_UNCLOSED' | 'DV_E_TAG_UNOPENED' | 'DV_E_LIMIT_EXCEEDED';
  readonly start: number;
  readonly raw: string;
}

/**
 * Finds the tags of `text`. A tag longer than `maxTagLength` (braces included) is reported as a
 * `DV_E_LIMIT_EXCEEDED` problem and not parsed. Stops collecting problems after `maxProblems`.
 */
export function lexText(text: string, maxTagLength: number, maxProblems: number = Number.POSITIVE_INFINITY): { tags: RawTag[]; problems: LexProblem[] } {
  const tags: RawTag[] = [];
  const problems: LexProblem[] = [];
  const problem = (p: LexProblem): void => {
    if (problems.length < maxProblems) problems.push(p);
  };
  // The next "{" and "}" at or after `at`, each searched again only once `at` has passed it, so
  // that every character is scanned a constant number of times.
  let cachedOpen = -2;
  let cachedClose = -2;
  const nextBrace = (brace: '{' | '}', from: number): number => {
    const cached = brace === '{' ? cachedOpen : cachedClose;
    if (cached !== -2 && (cached === -1 || cached >= from)) return cached;
    const found = text.indexOf(brace, from);
    if (brace === '{') cachedOpen = found;
    else cachedClose = found;
    return found;
  };
  let at = 0;
  while (at < text.length) {
    const open = nextBrace('{', at);
    const close = nextBrace('}', at);
    if (close !== -1 && (open === -1 || close < open)) {
      problem({ code: 'DV_E_TAG_UNOPENED', start: close, raw: '}' });
      at = close + 1;
      continue;
    }
    if (open === -1) break;
    const nextOpen = nextBrace('{', open + 1);
    if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
      const end = nextOpen === -1 ? text.length : nextOpen;
      problem({ code: 'DV_E_TAG_UNCLOSED', start: open, raw: clip(text.slice(open, end)) });
      if (nextOpen === -1) break;
      at = nextOpen;
      continue;
    }
    const raw = text.slice(open, close + 1);
    if (raw.length > maxTagLength) problem({ code: 'DV_E_LIMIT_EXCEEDED', start: open, raw: clip(raw) });
    else tags.push({ start: open, end: close + 1, raw, inner: raw.slice(1, -1) });
    at = close + 1;
  }
  return { tags, problems };
}
