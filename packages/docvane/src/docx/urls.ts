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
