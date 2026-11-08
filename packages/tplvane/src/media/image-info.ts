// Recognises PNG, JPEG and GIF images by their signature and reads their size in pixels and their
// resolution from the header, without decoding the image (D-031). Every read is bounds-checked,
// and the scans over PNG chunks and JPEG segments move forward by the declared lengths only, so
// the work is linear in the size of the input whatever the bytes say.

/** What tplvane needs to know about an image. */
export interface ImageInfo {
  readonly type: 'png' | 'jpeg' | 'gif';
  /** File extension of the media part. */
  readonly extension: 'png' | 'jpeg' | 'gif';
  readonly contentType: 'image/png' | 'image/jpeg' | 'image/gif';
  readonly width: number;
  readonly height: number;
  /** Pixels per inch from the file, or 96 when the file does not say. */
  readonly dpiX: number;
  readonly dpiY: number;
}

const DEFAULT_DPI = 96;

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number): number => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);

function starts(b: Uint8Array, sig: readonly number[]): boolean {
  return b.length >= sig.length && sig.every((x, i) => b[i] === x);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(b: Uint8Array): ImageInfo | string {
  if (b.length < 33 || u32be(b, 8) !== 13 || String.fromCharCode(...b.subarray(12, 16)) !== 'IHDR') return 'The PNG image has no valid header (IHDR).';
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  let dpiX = DEFAULT_DPI;
  let dpiY = DEFAULT_DPI;
  // pHYs comes before the first IDAT chunk (PNG specification, 11.3.5.3).
  for (let at = 8; at + 12 <= b.length; ) {
    const length = u32be(b, at);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'pHYs' && length === 9 && at + 17 <= b.length && b[at + 16] === 1) {
      dpiX = Math.round(u32be(b, at + 8) * 0.0254) || DEFAULT_DPI;
      dpiY = Math.round(u32be(b, at + 12) * 0.0254) || DEFAULT_DPI;
    }
    at += 12 + length;
  }
  return { type: 'png', extension: 'png', contentType: 'image/png', width, height, dpiX, dpiY };
}

function jpeg(b: Uint8Array): ImageInfo | string {
  let dpiX = DEFAULT_DPI;
  let dpiY = DEFAULT_DPI;
  for (let at = 2; at + 4 <= b.length; ) {
    if (b[at] !== 0xff) return 'The JPEG image has a damaged structure.';
    const marker = b[at + 1] as number;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = u16be(b, at + 2);
    if (length < 2) return 'The JPEG image has a damaged structure.';
    // APP0 JFIF: density units 1 = dots per inch, 2 = dots per centimetre.
    if (marker === 0xe0 && length >= 16 && String.fromCharCode(...b.subarray(at + 4, at + 9)) === 'JFIF\0') {
      const units = b[at + 11];
      const x = u16be(b, at + 12);
      const y = u16be(b, at + 14);
      if ((units === 1 || units === 2) && x > 0 && y > 0) {
        dpiX = units === 1 ? x : Math.round(x * 2.54);
        dpiY = units === 1 ? y : Math.round(y * 2.54);
      }
    }
    // Start of frame: SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > b.length) return 'The JPEG image is truncated.';
      return { type: 'jpeg', extension: 'jpeg', contentType: 'image/jpeg', width: u16be(b, at + 7), height: u16be(b, at + 5), dpiX, dpiY };
    }
    if (marker === 0xda || marker === 0xd9) break;
    at += 2 + length;
  }
  return 'The JPEG image has no frame header.';
}

function gif(b: Uint8Array): ImageInfo | string {
  if (b.length < 10) return 'The GIF image is truncated.';
  return { type: 'gif', extension: 'gif', contentType: 'image/gif', width: u16le(b, 6), height: u16le(b, 8), dpiX: DEFAULT_DPI, dpiY: DEFAULT_DPI };
}

/** The type, size and resolution of an image, or a message saying why it cannot be used. */
export function imageInfo(b: Uint8Array): ImageInfo | string {
  let info: ImageInfo | string;
  if (starts(b, PNG)) info = png(b);
  else if (starts(b, [0xff, 0xd8, 0xff])) info = jpeg(b);
  else if (starts(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) info = gif(b);
  else return 'The image is not a PNG, JPEG or GIF file.';
  if (typeof info !== 'string' && (info.width === 0 || info.height === 0)) return 'The image has a width or height of 0 pixels.';
  return info;
}
