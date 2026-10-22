/**
 * Subset comparison of a parse result against an expected-parse object.
 *
 * - A key that is absent in `expected` is NOT asserted (expected files are partial on purpose).
 * - Objects: every expected key is compared recursively.
 * - `hardFlags`, `ageSignals`, `signals`: compared as sorted sets.
 * - `softFlags`: compared as flag -> count (and points when the expectation states them); no extras.
 * - Every other array: same length, element by element (so sideA / sideB order matters).
 * - `pending` lists paths to skip, written without indexes: 'minorHold', 'sideA[].displayName'.
 *
 * Returns the list of mismatches; an empty list means a match.
 */
const SET_LIKE_KEYS = new Set(['hardFlags', 'ageSignals', 'signals']);

function show(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function lastKey(path: string): string {
  const match = /([A-Za-z0-9_]+)(?:\[\d*\])?$/u.exec(path);
  return match ? (match[1] as string) : path;
}

function isPending(path: string, pending: ReadonlySet<string>): boolean {
  return pending.has(path.replace(/\[\d+\]/gu, '[]'));
}

function walk(actual: unknown, expected: unknown, path: string, pending: ReadonlySet<string>, out: string[]): void {
  if (isPending(path, pending)) return;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      out.push(`${path}: expected an array ${show(expected)}, got ${show(actual)}`);
      return;
    }
    const key = lastKey(path);
    if (SET_LIKE_KEYS.has(key)) {
      const a = [...actual].map(String).sort();
      const e = [...expected].map(String).sort();
      if (JSON.stringify(a) !== JSON.stringify(e)) out.push(`${path}: expected set ${show(e)}, got ${show(a)}`);
      return;
    }
    if (key === 'softFlags') {
      const got = new Map<string, { count: number; points?: number }>();
      for (const hit of actual as { flag: string; count: number; points?: number }[]) got.set(hit.flag, hit);
      const want = expected as { flag: string; count: number; points?: number }[];
      for (const w of want) {
        const g = got.get(w.flag);
        if (!g) out.push(`${path}: missing soft flag ${w.flag}`);
        else if (g.count !== w.count) out.push(`${path}.${w.flag}.count: expected ${w.count}, got ${g.count}`);
        else if (w.points !== undefined && g.points !== w.points) out.push(`${path}.${w.flag}.points: expected ${w.points}, got ${g.points}`);
      }
      for (const flag of got.keys()) {
        if (!want.some((w) => w.flag === flag)) out.push(`${path}: unexpected soft flag ${flag}`);
      }
      return;
    }
    if (actual.length !== expected.length) {
      out.push(`${path}: expected ${expected.length} item(s), got ${actual.length} (${show(actual)})`);
      return;
    }
    expected.forEach((item, i) => walk(actual[i], item, `${path}[${i}]`, pending, out));
    return;
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      out.push(`${path}: expected an object ${show(expected)}, got ${show(actual)}`);
      return;
    }
    for (const key of Object.keys(expected)) {
      walk((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`, pending, out);
    }
    return;
  }

  if (!Object.is(actual, expected)) out.push(`${path}: expected ${show(expected)}, got ${show(actual)}`);
}

export function compareParse(actual: unknown, expected: Record<string, unknown>, pending: readonly string[] = []): string[] {
  const out: string[] = [];
  walk(actual, expected, '', new Set(pending), out);
  return out;
}
