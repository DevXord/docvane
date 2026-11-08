// Small images built byte by byte for tests: valid PNG and GIF files that LibreOffice opens, and a
// JPEG header with the fields tplvane reads (not a decodable image).
import { crc32, deflateSync } from 'node:zlib';

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function chunk(type: string, data: readonly number[]): number[] {
  const body = [...ascii(type), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(new Uint8Array(body)) >>> 0)];
}

/** A red PNG of `width` × `height` pixels, with a pHYs chunk when `dpi` is given. */
export function png(width: number, height: number, dpi?: number): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) raw.push(255, 0, 0);
  }
  const ppm = dpi === undefined ? 0 : Math.round(dpi / 0.0254);
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
    ...(dpi === undefined ? [] : chunk('pHYs', [...u32(ppm), ...u32(ppm), 1])),
    ...chunk('IDAT', [...deflateSync(new Uint8Array(raw))]),
    ...chunk('IEND', []),
  ]);
}

/** A 1 × 1 GIF89a, widened in its header to `width` × `height` for size tests. */
export function gif(width = 1, height = 1): Uint8Array {
  return new Uint8Array([
    ...ascii('GIF89a'), width & 255, width >> 8, height & 255, height >> 8, 0x80, 0, 0,
    0, 0, 0, 255, 255, 255,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);
}

/** The start of a JPEG with JFIF density and a baseline frame header of `width` × `height`. */
export function jpegHeader(width: number, height: number, dpi = 72): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
}

/** A data URL of bytes. */
export function dataUrl(bytes: Uint8Array, type = 'image/png'): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${type};base64,${btoa(binary)}`;
}
