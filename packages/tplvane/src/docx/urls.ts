// Which link targets a document may get from data (D-032): absolute http, https and mailto URLs
// only, so that data cannot make a document open a local file, run script or carry a data URL.

const MAX_URL_LENGTH = 2048;

/** null when `url` may be a link target, otherwise a message that says why not. */
export function checkLinkUrl(url: string): string | null {
  if (url.length > MAX_URL_LENGTH) return `The address is longer than ${String(MAX_URL_LENGTH)} characters.`;
  // No spaces, quotes, angle brackets or control characters anywhere in it.
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x22 || c === 0x3c || c === 0x3e || c === 0x5c || c === 0x60 || (c >= 0x80 && c <= 0x9f)) return 'The address contains a space, a quote, an angle bracket, a backslash or a control character.';
    // Characters XML cannot hold (U+FFFE, U+FFFF, a lone surrogate) and those that reorder or hide
    // text (bidi controls, zero-width marks), which could make a shown address lie (D-071).
    const lone = (c >= 0xd800 && c <= 0xdbff && !(url.charCodeAt(i + 1) >= 0xdc00 && url.charCodeAt(i + 1) <= 0xdfff)) || (c >= 0xdc00 && c <= 0xdfff && !(url.charCodeAt(i - 1) >= 0xd800 && url.charCodeAt(i - 1) <= 0xdbff));
    if (lone || c === 0xfffe || c === 0xffff || (c >= 0xfdd0 && c <= 0xfdef) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x061c || c === 0xfeff) {
      return 'The address contains a character that cannot be in a document or that changes how text is shown (such as a bidirectional control).';
    }
  }
  const lower = url.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    const rest = url.slice(lower.startsWith('https://') ? 8 : 7);
    const host = rest.split(/[/?#]/, 1)[0] ?? '';
    return host === '' || host.startsWith('@') ? 'The address has no host.' : null;
  }
  if (lower.startsWith('mailto:')) return url.length > 7 ? null : 'The mailto address is empty.';
  return 'Only http, https and mailto addresses can be links.';
}
