// Errors of xlvane as docvane errors. docvane reads and edits workbooks only through the public
// API of xlvane (D-041); its XlvError carries the same kind of information (code, place, hint,
// details), so it maps onto DvError with the original kept in `cause`.
import { isXlvError, type XlvError } from 'xlvane';
import { DvError, type DvErrorCode, type DvLocation } from '../errors';

const SAME: ReadonlyMap<string, DvErrorCode> = new Map([
  ['XLV_E_LIMIT_EXCEEDED', 'DV_E_LIMIT_EXCEEDED'],
  ['XLV_E_NOT_ZIP', 'DV_E_NOT_ZIP'],
  ['XLV_E_UNSUPPORTED_CONTAINER', 'DV_E_UNSUPPORTED_CONTAINER'],
  ['XLV_E_ZIP_CORRUPT', 'DV_E_ZIP_CORRUPT'],
  ['XLV_E_ZIP_UNSUPPORTED', 'DV_E_ZIP_UNSUPPORTED'],
  ['XLV_E_XML_MALFORMED', 'DV_E_XML_MALFORMED'],
  ['XLV_E_XML_DTD_FORBIDDEN', 'DV_E_XML_DTD_FORBIDDEN'],
  ['XLV_E_XML_ENTITY_FORBIDDEN', 'DV_E_XML_ENTITY_FORBIDDEN'],
  ['XLV_E_XML_ENCODING', 'DV_E_XML_ENCODING'],
  ['XLV_E_PART_MISSING', 'DV_E_PART_MISSING'],
  ['XLV_E_NOT_SUPPORTED', 'DV_E_NOT_SUPPORTED'],
  ['XLV_E_INVALID_VALUE', 'DV_E_INVALID_VALUE'],
  ['XLV_E_INTERNAL', 'DV_E_INTERNAL'],
]);

/** The place of an xlvane error in docvane's terms. */
function locationOf(error: XlvError): DvLocation {
  const { part, sheet, cell } = error.location;
  const where = sheet === undefined ? {} : { story: 'sheet' as const, sheet, description: cell === undefined ? `sheet ${sheet}` : `sheet ${sheet}, cell ${cell}` };
  return { ...(part === undefined ? {} : { part }), ...where, ...(cell === undefined ? {} : { cell }) };
}

/**
 * Runs `fn`, turning an XlvError into a DvError with the same message and hint. `context` says
 * what docvane was doing, for errors that the template author cannot read as they are.
 */
export function viaXlvane<T>(fn: () => T, context: string): T {
  try {
    return fn();
  } catch (error) {
    if (!isXlvError(error)) throw error;
    const code = SAME.get(error.code) ?? 'DV_E_PART_INVALID';
    const details: Record<string, string | number | boolean | null> = { xlvaneCode: error.code };
    const limit = error.details['limit'];
    if (typeof limit === 'string') details['limit'] = limit;
    const value = error.details['value'];
    if (typeof value === 'number') details['value'] = value;
    throw new DvError(code, `${context}: ${error.message}`, { location: locationOf(error), hint: error.hint, details, cause: error });
  }
}
