// Copied from DevXord/xlvane packages/xlvane/src/zip/cp437.ts at aeaefbc (unchanged since ada547b),
// unchanged. Z-18 below refers to the notes of xlvane.
//
// IBM Code Page 437, used for ZIP file names when general purpose bit 11 is not set
// (APPNOTE Appendix D; Z-18). Bytes 0x00-0x7F map to the same code points; this string
// holds the characters for bytes 0x80-0xFF, generated from the Unicode Consortium mapping
// https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT (table version 2.00).
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

/** Decodes bytes in IBM Code Page 437. */
export function decodeCp437(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += b < 0x80 ? String.fromCharCode(b) : (HIGH[b - 0x80] as string);
  }
  return out;
}
