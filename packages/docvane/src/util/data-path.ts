// Paths in the data of a rendering, as validate and the errors of data report them (D-047).

/** A path in the data: names of fields and indexes of list items. */
export type DataPath = readonly (string | number)[];

/** A data path as JSON Pointer (RFC 6901): `/items/1/name`. */
export function pointerOf(path: DataPath): string {
  return path.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** A data path as people write it: `items[1].name`. */
export function dataPathOf(path: DataPath): string {
  let out = '';
  for (const p of path) out += typeof p === 'number' ? `[${String(p)}]` : out === '' ? p : `.${p}`;
  return out;
}
