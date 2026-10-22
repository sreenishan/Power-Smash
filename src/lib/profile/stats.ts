/** Small pure helpers for the catalogue profiler: Wilson interval, seeded random, edit distance, histograms. */

/** Wilson score interval for a proportion (default 95%, z = 1.96). Returns fractions 0..1; n = 0 gives null. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number; point: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), point: p };
}

/** mulberry32: a tiny seeded generator, so a gold sample can be drawn again. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Levenshtein distance with an early exit: returns max + 1 when the distance is above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return Math.min(prev[b.length] as number, max + 1);
}

/** Count occurrences: returns [key, count] pairs, biggest first (ties by key, so output is stable). */
export function ranked(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

export function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export const pct = (part: number, whole: number): string => (whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`);
