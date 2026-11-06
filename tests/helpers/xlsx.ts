// Builds small XLSX workbooks for tests with the public API of xlvane, and reads results back the
// same way. Each sheet is a map from A1 references to values; a value can carry a style.
import { createWorkbook, readWorkbook, writeWorkbook, type CellInput, type CellStyle, type Workbook } from 'xlvane';

export interface Styled {
  readonly value: CellInput;
  readonly style: CellStyle;
}

export type SheetSpec = Readonly<Record<string, CellInput | Styled>>;

const isStyled = (v: CellInput | Styled): v is Styled => v !== null && typeof v === 'object' && !(v instanceof Date) && 'style' in v;

/** A workbook with the sheets in order. */
export function buildXlsx(sheets: Readonly<Record<string, SheetSpec>>, extra?: (wb: ReturnType<typeof createWorkbook>) => void): Uint8Array {
  const wb = createWorkbook();
  for (const [name, cells] of Object.entries(sheets)) {
    const sheet = wb.addSheet(name);
    for (const [ref, v] of Object.entries(cells)) {
      if (isStyled(v)) sheet.set(ref, v.value, v.style);
      else sheet.set(ref, v);
    }
  }
  extra?.(wb);
  return writeWorkbook(wb);
}

export interface CellView {
  readonly value: unknown;
  readonly formula?: string;
}

/** The cells of each sheet: the value, or `{ formula }` for a formula cell. Empty cells are left out. */
export function readXlsx(bytes: Uint8Array): Record<string, Record<string, unknown>> {
  const wb: Workbook = readWorkbook(bytes);
  const out: Record<string, Record<string, unknown>> = {};
  for (const sheet of wb.sheets) {
    const cells: Record<string, unknown> = {};
    for (const cell of sheet.cells()) {
      if (cell.formula !== null) cells[cell.ref] = { formula: cell.formula.text };
      else if (cell.type !== 'empty') cells[cell.ref] = cell.value instanceof Date ? cell.value.toISOString() : cell.value;
    }
    out[sheet.name] = cells;
  }
  return out;
}

/** The workbook, to look at styles, merges and row heights. */
export function workbookOf(bytes: Uint8Array): Workbook {
  return readWorkbook(bytes);
}
