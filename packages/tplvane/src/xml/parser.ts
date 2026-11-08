// Copied from DevXord/xlvane packages/xlvane/src/xml/parser.ts at aeaefbc (unchanged since ada547b),
// adapted for tplvane (D-009): TvError and TV_E_* codes, messages that name no application,
// `isXmlChar` moved to ./chars, the streaming parsers left out. Identifiers such as D-101, X-01,
// N-01 or E-55 below refer to the notes of xlvane.
//
// A small, non-validating XML 1.0 parser for Office Open XML parts.
//
// Security properties (xlvane D-101):
// - Document type declarations are always rejected, so there are no external entities (XXE)
//   and no entity expansion ("billion laughs"). Only the five predefined entities and
//   character references are recognised (XML 1.0 §4.1, §4.6).
// - The parser is iterative: element nesting uses an explicit stack, never recursion.
// - Depth, attribute count, name length and text length are limited.
// - Attributes are delivered in a Map, so names from the file never become object keys.
//
// Conformance notes (xlvane X-01 … X-16, N-01 … N-09): line ends are normalised before parsing (§2.11),
// attribute values are normalised as for undeclared (CDATA) attributes (§3.3.3), every
// character must match the Char production (§2.2), names follow the Name production (§2.3)
// and namespaces follow Namespaces in XML 1.0.
import { TvError, type TvDetails } from '../errors';
import type { ReadLimits } from '../limits';
import { clip } from '../util/clip';
import { isXmlChar } from './chars';

/** The limits the XML parser enforces. */
export type XmlLimits = Pick<ReadLimits, 'maxXmlDepth' | 'maxXmlAttributes' | 'maxXmlNameLength' | 'maxXmlTextLength'>;

/** Receives parse events in document order. */
export interface XmlHandler {
  /**
   * A start tag. `attrs` maps attribute names to values: unprefixed attributes by their local
   * name, namespaced ones in Clark notation (`{namespace}local`). Namespace declarations are
   * not included.
   */
  start(ns: string, local: string, attrs: ReadonlyMap<string, string>, span: XmlSpan): void;
  /** An end tag (also reported for empty-element tags). */
  end(ns: string, local: string, span: XmlSpan): void;
  /** Character data between two tags, with references expanded and CDATA sections included. */
  text(value: string): void;
}

/**
 * Where a tag is in the parsed text, as UTF-16 offsets into the text after end-of-line
 * normalisation ({@link normalizeLineEnds}). For an empty-element tag the end event has
 * `start === end` at the end of the tag. Used by surgical editing (xlvane D-309) and by tplvane to map text back to the XML.
 */
export interface XmlSpan {
  /** Offset of `<`. */
  readonly start: number;
  /** Offset just after `>`. */
  readonly end: number;
  /** The qualified name as written, for example `x:row`. */
  readonly qname: string;
  /** `true` for an empty-element tag such as `<c r="A1"/>`. */
  readonly empty: boolean;
}

/** XML 1.0 §2.11: CR LF and lone CR become LF. The parser applies this before parsing. */
export function normalizeLineEnds(xml: string): string {
  return xml.indexOf('\r') === -1 ? xml : xml.replace(/\r\n?/g, '\n');
}

/** Options for {@link parseXml}. */
export interface XmlParseOptions {
  /** Part name used in error locations. */
  readonly part: string;
  readonly limits: XmlLimits;
}

/** Namespace bound to the `xml` prefix by definition (Namespaces in XML 1.0, §3). */
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

// Character codes used by the scanner.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const QUOTE = 0x22;
const HASH = 0x23;
const AMP = 0x26;
const APOS = 0x27;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const COLON = 0x3a;
const SEMICOLON = 0x3b;
const LT = 0x3c;
const EQ = 0x3d;
const GT = 0x3e;
const QUESTION = 0x3f;
const UNDERSCORE = 0x5f;

function isWhitespace(c: number): boolean {
  return c === SPACE || c === LF || c === TAB || c === CR;
}

function isNameStartChar(c: number): boolean {
  if (c < 0x80) {
    return (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === UNDERSCORE || c === COLON;
  }
  return (
    (c >= 0xc0 && c <= 0xd6) ||
    (c >= 0xd8 && c <= 0xf6) ||
    (c >= 0xf8 && c <= 0x2ff) ||
    (c >= 0x370 && c <= 0x37d) ||
    (c >= 0x37f && c <= 0x1fff) ||
    (c >= 0x200c && c <= 0x200d) ||
    (c >= 0x2070 && c <= 0x218f) ||
    (c >= 0x2c00 && c <= 0x2fef) ||
    (c >= 0x3001 && c <= 0xd7ff) ||
    (c >= 0xf900 && c <= 0xfdcf) ||
    (c >= 0xfdf0 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0xeffff)
  );
}

function isNameChar(c: number): boolean {
  if (c < 0x80) {
    return (
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x30 && c <= 0x39) ||
      c === UNDERSCORE ||
      c === COLON ||
      c === MINUS ||
      c === DOT
    );
  }
  return isNameStartChar(c) || c === 0xb7 || (c >= 0x300 && c <= 0x36f) || (c >= 0x203f && c <= 0x2040);
}

const PREDEFINED_ENTITIES = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
]);

interface OpenElement {
  readonly qname: string;
  readonly ns: string;
  readonly local: string;
  /** Previous bindings to restore when the element closes, or null if it declared none. */
  readonly undo: [prefix: string, previous: string | undefined][] | null;
}

/**
 * Parses an XML document held in a string and reports events to `handler`.
 * Throws {@link TvError} with `TV_E_XML_MALFORMED`, `TV_E_XML_DTD_FORBIDDEN`,
 * `TV_E_XML_ENTITY_FORBIDDEN` or `TV_E_LIMIT_EXCEEDED`.
 */
export function parseXml(xml: string, handler: XmlHandler, options: XmlParseOptions): void {
  const parser = new Parser(handler, options, true);
  parser.write(xml);
  parser.end();
}

const COMMENT_TOO_LONG = 'Comment is longer than the limit.';
const PI_TOO_LONG = 'Processing instruction is longer than the limit.';

/** Consumed input is dropped once at least this many characters can go (amortises copying). */
const COMPACT_THRESHOLD = 1 << 16;

class Parser {
  /** Unconsumed input after end-of-line normalisation; `base` is the offset of s[0] in the whole text. */
  private s = '';
  private base = 0;
  private pos = 0;
  private readonly stack: OpenElement[] = [];
  /** Current prefix bindings; '' is the default namespace. */
  private readonly bindings = new Map<string, string>([['xml', XML_NAMESPACE]]);
  private textBuffer = '';
  private rootSeen = false;
  private ended = false;
  private declarationChecked = false;
  /** A CR at the end of a piece: it may be the first half of CR LF. */
  private pendingCR = false;
  /** A high surrogate at the end of a piece: its low half may follow. */
  private pendingHigh = '';
  /** Newlines in dropped input and the offset where the current line starts (for locations). */
  private droppedLines = 0;
  private lineStartAbs = 0;
  /** Character data run that was processed in parts: its start offset and that offset's location. */
  private segmentStart = -1;
  private segmentLocation: { part: string; line: number; column: number } | null = null;
  /** Resumable search for the end of the token at `tokenAt`. */
  private tokenAt = -1;
  private tokenFrom = 0;
  private tokenQuote = 0;
  /** Offset of the quote that opened the attribute value being searched. */
  private tokenQuoteAt = 0;
  /**
   * Pieces held back while the unconsumed input is long (a long token or text run), joined to `s`
   * once they are at least as long as it. Appending every piece to `s` and searching it again
   * made a long token cost time quadratic in its length; joining at doubling sizes keeps the
   * total work linear (D-H01).
   */
  private held: string[] = [];
  private heldLength = 0;

  constructor(
    private readonly handler: XmlHandler,
    private readonly options: XmlParseOptions,
    /** `true` when the whole document arrives in one `write` (parseXml). */
    private readonly whole: boolean,
  ) {}

  get buffered(): number {
    return this.s.length - this.pos + this.heldLength + this.textBuffer.length;
  }

  write(chunk: string): void {
    if (this.ended) throw new Error('XML stream parser: write() after end().');
    let text = this.pendingCR ? `\r${chunk}` : chunk;
    this.pendingCR = false;
    if (!this.whole && text.endsWith('\r')) {
      this.pendingCR = true;
      text = text.slice(0, -1);
    }
    // §2.11: translate CR LF and lone CR to LF before parsing.
    text = this.pendingHigh + normalizeLineEnds(text);
    this.pendingHigh = '';
    if (!this.whole && text.length > 0) {
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        this.pendingHigh = text.slice(-1);
        text = text.slice(0, -1);
      }
    }
    if (text.length === 0) return;
    if (this.whole) {
      this.append(text);
      return;
    }
    // A piece that arrives while a long token is unfinished is held until the held pieces are
    // as long as the unconsumed input, so the input is joined and searched at doubling sizes.
    // Short tokens (the usual case) are joined with every piece, as before.
    this.held.push(text);
    this.heldLength += text.length;
    if (this.heldLength < this.s.length - this.pos) return;
    this.appendHeld();
    this.pump(false);
    this.compact();
  }

  private append(text: string): void {
    const from = this.s.length;
    this.s += text;
    this.checkCharacters(from);
  }

  private appendHeld(): void {
    if (this.held.length === 0) return;
    const text = this.held.length === 1 ? (this.held[0] ?? '') : this.held.join('');
    this.held = [];
    this.heldLength = 0;
    this.append(text);
  }

  end(): void {
    if (this.ended) return;
    // A held high surrogate always precedes a held CR (the CR is held last).
    const tail = this.pendingHigh + (this.pendingCR ? '\n' : '');
    this.pendingCR = false;
    this.pendingHigh = '';
    this.appendHeld();
    if (tail.length > 0) this.append(tail);
    this.ended = true;
    this.pump(true);
  }

  /** Drops consumed input, keeping line counts for error locations. */
  private compact(): void {
    const drop = this.pos;
    if (drop < COMPACT_THRESHOLD && drop * 2 < this.s.length) return;
    if (drop === 0) return;
    const s = this.s;
    let last = -1;
    for (let i = s.indexOf('\n'); i !== -1 && i < drop; i = s.indexOf('\n', i + 1)) {
      this.droppedLines++;
      last = i;
    }
    if (last !== -1) this.lineStartAbs = this.base + last + 1;
    this.s = s.slice(drop);
    this.base += drop;
    this.pos = 0;
    if (this.tokenAt !== -1) {
      this.tokenAt -= drop;
      this.tokenFrom -= drop;
      this.tokenQuoteAt -= drop;
    }
  }

  /**
   * Parses as much as the buffer allows. With `final` false, a token that may continue in the
   * next piece is left for later; with `final` true, the rest of the document is parsed and the
   * end-of-document checks run, exactly as in whole-text parsing.
   */
  private pump(final: boolean): void {
    const s = this.s;
    if (!this.declarationChecked) {
      if (s.length - this.pos < 6 && !final) return;
      if (s.startsWith('<?xml', this.pos) && (s.length === 5 || isWhitespace(s.charCodeAt(5)) || s.charCodeAt(5) === QUESTION)) {
        if (!final && s.indexOf('?>', this.pos + 2) === -1) {
          if (s.length - this.pos - 2 > this.options.limits.maxXmlTextLength + 1) this.limit('maxXmlTextLength', PI_TOO_LONG, this.pos);
          return;
        }
        this.declarationChecked = true;
        this.skipProcessingInstruction(true);
      }
      this.declarationChecked = true;
    }
    while (this.pos < s.length) {
      const lt = s.indexOf('<', this.pos);
      if (this.stack.length === 0) {
        const end = lt === -1 ? s.length : lt;
        for (let i = this.pos; i < end; i++) {
          if (!isWhitespace(s.charCodeAt(i))) {
            this.fail(this.rootSeen ? 'Text after the root element.' : 'Text before the root element.', i);
          }
        }
        this.pos = end;
        if (lt === -1) break;
        if (!final && !this.tokenComplete(lt)) return;
        this.markupOutsideRoot();
        continue;
      }
      if (lt === -1) {
        if (final) this.fail(`Element <${this.stack[this.stack.length - 1]?.qname ?? ''}> is not closed.`, s.length);
        this.partialCharacterData();
        return;
      }
      if (lt > this.pos) this.characterData(this.pos, lt);
      this.pos = lt;
      if (!final && !this.tokenComplete(lt)) return;
      this.markupInContent();
    }
    if (!final) return;
    if (this.stack.length > 0) {
      this.fail(`Element <${this.stack[this.stack.length - 1]?.qname ?? ''}> is not closed.`, s.length);
    }
    if (!this.rootSeen) this.fail('The document has no root element.', s.length);
  }

  /**
   * Whether the markup starting at `at` ends inside the buffer, so that parsing it cannot run
   * past the end of the input received so far. The search resumes where it stopped.
   */
  private tokenComplete(at: number): boolean {
    const s = this.s;
    const length = s.length;
    if (this.tokenAt !== at) {
      this.tokenAt = at;
      this.tokenFrom = at + 1;
      this.tokenQuote = 0;
    }
    if (length - at < 2) return false;
    const next = s.charCodeAt(at + 1);
    let done: boolean;
    if (next === 0x21 /* ! */) {
      if (length - at >= 4 && s.startsWith('<!--', at)) {
        const dashes = s.indexOf('--', Math.max(at + 4, this.tokenFrom));
        done = dashes !== -1 && dashes + 2 < length;
        if (!done) {
          // A "--" at the very end waits for the next character; the search resumes at it, not
          // after it (resuming at length - 1 skipped its first "-", found by fuzzing).
          this.tokenFrom = dashes !== -1 ? dashes : Math.max(at + 4, length - 1);
          // Already longer than the limit whatever follows: fail now, as skipComment would.
          if (length - (at + 4) > this.options.limits.maxXmlTextLength + 2) this.limit('maxXmlTextLength', COMMENT_TOO_LONG, at);
        }
      } else if (length - at < 9) {
        done = false;
      } else if (s.startsWith('<![CDATA[', at)) {
        done = s.indexOf(']]>', Math.max(at + 9, this.tokenFrom)) !== -1;
        if (!done) {
          this.tokenFrom = Math.max(at + 9, length - 2);
          // Its text is already longer than the limit whatever follows: fail now, as cdata()
          // would, instead of holding it (D-H01).
          if (this.textBuffer.length + length - (at + 9) > this.options.limits.maxXmlTextLength + 2) this.limit('maxXmlTextLength', 'Text node is longer than the limit.', at);
        }
      } else {
        done = true; // DOCTYPE or another declaration: an error that needs no more input
      }
    } else if (next === QUESTION) {
      done = s.indexOf('?>', Math.max(at + 2, this.tokenFrom)) !== -1;
      if (!done) {
        this.tokenFrom = Math.max(at + 2, length - 1);
        if (length - (at + 2) > this.options.limits.maxXmlTextLength + 1) this.limit('maxXmlTextLength', PI_TOO_LONG, at);
      }
    } else if (next === SLASH) {
      done = s.indexOf('>', Math.max(at + 2, this.tokenFrom)) !== -1;
      if (!done) this.tokenFrom = length;
    } else {
      // A start tag ends at the first ">" outside a quoted attribute value.
      let i = Math.max(at + 1, this.tokenFrom);
      let quote = this.tokenQuote;
      done = false;
      for (; i < length; i++) {
        const c = s.charCodeAt(i);
        if (quote !== 0) {
          if (c === quote) quote = 0;
        } else if (c === QUOTE || c === APOS) {
          quote = c;
          this.tokenQuoteAt = i;
        } else if (c === GT) {
          done = true;
          break;
        }
      }
      this.tokenFrom = i;
      this.tokenQuote = quote;
      // An unfinished attribute value already longer than the limit: fail now with the error of
      // whole-text parsing instead of holding it (D-H01).
      if (!done && quote !== 0 && i - (this.tokenQuoteAt + 1) > this.options.limits.maxXmlTextLength) {
        this.limit('maxXmlTextLength', `Value of attribute "${this.attributeNameBefore(this.tokenQuoteAt)}" is longer than the limit.`, this.tokenQuoteAt + 1);
      }
    }
    if (done) this.tokenAt = -1;
    return done;
  }

  /**
   * Character data with no "<" after it yet. A run longer than the text limit is processed in
   * parts, up to what cannot change when more input arrives (everything before an unfinished
   * reference or a trailing "]" that may start "]]>"), so memory stays bounded.
   */
  private partialCharacterData(): void {
    const s = this.s;
    // Runs up to the text limit are kept whole until the next "<", so that their errors are
    // found in the same order as in whole-text parsing; only longer runs are processed in parts.
    if (s.length - this.pos <= this.options.limits.maxXmlTextLength) return;
    let cut = s.length;
    // Every "&" before the last ";" finds the same ";" as in whole-text parsing; the first "&"
    // after it must wait for its ";".
    const amp = s.indexOf('&', Math.max(this.pos, s.lastIndexOf(';') + 1));
    if (amp !== -1) {
      cut = amp;
      // No reference is this long, so whatever follows, it is an error; fail now instead of
      // holding the rest of the run (D-H01).
      if (s.length - amp > this.options.limits.maxXmlNameLength + 12) {
        if (s.charCodeAt(amp + 1) !== HASH) this.limit('maxXmlNameLength', 'Entity name is longer than the limit.', amp);
        this.fail('"&" must start an entity or character reference ending with ";".', amp);
      }
    }
    while (cut > this.pos && s.charCodeAt(cut - 1) === 0x5d /* ] */ && cut > s.length - 2) cut--;
    if (cut <= this.pos) return;
    if (this.segmentStart === -1) {
      this.segmentStart = this.base + this.pos;
      this.segmentLocation = this.location(this.pos);
    }
    this.characterData(this.pos, cut);
    this.pos = cut;
  }

  /** Every character from `from` on must match the Char production (XML 1.0 §2.2). */
  private checkCharacters(from: number): void {
    const s = this.s;
    for (let i = from; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x20 && c < 0xd800) continue;
      if (c === LF || c === TAB || c === CR) continue;
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
          continue;
        }
      } else if (c >= 0xe000 && c <= 0xfffd) {
        continue;
      }
      this.fail(`Character U+${c.toString(16).toUpperCase().padStart(4, '0')} is not allowed in XML.`, i);
    }
  }

  private markupOutsideRoot(): void {
    const s = this.s;
    if (s.startsWith('<!--', this.pos)) return this.skipComment();
    if (s.startsWith('<?', this.pos)) return this.skipProcessingInstruction(false);
    if (s.startsWith('<!DOCTYPE', this.pos)) return this.failDoctype();
    if (s.startsWith('<!', this.pos)) this.fail('Unexpected markup declaration outside the root element.', this.pos);
    if (s.charCodeAt(this.pos + 1) === SLASH) this.fail('End tag without a matching start tag.', this.pos);
    if (this.rootSeen) this.fail('A second root element is not allowed.', this.pos);
    this.rootSeen = true;
    this.startTag();
  }

  private markupInContent(): void {
    this.segmentStart = -1;
    this.segmentLocation = null;
    const s = this.s;
    const next = s.charCodeAt(this.pos + 1);
    if (next === SLASH) return this.endTag();
    if (next === 0x21 /* ! */) {
      if (s.startsWith('<!--', this.pos)) return this.skipComment();
      if (s.startsWith('<![CDATA[', this.pos)) return this.cdata();
      if (s.startsWith('<!DOCTYPE', this.pos)) return this.failDoctype();
      this.fail('Unexpected markup declaration in element content.', this.pos);
    }
    if (next === QUESTION) return this.skipProcessingInstruction(false);
    this.startTag();
  }

  // ----- character data -------------------------------------------------------------------

  private characterData(from: number, to: number): void {
    const raw = this.s.slice(from, to);
    const close = raw.indexOf(']]>');
    if (close !== -1) this.fail('The sequence "]]>" is not allowed in character data.', from + close);
    // A run processed in parts reports limits at its start, as whole-text parsing does.
    const at = this.segmentStart === -1 ? this.base + from : this.segmentStart;
    this.appendText(raw.indexOf('&') === -1 ? raw : this.expandReferences(raw, from), at);
  }

  private cdata(): void {
    const start = this.pos + 9;
    const end = this.s.indexOf(']]>', start);
    if (end === -1) this.fail('CDATA section is not terminated.', this.pos);
    this.appendText(this.s.slice(start, end), this.base + this.pos);
    this.pos = end + 3;
  }

  /** `at` is an absolute offset. */
  private appendText(text: string, at: number): void {
    if (text.length === 0) return;
    if (this.textBuffer.length + text.length > this.options.limits.maxXmlTextLength) {
      const message = 'Text node is longer than the limit.';
      if (at === this.segmentStart && this.segmentLocation !== null && at < this.base) {
        const details: TvDetails = { limit: 'maxXmlTextLength', value: this.options.limits.maxXmlTextLength };
        throw new TvError('TV_E_LIMIT_EXCEEDED', message, {
          location: this.segmentLocation,
          hint: `If you trust this file, raise the limit, for example { limits: { maxXmlTextLength: ${String(this.options.limits.maxXmlTextLength * 4)} } }.`,
          details,
        });
      }
      this.limit('maxXmlTextLength', message, at - this.base);
    }
    this.textBuffer += text;
  }

  private flushText(): void {
    if (this.textBuffer.length > 0) {
      const text = this.textBuffer;
      this.textBuffer = '';
      this.handler.text(text);
    }
  }

  /**
   * Expands entity and character references in `raw`, which starts at offset `base`.
   */
  private expandReferences(raw: string, base: number): string {
    let out = '';
    let last = 0;
    let amp = raw.indexOf('&');
    while (amp !== -1) {
      out += raw.slice(last, amp);
      const semi = raw.indexOf(';', amp + 1);
      if (semi === -1) this.fail('"&" must start an entity or character reference ending with ";".', base + amp);
      const body = raw.slice(amp + 1, semi);
      if (body.charCodeAt(0) === HASH) {
        out += this.characterReference(body, base + amp);
      } else {
        const value = PREDEFINED_ENTITIES.get(body);
        if (value === undefined) {
          if (body.length > this.options.limits.maxXmlNameLength) {
            this.limit('maxXmlNameLength', 'Entity name is longer than the limit.', base + amp);
          }
          if (!this.isName(body)) this.fail('"&" must start an entity or character reference.', base + amp);
          throw new TvError(
            'TV_E_XML_ENTITY_FORBIDDEN',
            `Reference to entity "&${body};", which is not one of the five predefined XML entities.`,
            {
              location: this.location(base + amp),
              hint: 'Only &lt; &gt; &amp; &apos; &quot; and character references such as &#160; are allowed, because tplvane does not process DTDs. Re-save the file in the application that made it.',
              details: { entity: body },
            },
          );
        }
        out += value;
      }
      last = semi + 1;
      amp = raw.indexOf('&', last);
    }
    out += raw.slice(last);
    return out;
  }

  /**
   * `&#` [0-9]+ `;` or `&#x` [0-9a-fA-F]+ `;` (XML 1.0 [66], X-02): any number of digits, so
   * leading zeros are allowed; only a lowercase `x` introduces the hexadecimal form.
   */
  private characterReference(body: string, at: number): string {
    const shown = body.length > 20 ? `${body.slice(0, 20)}…` : body;
    const hex = body.charCodeAt(1) === 0x78; /* x */
    const start = hex ? 2 : 1;
    if (body.length === start) this.fail(`Invalid character reference "&${shown};".`, at);
    let code = 0;
    for (let i = start; i < body.length; i++) {
      const c = body.charCodeAt(i);
      let d: number;
      if (c >= 0x30 && c <= 0x39) d = c - 0x30;
      else if (hex && c >= 0x61 && c <= 0x66) d = c - 0x57;
      else if (hex && c >= 0x41 && c <= 0x46) d = c - 0x37;
      else return this.fail(`Invalid character reference "&${shown};".`, at);
      // Stop growing once the value is out of range; the digits are still all validated.
      if (code <= 0x10ffff) code = code * (hex ? 16 : 10) + d;
    }
    if (!isXmlChar(code)) this.fail(`Character reference "&${shown};" refers to a character not allowed in XML.`, at);
    return String.fromCodePoint(code);
  }

  // ----- tags -----------------------------------------------------------------------------

  private startTag(): void {
    const s = this.s;
    const tagStart = this.pos;
    this.flushText();
    this.pos++;
    const qname = this.readName();
    const raw: [name: string, value: string, at: number][] = [];
    let selfClosing = false;
    for (;;) {
      const hadSpace = this.skipWhitespace();
      const c = s.charCodeAt(this.pos);
      if (c === GT) {
        this.pos++;
        break;
      }
      if (c === SLASH) {
        if (s.charCodeAt(this.pos + 1) !== GT) this.fail('Expected ">" after "/".', this.pos);
        this.pos += 2;
        selfClosing = true;
        break;
      }
      if (Number.isNaN(c)) this.fail(`Start tag <${qname}> is not terminated.`, tagStart);
      if (!hadSpace) this.fail('Attributes must be separated by whitespace.', this.pos);
      const at = this.pos;
      const name = this.readName();
      this.skipWhitespace();
      if (s.charCodeAt(this.pos) !== EQ) this.fail(`Attribute "${name}" has no value.`, this.pos);
      this.pos++;
      this.skipWhitespace();
      const quote = s.charCodeAt(this.pos);
      if (quote !== QUOTE && quote !== APOS) this.fail(`Value of attribute "${name}" must be quoted.`, this.pos);
      const valueStart = this.pos + 1;
      const valueEnd = s.indexOf(quote === QUOTE ? '"' : "'", valueStart);
      if (valueEnd === -1) this.fail(`Value of attribute "${name}" is not terminated.`, this.pos);
      if (valueEnd - valueStart > this.options.limits.maxXmlTextLength) {
        this.limit('maxXmlTextLength', `Value of attribute "${name}" is longer than the limit.`, valueStart);
      }
      let value = s.slice(valueStart, valueEnd);
      const lt = value.indexOf('<');
      if (lt !== -1) this.fail('"<" is not allowed in attribute values.', valueStart + lt);
      // §3.3.3: each literal whitespace character becomes a space; CR is already gone (§2.11).
      if (value.indexOf('\n') !== -1 || value.indexOf('\t') !== -1) value = value.replace(/[\n\t]/g, ' ');
      if (value.indexOf('&') !== -1) value = this.expandReferences(value, valueStart);
      for (const [existing] of raw) {
        if (existing === name) this.fail(`Attribute "${name}" appears twice.`, at);
      }
      raw.push([name, value, at]);
      if (raw.length > this.options.limits.maxXmlAttributes) {
        this.limit('maxXmlAttributes', `Element <${qname}> has more attributes than the limit.`, at);
      }
      this.pos = valueEnd + 1;
    }

    if (this.stack.length + 1 > this.options.limits.maxXmlDepth) {
      this.limit('maxXmlDepth', 'Elements are nested deeper than the limit.', tagStart);
    }

    // Namespace declarations first: they apply to the element itself and its attributes.
    let undo: [string, string | undefined][] | null = null;
    for (const [name, value, at] of raw) {
      let prefix: string;
      if (name === 'xmlns') prefix = '';
      else if (name.startsWith('xmlns:')) {
        prefix = name.slice(6);
        // PrefixedAttName ::= 'xmlns:' NCName (Namespaces in XML 1.0 [2], N-01).
        this.checkNcName(prefix, at);
      } else continue;
      this.checkDeclaration(prefix, value, at);
      (undo ??= []).push([prefix, this.bindings.get(prefix)]);
      this.bindings.set(prefix, value);
    }

    const [ns, local] = this.resolve(qname, true, tagStart);
    const attrs = new Map<string, string>();
    for (const [name, value, at] of raw) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      const [attrNs, attrLocal] = this.resolve(name, false, at);
      const key = attrNs === '' ? attrLocal : `{${attrNs}}${attrLocal}`;
      if (attrs.has(key)) this.fail(`Attribute "${name}" appears twice (same namespace and local name).`, at);
      attrs.set(key, value);
    }

    const span: XmlSpan = { start: this.base + tagStart, end: this.base + this.pos, qname, empty: selfClosing };
    this.handler.start(ns, local, attrs, span);
    if (selfClosing) {
      this.handler.end(ns, local, { start: this.base + this.pos, end: this.base + this.pos, qname, empty: true });
      this.restore(undo);
    } else {
      this.stack.push({ qname, ns, local, undo });
    }
  }

  private endTag(): void {
    const tagStart = this.pos;
    this.pos += 2;
    const qname = this.readName();
    this.skipWhitespace();
    if (this.s.charCodeAt(this.pos) !== GT) this.fail(`End tag </${qname}> is not terminated.`, tagStart);
    this.pos++;
    const open = this.stack.pop();
    if (open === undefined || open.qname !== qname) {
      this.fail(
        open === undefined ? `End tag </${qname}> has no start tag.` : `End tag </${qname}> does not match <${open.qname}>.`,
        tagStart,
      );
    }
    this.flushText();
    this.handler.end(open.ns, open.local, { start: this.base + tagStart, end: this.base + this.pos, qname, empty: false });
    this.restore(open.undo);
  }

  private restore(undo: [string, string | undefined][] | null): void {
    if (undo === null) return;
    for (let i = undo.length - 1; i >= 0; i--) {
      const entry = undo[i];
      if (entry === undefined) continue;
      const [prefix, previous] = entry;
      if (previous === undefined) this.bindings.delete(prefix);
      else this.bindings.set(prefix, previous);
    }
  }

  /** Namespace constraints on declarations (Namespaces in XML 1.0, §3). */
  private checkDeclaration(prefix: string, uri: string, at: number): void {
    // Namespace names become part of attribute keys ({uri}local), so they are bounded like
    // names; real Office Open XML namespace names are well under 100 characters.
    if (uri.length > this.options.limits.maxXmlNameLength) {
      this.limit('maxXmlNameLength', 'Namespace name is longer than the limit.', at);
    }
    if (prefix === 'xmlns') this.fail('The prefix "xmlns" must not be declared.', at);
    if (prefix === 'xml' && uri !== XML_NAMESPACE) this.fail('The prefix "xml" must not be bound to another namespace.', at);
    if (prefix !== 'xml' && uri === XML_NAMESPACE) this.fail('The XML namespace must not be bound to another prefix.', at);
    if (uri === XMLNS_NAMESPACE) this.fail('The xmlns namespace must not be declared.', at);
    if (prefix !== '' && uri === '') this.fail(`Prefix "${prefix}" cannot be undeclared in XML 1.0.`, at);
    if (prefix !== '') this.checkNcName(prefix, at);
  }

  private resolve(qname: string, element: boolean, at: number): [ns: string, local: string] {
    const colon = qname.indexOf(':');
    if (colon === -1) return [element ? (this.bindings.get('') ?? '') : '', qname];
    const prefix = qname.slice(0, colon);
    const local = qname.slice(colon + 1);
    this.checkNcName(prefix, at);
    this.checkNcName(local, at);
    const ns = this.bindings.get(prefix);
    if (ns === undefined) this.fail(`Namespace prefix "${prefix}" is not declared.`, at);
    return [ns, local];
  }

  private checkNcName(name: string, at: number): void {
    if (name.length === 0 || name.indexOf(':') !== -1) this.fail(`"${name}" is not a valid name.`, at);
  }

  private readName(): string {
    const s = this.s;
    const start = this.pos;
    const first = s.codePointAt(start) ?? -1;
    if (!isNameStartChar(first)) this.fail('Expected a name.', start);
    let i = start + (first > 0xffff ? 2 : 1);
    for (;;) {
      const c = s.charCodeAt(i);
      if (c < 0x80) {
        if (!isNameChar(c)) break;
        i++;
      } else {
        const cp = s.codePointAt(i) ?? -1;
        if (!isNameChar(cp)) break;
        i += cp > 0xffff ? 2 : 1;
      }
      if (i - start > this.options.limits.maxXmlNameLength) {
        this.limit('maxXmlNameLength', 'Name is longer than the limit.', start);
      }
    }
    this.pos = i;
    return s.slice(start, i);
  }

  private isName(text: string): boolean {
    if (text.length === 0) return false;
    const first = text.codePointAt(0) ?? -1;
    if (!isNameStartChar(first)) return false;
    for (let i = first > 0xffff ? 2 : 1; i < text.length; ) {
      const cp = text.codePointAt(i) ?? -1;
      if (!isNameChar(cp)) return false;
      i += cp > 0xffff ? 2 : 1;
    }
    return true;
  }

  private skipWhitespace(): boolean {
    const start = this.pos;
    while (isWhitespace(this.s.charCodeAt(this.pos))) this.pos++;
    return this.pos > start;
  }

  // ----- comments, processing instructions, DOCTYPE ---------------------------------------

  private skipComment(): void {
    const start = this.pos;
    const end = this.s.indexOf('--', start + 4);
    // Comments are limited like text (D-H01), so a streamed one cannot hold unbounded memory.
    if ((end === -1 ? this.s.length : end) - (start + 4) > this.options.limits.maxXmlTextLength) this.limit('maxXmlTextLength', COMMENT_TOO_LONG, start);
    if (end === -1) this.fail('Comment is not terminated.', start);
    if (this.s.charCodeAt(end + 2) !== GT) this.fail('"--" is not allowed inside a comment.', end);
    this.pos = end + 3;
  }

  private skipProcessingInstruction(declaration: boolean): void {
    const start = this.pos;
    this.pos += 2;
    const target = this.readName();
    if (!declaration && target.toLowerCase() === 'xml') {
      this.fail('The XML declaration is allowed only at the very start of the document.', start);
    }
    const end = this.s.indexOf('?>', this.pos);
    if ((end === -1 ? this.s.length : end) - (start + 2) > this.options.limits.maxXmlTextLength) this.limit('maxXmlTextLength', PI_TOO_LONG, start);
    if (end === -1) this.fail('Processing instruction is not terminated.', start);
    const c = this.s.charCodeAt(this.pos);
    if (this.pos !== end && !isWhitespace(c)) this.fail('Invalid processing instruction target.', start);
    if (declaration) {
      // XMLDecl ::= '<?xml' VersionInfo …, VersionInfo ::= S 'version' Eq … (XML 1.0 [23], [24], X-13).
      let i = this.pos;
      while (isWhitespace(this.s.charCodeAt(i))) i++;
      if (i === this.pos || !this.s.startsWith('version', i)) {
        this.fail('The XML declaration must start with the version, e.g. <?xml version="1.0"?>.', start);
      }
    }
    this.pos = end + 2;
  }

  private failDoctype(): never {
    throw new TvError('TV_E_XML_DTD_FORBIDDEN', 'The part contains a document type declaration (DTD).', {
      location: this.location(this.pos),
      hint: 'tplvane rejects DTDs to protect against external entities (XXE) and entity expansion attacks. Office Open XML parts do not use DTDs; if the file was generated by a program, report the problem to its authors.',
    });
  }

  // ----- errors ---------------------------------------------------------------------------

  /** Location of an offset into the current buffer. */
  private location(offset: number): { part: string; line: number; column: number } {
    let line = 1 + this.droppedLines;
    let lineStart = this.lineStartAbs;
    for (let i = this.s.indexOf('\n'); i !== -1 && i < offset; i = this.s.indexOf('\n', i + 1)) {
      line++;
      lineStart = this.base + i + 1;
    }
    return { part: this.options.part, line, column: this.base + offset - lineStart + 1 };
  }

  private fail(message: string, offset: number): never {
    throw new TvError('TV_E_XML_MALFORMED', message, {
      location: this.location(offset),
      hint: 'The part is not well-formed XML. Re-save the file in the application that made it; if it was generated by a program, report the problem to its authors.',
    });
  }

  /** The attribute name before `name = "` whose quote is at `quote` (for a message). */
  private attributeNameBefore(quote: number): string {
    const s = this.s;
    let i = quote - 1;
    while (i >= 0 && isWhitespace(s.charCodeAt(i))) i--;
    if (s.charCodeAt(i) === EQ) i--;
    while (i >= 0 && isWhitespace(s.charCodeAt(i))) i--;
    const end = i + 1;
    while (i >= 0 && end - i <= this.options.limits.maxXmlNameLength && !isWhitespace(s.charCodeAt(i)) && s.charCodeAt(i) !== 0x3c) i--;
    return s.slice(i + 1, end);
  }

  private limit(limit: keyof XmlLimits, message: string, offset: number): never {
    const details: TvDetails = { limit, value: this.options.limits[limit] };
    throw new TvError('TV_E_LIMIT_EXCEEDED', message, {
      location: this.location(offset),
      hint: `If you trust this file, raise the limit, for example { limits: { ${limit}: ${String(this.options.limits[limit] * 4)} } }.`,
      details,
    });
  }
}

/**
 * Decodes the bytes of an XML part. Office Open XML packaging parts are UTF-8 or UTF-16
 * (xlvane E-55); a byte order mark selects UTF-16, otherwise UTF-8 is used. Invalid byte sequences
 * and declarations of other encodings are rejected.
 */
export function decodeXml(bytes: Uint8Array, part: string): string {
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new TvError('TV_E_XML_ENCODING', `The part is not valid ${encoding.toUpperCase()}.`, {
      location: { part },
      hint: 'Office Open XML parts must be encoded in UTF-8 or UTF-16. Re-save the file in the application that made it.',
      cause,
    });
  }
  const declared = declaredEncoding(text);
  if (declared !== null) {
    const normalized = declared.toLowerCase();
    const ok = encoding === 'utf-8' ? normalized === 'utf-8' : normalized === 'utf-16' || normalized === encoding;
    if (!ok) {
      throw new TvError('TV_E_XML_ENCODING', `The part declares encoding "${clip(declared)}", which is not supported.`, {
        location: { part },
        hint: 'Office Open XML parts must be encoded in UTF-8 or UTF-16. Re-save the file in the application that made it.',
        details: { encoding: clip(declared) },
      });
    }
  }
  return text;
}

/** Returns the `encoding` pseudo-attribute of the XML declaration, if present. */
function declaredEncoding(text: string): string | null {
  if (!text.startsWith('<?xml')) return null;
  const end = text.indexOf('?>');
  if (end === -1) return null;
  const decl = text.slice(5, end);
  const at = decl.indexOf('encoding');
  if (at === -1) return null;
  let i = at + 8;
  while (isWhitespace(decl.charCodeAt(i))) i++;
  if (decl.charCodeAt(i) !== EQ) return null;
  i++;
  while (isWhitespace(decl.charCodeAt(i))) i++;
  const quote = decl[i];
  if (quote !== '"' && quote !== "'") return null;
  const close = decl.indexOf(quote, i + 1);
  return close === -1 ? null : decl.slice(i + 1, close);
}
