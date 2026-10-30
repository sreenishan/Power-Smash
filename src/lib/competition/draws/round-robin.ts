// Round-robin schedule (Module 4, Phase A). PURE, no randomness: the input order is the circle order, so the caller decides it.
// Circle method: with n entries (plus one "bye" slot when n is odd) there are n - 1 rounds (n when odd); entry 1 stays fixed and
// the others rotate one place each round. Every pair meets exactly once, nobody plays twice in a round, and with an odd count
// exactly one entry sits out each round (each entry exactly once). Sides A/B alternate for the fixed entry so it is not always
// side A; side order has no scoring meaning in badminton (ends and service are decided at the match, BWF Laws of Badminton).
import type { Entry, RoundCode } from '../types';
import { validateEntries, type DrawOutcome } from './validate';

export interface RoundRobinMatch {
  a: string;
  b: string;
}

export interface RoundRobinRound {
  round: number;
  matches: RoundRobinMatch[];
  /** The entry that sits out this round (odd entry counts only). */
  bye: string | null;
}

export interface RoundRobinDraw {
  /** 'league' for a whole event, 'group' inside groupsThenKnockout. */
  roundCode: RoundCode;
  rounds: RoundRobinRound[];
  matchCount: number;
}

export interface RoundRobinOptions {
  /** Default 'league'. */
  roundCode?: 'league' | 'group';
}

/** Builds the circle-method schedule, or refuses (fewer than 2 entries, duplicate ids or players, bad entries). */
export function roundRobin(entries: readonly Entry[], options: RoundRobinOptions = {}): DrawOutcome<RoundRobinDraw> {
  const refusals = validateEntries(entries, false);
  if (refusals.length > 0) return { ok: false, refusals };

  const circle: (string | null)[] = entries.map((e) => e.id);
  if (circle.length % 2 === 1) circle.push(null);
  const n = circle.length;
  const rounds: RoundRobinRound[] = [];
  let matchCount = 0;
  for (let r = 0; r < n - 1; r++) {
    const matches: RoundRobinMatch[] = [];
    let bye: string | null = null;
    for (let i = 0; i < n / 2; i++) {
      let a = circle[i] ?? null;
      let b = circle[n - 1 - i] ?? null;
      if (i === 0 && r % 2 === 1) [a, b] = [b, a];
      if (a === null || b === null) {
        bye = a ?? b;
        continue;
      }
      matches.push({ a, b });
    }
    matchCount += matches.length;
    rounds.push({ round: r + 1, matches, bye });
    // Rotate: keep index 0, move the last slot to index 1.
    const last = circle.pop() ?? null;
    circle.splice(1, 0, last);
  }
  return { ok: true, draw: { roundCode: options.roundCode ?? 'league', rounds, matchCount } };
}
