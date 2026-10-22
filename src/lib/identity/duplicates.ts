// Possible-duplicate detection (PC-02, PC-11). PURE. Suggests pairs; it NEVER merges.
import { latinKey, nameKey } from '../parser/normalize';
import { isMinorStatus } from './status';
import type { IdPlayer } from './types';

export function editDistance(a: string, b: string, cutoff = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cutoff) return cutoff + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export interface DuplicatePair {
  aId: string;
  bId: string;
  distance: number;
  reason: 'same_name_key' | 'close_spelling';
  /** Single-token names (one word, such as a first name) match dozens of people: shown, but flagged weak. */
  strength: 'strong' | 'weak';
  /** True when a minor status meets adult_confirmed: merging needs a logged override. */
  needsOverride: boolean;
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function findPossibleDuplicates(
  players: readonly IdPlayer[],
  options: {
    dismissed?: readonly string[];
    maxPairs?: number;
    /** 'first_letter' compares only names that start with the same letter: far fewer pairs (Worker CPU budget). Default: all pairs. */
    blockBy?: 'none' | 'first_letter';
  } = {},
): DuplicatePair[] {
  const dismissed = new Set(options.dismissed ?? []);
  const live = players.filter((p) => p.mergedInto === null);
  const keyed = live.map((p) => ({ p, nk: p.nameKey ?? nameKey(p.displayName), lk: p.latinKey ?? latinKey(p.displayName) }));
  const out: DuplicatePair[] = [];
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const a = keyed[i]!;
      const b = keyed[j]!;
      if (dismissed.has(pairKey(a.p.id, b.p.id))) continue;
      if (options.blockBy === 'first_letter' && (a.lk ?? a.nk ?? '').charAt(0) !== (b.lk ?? b.nk ?? '').charAt(0)) continue;
      let distance = Infinity;
      let reason: DuplicatePair['reason'] = 'close_spelling';
      if (a.nk !== null && a.nk === b.nk) {
        distance = 0;
        reason = 'same_name_key';
      } else if (a.lk !== null && b.lk !== null) {
        const limit = Math.min(a.lk.length, b.lk.length) <= 6 ? 1 : 2;
        const d = editDistance(a.lk, b.lk, limit);
        if (d <= limit) distance = d;
      }
      if (distance === Infinity) continue;
      const base = (a.nk ?? a.lk ?? '').split('|')[0]!.trim();
      out.push({
        aId: a.p.id,
        bId: b.p.id,
        distance,
        reason,
        strength: base.includes(' ') ? 'strong' : 'weak',
        needsOverride:
          (isMinorStatus(a.p.ageStatus) && b.p.ageStatus === 'adult_confirmed') ||
          (isMinorStatus(b.p.ageStatus) && a.p.ageStatus === 'adult_confirmed'),
      });
    }
  }
  out.sort(
    (x, y) =>
      (x.strength === y.strength ? x.distance - y.distance : x.strength === 'strong' ? -1 : 1) ||
      pairKey(x.aId, x.bId).localeCompare(pairKey(y.aId, y.bId)),
  );
  return options.maxPairs ? out.slice(0, options.maxPairs) : out;
}
