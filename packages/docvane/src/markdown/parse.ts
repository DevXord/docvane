// A small Markdown parser for the basic Markdown of AI models and people (docs/syntax.md,
// "Markdown"): paragraphs, hard line breaks, ATX headings, bullet and numbered lists up to three
// levels, bold, italic, code spans, links and backslash escapes. Raw HTML, images, tables and
// everything else stay text. The parser is linear in the length of the input: blocks are read
// line by line, and inline delimiters are paired from precomputed positions, never by searching
// forward again and again (D-033).

/** A piece of text with its inline formatting. */
export interface Inline {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  /** The target of a link, as written; checked by the renderer. */
  readonly link?: string;
  /** A hard line break before the text. */
  readonly breakBefore?: boolean;
}

export type Block =
  | { readonly kind: 'paragraph'; readonly content: readonly Inline[] }
  | { readonly kind: 'heading'; readonly level: number; readonly content: readonly Inline[] }
  | { readonly kind: 'item'; readonly ordered: boolean; readonly level: number; readonly number: number; readonly content: readonly Inline[] };

const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const MAX_LIST_LEVEL = 2;

/** The heading level and text of an ATX heading line, or null. */
function heading(line: string): { level: number; text: string } | null {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  let level = 0;
  while (line[i + level] === '#') level++;
  if (level < 1 || level > 6) return null;
  const after = line[i + level];
  if (after !== undefined && after !== ' ' && after !== '\t') return null;
  let text = line.slice(i + level).trim();
  // A closing sequence of # is not part of the text.
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t') text = text.slice(0, end).trimEnd();
  return { level, text };
}

/** The level, kind, number and text of a list item line, or null. */
function listItem(line: string): { level: number; ordered: boolean; number: number; text: string } | null {
  let spaces = 0;
  while (line[spaces] === ' ') spaces++;
  const c = line[spaces];
  let at = spaces;
  let ordered = false;
  let number = 1;
  if (c === '-' || c === '*' || c === '+') {
    at++;
  } else {
    let digits = 0;
    while (digits < 9 && line[at + digits] !== undefined && (line[at + digits] as string) >= '0' && (line[at + digits] as string) <= '9') digits++;
    if (digits === 0 || (line[at + digits] !== '.' && line[at + digits] !== ')')) return null;
    number = Number(line.slice(at, at + digits));
    ordered = true;
    at += digits + 1;
  }
  if (line[at] !== ' ' && line[at] !== '\t') return null;
  return { level: Math.min(MAX_LIST_LEVEL, Math.floor(spaces / 2)), ordered, number, text: line.slice(at + 1).trim() };
}

/** The index of the next occurrence of each character, for every position, from the end. */
function nextOf(text: string, char: string): Int32Array {
  const next = new Int32Array(text.length + 1).fill(-1);
  for (let i = text.length - 1; i >= 0; i--) next[i] = text[i] === char ? i : (next[i + 1] as number);
  return next;
}

/** Parses inline Markdown. */
export function parseInline(text: string): Inline[] {
  // 1. Tokens: literal text, delimiter runs, code spans and links.
  type Token = { kind: 'text'; text: string; breakBefore?: boolean } | { kind: 'delim'; char: '*' | '_'; size: 1 | 2; open: boolean; close: boolean } | { kind: 'code'; text: string } | { kind: 'link'; text: string; url: string };
  const tokens: Token[] = [];
  const nextTick = nextOf(text, '`');
  const nextBracket = nextOf(text, ']');
  const nextParen = nextOf(text, ')');
  let buf = '';
  let pendingBreak = false;
  const flush = (): void => {
    if (buf !== '' || pendingBreak) {
      tokens.push(pendingBreak ? { kind: 'text', text: buf, breakBefore: true } : { kind: 'text', text: buf });
      buf = '';
      pendingBreak = false;
    }
  };
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  for (let i = 0; i < text.length; ) {
    const c = text[i] as string;
    if (c === '\\' && i + 1 < text.length && PUNCTUATION.includes(text[i + 1] as string)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      pendingBreak = true;
      i++;
      continue;
    }
    if (c === '`') {
      // A run of backticks opens code that the next run of the same length closes (CommonMark);
      // the search is bounded, so that many unmatched runs stay linear (D-071).
      let run = 1;
      while (text[i + run] === '`') run++;
      if (run === 1) {
        const end = nextTick[i + 1] ?? -1;
        if (end !== -1) {
          flush();
          tokens.push({ kind: 'code', text: text.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      } else {
        const fence = '`'.repeat(run);
        let end = text.indexOf(fence, i + run);
        while (end !== -1 && end - i < SEARCH && text[end + run] === '`') end = text.indexOf(fence, end + run + 1);
        if (end !== -1 && end - i < SEARCH) {
          flush();
          const inner = text.slice(i + run, end);
          tokens.push({ kind: 'code', text: inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '' ? inner.slice(1, -1) : inner });
          i = end + run;
          continue;
        }
      }
      buf += '`'.repeat(run);
      i += run;
      continue;
    }
    // An image, ![alt](address), is text: docvane does not insert pictures from Markdown.
    const isImage = c === '!' && text[i + 1] === '[';
    if (c === '[' || isImage) {
      const start = isImage ? i + 1 : i;
      const close = nextBracket[start + 1] ?? -1;
      const end = close !== -1 && text[close + 1] === '(' ? linkEnd(text, close + 2, nextParen) : -1;
      if (end !== -1) {
        const label = text.slice(start + 1, close);
        const url = text.slice(close + 2, end).trim();
        if (isImage || url === '') {
          buf += text.slice(i, end + 1);
        } else {
          flush();
          tokens.push({ kind: 'link', text: label === '' ? url : label, url });
        }
        i = end + 1;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      let run = 1;
      while (text[i + run] === c) run++;
      const before = text[i - 1];
      const after = text[i + run];
      const size: 1 | 2 = run >= 2 ? 2 : 1;
      // Underscores inside words are text (snake_case), as in CommonMark.
      const intraword = isWord(before) && isWord(after);
      const open = after !== undefined && after !== ' ' && !(c === '_' && intraword);
      const close = before !== undefined && before !== ' ' && !(c === '_' && intraword);
      if (open || close) {
        flush();
        for (let k = 0; k < Math.floor(run / size); k++) tokens.push({ kind: 'delim', char: c, size, open, close });
        if (run % size === 1) tokens.push({ kind: 'delim', char: c, size: 1, open, close });
        i += run;
        continue;
      }
      buf += text.slice(i, i + run);
      i += run;
      continue;
    }
    buf += c;
    i++;
  }
  flush();

  // 2. Pair delimiters with a stack per kind: linear, and unpaired ones become text.
  const role = new Array<'open' | 'close' | null>(tokens.length).fill(null);
  const stacks = new Map<string, number[]>();
  tokens.forEach((t, i) => {
    if (t.kind !== 'delim') return;
    const key = `${t.char}${String(t.size)}`;
    const stack = stacks.get(key) ?? [];
    if (t.close && stack.length > 0) {
      role[stack.pop() as number] = 'open';
      role[i] = 'close';
    } else if (t.open) {
      stack.push(i);
    }
    stacks.set(key, stack);
  });

  // 3. Inlines with the formatting of the open delimiters around them.
  const out: Inline[] = [];
  let bold = 0;
  let italic = 0;
  let breakNext = false;
  const push = (inline: Omit<Inline, 'bold' | 'italic'> & { bold?: boolean; italic?: boolean }): void => {
    const withBreak = breakNext ? { ...inline, breakBefore: true } : inline;
    breakNext = false;
    out.push({ bold: bold > 0, italic: italic > 0, ...withBreak } as Inline);
  };
  tokens.forEach((t, i) => {
    switch (t.kind) {
      case 'text':
        if (t.breakBefore === true) breakNext = true;
        if (t.text !== '') push({ text: t.text, code: false });
        return;
      case 'code':
        push({ text: t.text, code: true });
        return;
      case 'link':
        push({ text: t.text === '' ? t.url : t.text, code: false, link: t.url });
        return;
      case 'delim':
        if (role[i] === null) {
          push({ text: t.char.repeat(t.size), code: false });
          return;
        }
        if (t.size === 2) bold += role[i] === 'open' ? 1 : -1;
        else italic += role[i] === 'open' ? 1 : -1;
    }
  });
  return out;
}

/** Parses Markdown into blocks. Lines are normalised to LF first. */
export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let item: { ordered: boolean; level: number; number: number; lines: string[] } | null = null;
  const joinLines = (parts: readonly string[]): string =>
    parts
      .map((line, i) => {
        if (i === parts.length - 1) return line.trim();
        // Two spaces or a backslash at the end of a line make a hard break.
        if (line.endsWith('  ')) return `${line.trim()}\n`;
        if (line.endsWith('\\')) return `${line.slice(0, -1).trim()}\n`;
        return `${line.trim()} `;
      })
      .join('');
  const end = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', content: parseInline(joinLines(paragraph)) });
    if (item !== null) blocks.push({ kind: 'item', ordered: item.ordered, level: item.level, number: item.number, content: parseInline(joinLines(item.lines)) });
    paragraph = [];
    item = null;
  };
  for (const line of lines) {
    if (line.trim() === '') {
      end();
      continue;
    }
    const h = heading(line);
    if (h !== null) {
      end();
      blocks.push({ kind: 'heading', level: h.level, content: parseInline(h.text) });
      continue;
    }
    const li = listItem(line);
    if (li !== null) {
      end();
      item = { ordered: li.ordered, level: li.level, number: li.number, lines: [li.text] };
      continue;
    }
    if (item !== null) item.lines.push(line);
    else paragraph.push(line);
  }
  end();
  return blocks;
}

/** How far a closing backtick run or parenthesis is looked for (characters). */
const SEARCH = 4096;

/**
 * The index of the ")" that ends a link address starting at `from`: parentheses inside it are
 * balanced (http://x.y/a_(b)), within SEARCH characters; -1 when there is none (D-071).
 */
function linkEnd(text: string, from: number, nextParen: ArrayLike<number>): number {
  const first = nextParen[from] ?? -1;
  if (first === -1) return -1;
  const open = text.indexOf('(', from);
  if (open === -1 || open > first) return first;
  let depth = 0;
  for (let i = from; i < text.length && i - from < SEARCH; i++) {
    const ch = text[i];
    if (ch === '\n') return -1;
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return first;
}
