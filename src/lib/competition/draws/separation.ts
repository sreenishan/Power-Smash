// First-round separation (Module 4, Phase A). PURE and deterministic: no randomness here, the draw's randomness happens before.
// Used for two rules: keep two entries of one club apart in round 1 (single elimination, optional), and keep two qualifiers of
// one group apart in round 1 (groups then knockout). Method (decision): a greedy pass over the first-round matches from the top;
// a clashing match swaps one of its MOVABLE lines (never a seed, never a bye) with another movable line, preferring a swap the
// caller marks as preferred and then the lowest line, and only when the swap leaves both affected matches clean. Up to three
// passes. Whatever is still clashing is reported, never hidden. LIMITATION: greedy, so a rare list that a full search could
// separate may be reported as unresolved; the referee then moves entries by hand.

/** A first-round match that still pairs two entries with the same key. Lines are 1-based. */
export interface SeparationClash {
  lineA: number;
  lineB: number;
  key: string;
}

export interface SeparationResult<T> {
  lines: (T | null)[];
  swaps: number;
  unresolved: SeparationClash[];
}

/** Separates first-round clashes by swapping movable lines (index 0 = line 1; null = bye). */
export function separateFirstRound<T>(
  input: readonly (T | null)[],
  key: (item: T) => string | null,
  movable: (line: number) => boolean,
  preferred: (moving: T, other: T) => boolean = () => false,
): SeparationResult<T> {
  const lines = [...input];
  const clashKey = (match: number): string | null => {
    const a = lines[2 * match];
    const b = lines[2 * match + 1];
    if (a == null || b == null) return null;
    const ka = key(a);
    return ka !== null && ka === key(b) ? ka : null;
  };
  const swap = (i: number, j: number): void => {
    const t = lines[i] ?? null;
    lines[i] = lines[j] ?? null;
    lines[j] = t;
  };

  let swaps = 0;
  const matches = lines.length / 2;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let m = 0; m < matches; m++) {
      if (clashKey(m) === null) continue;
      const sides = [2 * m + 1, 2 * m].filter((i) => movable(i + 1));
      let fixed = false;
      for (const side of sides) {
        const moving = lines[side];
        if (moving == null) continue;
        const candidates: number[] = [];
        for (let j = 0; j < lines.length; j++) {
          if (j === 2 * m || j === 2 * m + 1 || lines[j] == null || !movable(j + 1)) continue;
          candidates.push(j);
        }
        candidates.sort((x, y) => {
          const px = preferred(moving, lines[x] as T) ? 0 : 1;
          const py = preferred(moving, lines[y] as T) ? 0 : 1;
          return px - py || x - y;
        });
        for (const j of candidates) {
          swap(side, j);
          if (clashKey(m) === null && clashKey(Math.floor(j / 2)) === null) {
            swaps++;
            fixed = true;
            changed = true;
            break;
          }
          swap(side, j);
        }
        if (fixed) break;
      }
    }
    if (!changed) break;
  }

  const unresolved: SeparationClash[] = [];
  for (let m = 0; m < matches; m++) {
    const k = clashKey(m);
    if (k !== null) unresolved.push({ lineA: 2 * m + 1, lineB: 2 * m + 2, key: k });
  }
  return { lines, swaps, unresolved };
}
