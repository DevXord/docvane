// Reading the type, size and resolution of PNG, JPEG and GIF images from their headers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { imageInfo } from '../../packages/docvane/src/media/image-info';
import { NUM_RUNS } from '../fuzz/runs';
import { gif, jpegHeader, png } from '../helpers/images';

describe('imageInfo', () => {
  it('reads PNG size and resolution', () => {
    expect(imageInfo(png(4, 2))).toMatchObject({ type: 'png', extension: 'png', contentType: 'image/png', width: 4, height: 2, dpiX: 96, dpiY: 96 });
    expect(imageInfo(png(3, 3, 300))).toMatchObject({ width: 3, height: 3, dpiX: 300, dpiY: 300 });
  });

  it('reads JPEG size and JFIF density', () => {
    expect(imageInfo(jpegHeader(640, 480, 72))).toMatchObject({ type: 'jpeg', extension: 'jpeg', contentType: 'image/jpeg', width: 640, height: 480, dpiX: 72, dpiY: 72 });
  });

  it('reads GIF size', () => {
    expect(imageInfo(gif(7, 5))).toMatchObject({ type: 'gif', width: 7, height: 5, dpiX: 96 });
  });

  it('refuses other formats and damaged headers with a message', () => {
    for (const bytes of [new Uint8Array([1, 2, 3]), new TextEncoder().encode('<svg/>'), png(1, 1).slice(0, 20), jpegHeader(0, 10), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]), gif(0, 4)]) {
      expect(typeof imageInfo(bytes)).toBe('string');
    }
  });

  it('never throws on any bytes, also behind a valid signature', () => {
    const signatures = [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], []];
    fc.assert(
      fc.property(fc.constantFrom(...signatures), fc.uint8Array({ maxLength: 200 }), (sig, rest) => {
        const info = imageInfo(new Uint8Array([...sig, ...rest]));
        if (typeof info !== 'string') expect(info.width * info.height).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
