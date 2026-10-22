/** Seeded, stratified gold-sample draw (OT-35): the owner labels these titles by hand; the parser's guess is shown beside each. */
import type { Row } from './analyse';
import { seededRandom, shuffle } from './stats';

export type GoldEntry = { n: number; id: string | null; stratum: string; title: string; parserKind: string; parserNeedsReview: string };

/**
 * Proportional allocation across strata with at least one title per non-empty stratum (so rare strata such as international
 * or live are checked too), largest-remainder rounding, then a seeded shuffle inside each stratum. Same input + same seed =
 * same sample.
 */
export function drawGoldSample(rows: readonly Row[], size: number, seed: number): GoldEntry[] {
  const strata = new Map<string, Row[]>();
  for (const r of rows) strata.set(r.stratum, [...(strata.get(r.stratum) ?? []), r]);
  const names = [...strata.keys()].sort();
  const total = rows.length;
  const want = Math.max(0, Math.min(Math.floor(size), total));
  if (want === 0) return [];
  const alloc = new Map<string, number>();
  const rem: { name: string; frac: number }[] = [];
  let used = 0;
  for (const name of names) {
    const count = (strata.get(name) as Row[]).length;
    const exact = (count * want) / total;
    const base = Math.min(count, Math.max(want >= names.length ? 1 : 0, Math.floor(exact)));
    alloc.set(name, base);
    used += base;
    rem.push({ name, frac: exact - Math.floor(exact) });
  }
  rem.sort((a, b) => b.frac - a.frac || (a.name < b.name ? -1 : 1));
  for (let guard = 0; used < want && guard < 10 * total; guard++) {
    for (const { name } of rem) {
      if (used >= want) break;
      if ((alloc.get(name) as number) < (strata.get(name) as Row[]).length) {
        alloc.set(name, (alloc.get(name) as number) + 1);
        used++;
      }
    }
  }
  // the one-per-stratum minimum can overshoot: trim from the biggest strata
  while (used > want) {
    const biggest = [...alloc.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
    alloc.set(biggest[0], biggest[1] - 1);
    used--;
  }
  const rand = seededRandom(seed);
  const picked: Row[] = [];
  for (const name of names) picked.push(...shuffle(strata.get(name) as Row[], rand).slice(0, alloc.get(name) as number));
  return shuffle(picked, rand).map((r, i) => ({
    n: i + 1,
    id: r.item.id,
    stratum: r.stratum,
    title: r.item.title,
    parserKind: r.parse === null ? 'error' : r.parse.kind,
    parserNeedsReview: r.parse === null ? '' : r.parse.needsReview || r.parse.minorHold ? 'yes' : 'no',
  }));
}

const csvCell = (v: string | number): string => (/[",\r\n]/u.test(String(v)) ? `"${String(v).replace(/"/gu, '""')}"` : String(v));

/** Label sheet. The "owner_*" columns are left empty for the owner (and are never filled in by the tool). */
export function goldToCsv(entries: readonly GoldEntry[]): string {
  const head = ['n', 'video_id', 'stratum', 'title', 'parser_kind', 'parser_held', 'owner_kind', 'owner_side_a', 'owner_side_b', 'owner_tournament', 'owner_year', 'owner_category', 'owner_round', 'owner_age_group', 'owner_notes'];
  const lines = [head.join(',')];
  for (const e of entries) lines.push([e.n, e.id ?? '', e.stratum, e.title, e.parserKind, e.parserNeedsReview, '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
