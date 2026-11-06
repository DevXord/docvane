// Copied from DevXord/xlvane packages/xlvane/src/util/clip.ts at aeaefbc (unchanged since ada547b),
// unchanged. D-H01 below refers to the notes of xlvane.
//
// Text from a file shown in messages and error details is shortened, so that a value of
// megabytes is not copied into every message, log line or report that shows it (D-H01).

/** The most characters of a value from the file that a message or detail shows. */
export const MAX_SHOWN = 200;

/**
 * The first `length` UTF-16 code units of `text`, one fewer when the cut would split a surrogate
 * pair, so that no lone high surrogate is left at the end.
 */
export function cutAt(text: string, length: number): string {
  const code = text.charCodeAt(length - 1);
  const pairStart = code >= 0xd800 && code <= 0xdbff && text.length > length;
  return text.slice(0, pairStart ? length - 1 : length);
}

/** Shortens a value from the file for messages and details, on a code point boundary. */
export function clip(value: string): string {
  return value.length > MAX_SHOWN ? `${cutAt(value, MAX_SHOWN)}…` : value;
}
