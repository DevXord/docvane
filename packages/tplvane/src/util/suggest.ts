// Copied from DevXord/xlvane packages/xlvane/src/util/suggest.ts at aeaefbc (unchanged since
// ada547b), unchanged.

/** Names longer than this are never compared, which keeps the cost bounded on hostile input. */
const MAX_COMPARED_LENGTH = 256;

/**
 * Returns the candidates that are close to `input` ("Did you mean ...?"), best match first.
 * Comparison ignores case and uses the optimal string alignment distance (Levenshtein plus
 * transpositions); a candidate matches when the distance is at most a third of the longer name.
 */
export function suggest(input: string, candidates: readonly string[], max = 3): string[] {
  const needle = input.toLowerCase();
  const scored: { name: string; distance: number; order: number }[] = [];
  candidates.forEach((name, order) => {
    const hay = name.toLowerCase();
    if (needle === hay) {
      scored.push({ name, distance: 0, order });
      return;
    }
    if (needle.length > MAX_COMPARED_LENGTH || hay.length > MAX_COMPARED_LENGTH) return;
    const threshold = Math.max(1, Math.floor(Math.max(needle.length, hay.length) / 3));
    if (Math.abs(needle.length - hay.length) > threshold) return;
    const distance = osaDistance(needle, hay);
    if (distance <= threshold) scored.push({ name, distance, order });
  });
  scored.sort((a, b) => a.distance - b.distance || a.order - b.order);
  return scored.slice(0, max).map((s) => s.name);
}

function osaDistance(a: string, b: string): number {
  // Three rolling rows: two previous rows are needed for the transposition step.
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prev2[j - 2] ?? 0) + 1);
      }
      row.push(value);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[b.length] ?? 0;
}
