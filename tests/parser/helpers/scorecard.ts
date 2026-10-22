/**
 * Gold-seed scorecard (M2b, D-017 Definition of Done 1): compares parseTitle() with the gold
 * labels field by field. The labels are still `proposed` (nothing is owner-confirmed yet, OT-35),
 * so the numbers measure AGREEMENT with a first guess, not correctness. PRIVATE data: this file
 * only reads the fixtures and returns counts; it prints no title.
 */
import { canonicalPlace } from '../../../src/lib/parser/vocab';
import { normalizeName } from '../../../src/lib/parser/normalize';
import { parseTitle } from '../../../src/lib/parser';
import type { ParseResult } from '../../../src/lib/parser';
import { readFixtureJson } from './fixtures';

type GoldPlayer = { name: string };
type GoldSide = { split: string; players: GoldPlayer[] | null } | null;
type GoldLabel = {
  kind: string;
  format: string | null;
  category: string | null;
  age_group: string | null;
  round: string | null;
  tournament: string | null;
  year: number | null;
  location: string | null;
  is_international: boolean;
  side_a: GoldSide;
  side_b: GoldSide;
  teams: { a: string; b: string } | null;
};
export type GoldEntry = { index: number; title: string; label: GoldLabel; unsure: boolean; review_state: string };

export type FieldScore = {
  field: string;
  goldCount: number;
  parsedCount: number;
  agree: number;
  precision: number | null;
  recall: number | null;
};

export type Scorecard = {
  titles: number;
  fields: FieldScore[];
  kindAgreement: number;
  autoAccept: { matchAutoAccept: number; matchReview: number; matchStyleTotal: number; nonMatchTotal: number };
};

const ratio = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);

function key(name: string): string {
  return normalizeName(name) ?? name.toLowerCase();
}

function tournamentKey(name: string | null): string | null {
  if (name === null) return null;
  return key(name.replace(/\s+-\s+/gu, ' '));
}

function locationKey(name: string | null): string | null {
  if (name === null) return null;
  return canonicalPlace(name) ?? key(name);
}

export function goldEntries(): GoldEntry[] {
  return readFixtureJson<{ entries: GoldEntry[] }>('gold-seed.real70.json').entries;
}

type Acc = { gold: number; parsed: number; agree: number };

export function computeScorecard(entries: GoldEntry[] = goldEntries()): Scorecard {
  const acc = new Map<string, Acc>();
  const get = (field: string): Acc => {
    const a = acc.get(field) ?? { gold: 0, parsed: 0, agree: 0 };
    acc.set(field, a);
    return a;
  };
  const tally = (field: string, gold: unknown, parsed: unknown, equal: boolean): void => {
    const a = get(field);
    const hasGold = gold !== null && gold !== undefined;
    const hasParsed = parsed !== null && parsed !== undefined;
    if (hasGold) a.gold += 1;
    if (hasParsed) a.parsed += 1;
    if (hasGold && hasParsed && equal) a.agree += 1;
  };

  let kindAgree = 0;
  let nonMatchTotal = 0;
  let matchStyleTotal = 0;
  let matchAutoAccept = 0;
  let matchReview = 0;

  for (const entry of entries) {
    const result: ParseResult = parseTitle(entry.title);
    const gold = entry.label;
    if (gold.kind === result.kind) kindAgree += 1;
    if (result.kind === 'non_match') {
      nonMatchTotal += 1;
    } else {
      matchStyleTotal += 1;
      if (result.needsReview || result.minorHold) matchReview += 1;
      else matchAutoAccept += 1;
    }
    if (gold.kind === 'non_match' || result.kind === 'non_match') continue;

    const goldFormat = gold.format === 'unknown' ? null : gold.format;
    const parsedFormat = result.format === 'unknown' ? null : result.format;
    tally('format', goldFormat, parsedFormat, goldFormat === parsedFormat);
    tally('category', gold.category, result.category, gold.category === result.category);
    tally('age_group', gold.age_group, result.ageGroup, gold.age_group === result.ageGroup);
    tally('round', gold.round, result.round, gold.round === result.round);
    tally('year', gold.year, result.year, gold.year === result.year);
    tally('tournament', gold.tournament, result.tournamentName, tournamentKey(gold.tournament) === tournamentKey(result.tournamentName));
    tally('location', gold.location, result.locationHint, locationKey(gold.location) === locationKey(result.locationHint));
    tally('is_international', gold.is_international ? true : null, result.isInternational ? true : null, gold.is_international === result.isInternational);

    // players, per side where the gold names are decided
    for (const [goldSide, parsedSide] of [
      [gold.side_a, result.sideA],
      [gold.side_b, result.sideB],
    ] as const) {
      if (goldSide?.players == null) continue;
      const goldKeys = new Set(goldSide.players.map((p) => key(p.name)));
      const parsedKeys = parsedSide.map((p) => key(p.displayName));
      const a = get('players');
      a.gold += goldKeys.size;
      a.parsed += parsedKeys.length;
      for (const k of parsedKeys) if (goldKeys.has(k)) a.agree += 1;
    }
  }

  const fields: FieldScore[] = [...acc.entries()].map(([field, a]) => ({
    field,
    goldCount: a.gold,
    parsedCount: a.parsed,
    agree: a.agree,
    precision: ratio(a.agree, a.parsed),
    recall: ratio(a.agree, a.gold),
  }));
  return {
    titles: entries.length,
    fields,
    kindAgreement: kindAgree / entries.length,
    autoAccept: { matchAutoAccept, matchReview, matchStyleTotal, nonMatchTotal },
  };
}
