// Minimum-cost assignment (Module 4, Phase A). PURE and deterministic: the Hungarian method (Kuhn-Munkres, O(n^3)) on a square
// cost matrix. Used by groups-knockout.ts to place each group's lower finishers as far as possible from their group mates.
// Costs must be finite and small enough that sums stay exact in a double (below 2^53); the caller keeps them integers.

function at(values: readonly number[], i: number): number {
  return values[i] ?? 0;
}

/** For a square `cost` matrix (rows x columns), the column given to each row so that the total cost is lowest. */
export function minCostAssignment(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0); // p[j] = row (1-based) holding column j; 0 = none
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = at(p, j0);
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j] === true) continue;
        const cur = (cost[i0 - 1]?.[j - 1] ?? 0) - at(u, i0) - at(v, j);
        if (cur < at(minv, j)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (at(minv, j) < delta) {
          delta = at(minv, j);
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j] === true) {
          const row = at(p, j);
          u[row] = at(u, row) + delta;
          v[j] = at(v, j) - delta;
        } else {
          minv[j] = at(minv, j) - delta;
        }
      }
      j0 = j1;
    } while (at(p, j0) !== 0);
    do {
      const j1 = at(way, j0);
      p[j0] = at(p, j1);
      j0 = j1;
    } while (j0 !== 0);
  }
  const rowToColumn = new Array<number>(n).fill(0);
  for (let j = 1; j <= n; j++) rowToColumn[at(p, j) - 1] = j - 1;
  return rowToColumn;
}
