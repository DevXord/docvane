// Copied from DevXord/xlvane packages/xlvane/src/zip/crc32.ts at aeaefbc (unchanged since ada547b),
// unchanged. Z-17 and W-11 below refer to the notes of xlvane.
//
// CRC-32 as used by ZIP: table-driven, reflected polynomial 0xEDB88320, pre- and
// post-conditioned with all ones (RFC 1952 §8 sample code; APPNOTE 4.4.7; Z-17, W-11).
const TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Computes the CRC-32 of `data`, continuing from `crc` (the result of a previous call). */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = (TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
