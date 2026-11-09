// Types of fixtures.mjs for the tests.
/** The offer of the 5-minute start (examples/offer). */
export function offerDocx(): Uint8Array;
/** A presentation of one slide with a value and a loop; use with PPTX_SMOKE_DATA. */
export function pptxSmoke(): Uint8Array;
export const PPTX_SMOKE_DATA: { customer: { name: string }; products: { name: string }[] };
/** A workbook with a loop over a row and a total; use with XLSX_SMOKE_DATA. */
export function xlsxSmoke(): Uint8Array;
export const XLSX_SMOKE_DATA: { customer: { name: string }; items: { name: string; price: number }[] };
