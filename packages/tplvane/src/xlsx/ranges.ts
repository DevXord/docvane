// The tplvane rule for formulas below repeated rows (D-041). When the rows of a section are
// repeated, the new rows go below the template rows. A spreadsheet application, and xlvane's
// insertRows with it, grows only the areas that the new rows fall into, so `SUM(C5:C5)` below a
// template row 5 would still add up one row. tplvane therefore extends every A1 area whose lower
// end is the last template row to the last copy.
//
// The scanner is narrow on purpose. It recognises areas of two A1 cell references (`C5:C5`,
// `$C$2:$C$5`), with an optional sheet prefix (`Data!`, `'Bob''s data'!`). It skips text in
// strings and in brackets (structured and external references), and leaves alone single cells,
// whole rows and columns, 3-D references (`Jan:Mar!A1:A5`), external references (`[1]Data!`)
// and names. It works in one pass, without regular expressions that could backtrack.
//
// The same scanner finds single cells of the repeated rows in formulas outside them (`SUM(D4)`,
// which Google Sheets writes for `SUM(D4:D4)`): they do not grow, and inspect, validate and render
// warn about them with TV_W_FORMULA_NOT_EXTENDED (D-080).

/** The area end to look for and where it moves. */
export interface AreaChange {
  /** The sheet of the template rows. Sheet names are compared ignoring case, as in Excel. */
  readonly sheet: string;
  /** The sheet that holds the formula; references without a prefix belong to it. */
  readonly formulaSheet: string;
  /** The last template row (1-based). */
  readonly row: number;
  /** The last row of the last copy. */
  readonly to: number;
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
/** Characters of an unquoted name, cell reference or function name. */
const isWordChar = (c: number): boolean => isLetter(c) || isDigit(c) || c === 95 || c === 46 || c === 36 || c === 92 || c === 63 || c > 127;

/** A cell reference such as `C5`, `$C$5` or `AB12`: where its row digits are, and the row. */
interface CellRef {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly row: number;
}

/** Reads `text[from, to)` as a cell reference, or returns null. */
function cellRef(text: string, from: number, to: number): CellRef | null {
  let i = from;
  if (text.charCodeAt(i) === 36) i++;
  const letters = i;
  while (i < to && isLetter(text.charCodeAt(i))) i++;
  if (i === letters || i - letters > 3) return null;
  if (text.charCodeAt(i) === 36) i++;
  const rowStart = i;
  while (i < to && isDigit(text.charCodeAt(i))) i++;
  // Excel writes rows without leading zeros; anything else here is not a reference.
  if (i !== to || i === rowStart || text.charCodeAt(rowStart) === 48 || i - rowStart > 7) return null;
  return { rowStart, rowEnd: i, row: Number(text.slice(rowStart, i)) };
}

/** The end of the word starting at `from`. */
function wordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
  return i;
}

/** A reference found by {@link scanReferences}; `belongs` tells whether it is on the sheet looked for. */
type Reference =
  | { readonly kind: 'area'; readonly lower: CellRef; readonly belongs: boolean }
  | { readonly kind: 'cell'; readonly cell: CellRef; readonly start: number; readonly end: number; readonly belongs: boolean };

/**
 * Walks the A1 references of `formula` (without the leading "="): areas of two cell references and
 * single cell references, each with whether it is on `sheet`. References without a prefix are on
 * `formulaSheet`. The text of a single cell, `formula.slice(start, end)`, includes its sheet prefix.
 */
function scanReferences(formula: string, sheet: string, formulaSheet: string, visit: (ref: Reference) => void): void {
  const target = sheet.toLowerCase();
  const own = formulaSheet.toLowerCase() === target;
  // The sheet that the next reference belongs to: null for none yet, or 'other' when it is not the target.
  let prefix: 'target' | 'other' | null = null;
  let prefixStart = 0;
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const c = formula.charCodeAt(i);
    if (c === 34) {
      // A string: "" is an escaped quote.
      i++;
      while (i < n) {
        if (formula.charCodeAt(i) === 34) {
          if (formula.charCodeAt(i + 1) === 34) i += 2;
          else break;
        } else i++;
      }
      i++;
      prefix = null;
      continue;
    }
    if (c === 39) {
      // A quoted sheet name: '' is an escaped apostrophe. Only a name followed by "!" counts.
      const quote = i;
      let j = i + 1;
      const parts: string[] = [];
      let from = j;
      let closed = false;
      while (j < n) {
        if (formula.charCodeAt(j) === 39) {
          parts.push(formula.slice(from, j));
          if (formula.charCodeAt(j + 1) === 39) {
            parts.push("'");
            j += 2;
            from = j;
          } else {
            closed = true;
            break;
          }
        } else j++;
      }
      if (!closed) break;
      const name = parts.join('');
      if (formula.charCodeAt(j + 1) === 33) {
        prefix = name.toLowerCase() === target ? 'target' : 'other';
        prefixStart = quote;
        i = j + 2;
      } else {
        prefix = null;
        i = j + 1;
      }
      continue;
    }
    if (c === 91) {
      // Brackets: a structured reference or the book of an external reference. Its sheet is never the target.
      const bracket = i;
      let depth = 0;
      while (i < n) {
        const d = formula.charCodeAt(i);
        if (d === 91) depth++;
        else if (d === 93 && --depth === 0) break;
        i++;
      }
      i++;
      const end = wordEnd(formula, i);
      if (end > i && formula.charCodeAt(end) === 33) {
        prefix = 'other';
        prefixStart = bracket;
        i = end + 1;
      } else prefix = null;
      continue;
    }
    if (isWordChar(c)) {
      const end = wordEnd(formula, i);
      const next = formula.charCodeAt(end);
      if (next === 33) {
        // A sheet prefix; after ":" it is the last sheet of a 3-D reference.
        const threeD = i > 0 && formula.charCodeAt(i - 1) === 58;
        prefix = !threeD && formula.slice(i, end).toLowerCase() === target ? 'target' : 'other';
        prefixStart = i;
        i = end + 1;
        continue;
      }
      const belongs = prefix === null ? own : prefix === 'target';
      const first = cellRef(formula, i, end);
      if (first !== null && next === 58) {
        const secondStart = end + 1;
        const secondEnd = wordEnd(formula, secondStart);
        const second = cellRef(formula, secondStart, secondEnd);
        const after = formula.charCodeAt(secondEnd);
        if (second !== null && after !== 33 && after !== 40) {
          visit({ kind: 'area', lower: second.row >= first.row ? second : first, belongs });
          i = secondEnd;
          prefix = null;
          continue;
        }
      } else if (first !== null && next !== 40) {
        // A single cell; a name followed by "(" is a function such as LOG10.
        visit({ kind: 'cell', cell: first, start: prefix === null ? i : prefixStart, end, belongs });
      }
      i = end;
      prefix = null;
      continue;
    }
    i++;
    prefix = null;
  }
}

/**
 * Returns `formula` (without the leading "=") with every A1 area of `change.sheet` whose lower end
 * is on `change.row` extended to `change.to`. Everything else is kept character for character.
 *
 * @example
 * ```ts
 * extendAreas('SUM(C5:C5)', { sheet: 'Data', formulaSheet: 'Data', row: 5, to: 9 }); // 'SUM(C5:C9)'
 * ```
 */
export function extendAreas(formula: string, change: AreaChange): string {
  if (change.to === change.row) return formula;
  const replacement = String(change.to);
  const out: string[] = [];
  let copied = 0;
  scanReferences(formula, change.sheet, change.formulaSheet, (ref) => {
    if (ref.kind !== 'area' || !ref.belongs || ref.lower.row !== change.row) return;
    out.push(formula.slice(copied, ref.lower.rowStart), replacement);
    copied = ref.lower.rowEnd;
  });
  if (copied === 0) return formula;
  out.push(formula.slice(copied));
  return out.join('');
}

/** The repeated rows looked for by {@link singleCellRefs}. */
export interface RepeatedRows {
  /** The sheet of the repeated rows. Sheet names are compared ignoring case, as in Excel. */
  readonly sheet: string;
  /** The sheet that holds the formula; references without a prefix belong to it. */
  readonly formulaSheet: string;
  /** The first and the last repeated row (1-based). */
  readonly first: number;
  readonly last: number;
}

/**
 * Returns the single cell references of `formula` (without the leading "=") that point into the
 * repeated rows, as written (with their sheet prefix). Such a reference does not grow with the
 * copies, unlike an area (D-041), which TV_W_FORMULA_NOT_EXTENDED reports (D-080).
 *
 * @example
 * ```ts
 * singleCellRefs('SUM(D4)', { sheet: 'Data', formulaSheet: 'Data', first: 4, last: 4 }); // ['D4']
 * ```
 */
export function singleCellRefs(formula: string, rows: RepeatedRows): string[] {
  const found: string[] = [];
  scanReferences(formula, rows.sheet, rows.formulaSheet, (ref) => {
    if (ref.kind === 'cell' && ref.belongs && ref.cell.row >= rows.first && ref.cell.row <= rows.last) found.push(formula.slice(ref.start, ref.end));
  });
  return found;
}
