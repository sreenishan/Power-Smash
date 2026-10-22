/**
 * GREEN (M0): structure of the PROPOSED gold seed (tests/fixtures/gold-seed.real70.json).
 * The labels are Claude's proposals until the owner spot-checks them (OT-35), so nothing here
 * compares the parser with them; this only keeps the file well-formed and aligned with
 * real-titles.raw.json so it can grow to 150-200 titles after the API backfill.
 */
import { describe, expect, it } from 'vitest';
import { readFixtureJson, realTitles } from './helpers/fixtures';

type Side = { raw: string; split: 'clear' | 'inferred' | 'ambiguous'; players: { name: string }[] | null; plausible_readings?: string[][] };
type GoldEntry = {
  index: number;
  title: string;
  label: {
    kind: 'match' | 'non_match' | 'team_tie';
    non_match_reason: string | null;
    format: 'singles' | 'doubles' | 'unknown' | null;
    side_a: Side | null;
    side_b: Side | null;
    category: string | null;
    age_group: string | null;
    minor_signal_in_title: boolean;
    round: string | null;
    tournament: string | null;
    year: number | null;
    is_international: boolean;
    teams: { a: string; b: string } | null;
  };
  confidence_of_label: 'high' | 'medium' | 'low';
  unsure: boolean;
  unsure_fields: string[];
  unsure_reasons: string[];
  risk_tags: string[];
  review_state: string;
};
type GoldFile = { schema_version: number; status: string; entries: GoldEntry[] };

const gold = readFixtureJson<GoldFile>('gold-seed.real70.json');
const real = realTitles();
const CATEGORIES = ['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD'];
const ROUNDS = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', '3P', 'league', 'group'];

describe('gold-seed.real70.json (proposed labels)', () => {
  it('is marked as proposed, not as ground truth', () => {
    expect(gold.status).toMatch(/PROPOSED/u);
    for (const entry of gold.entries) expect(entry.review_state, `#${entry.index}`).toBe('proposed');
  });

  it('has exactly 70 entries that map by position to real-titles.raw.json', () => {
    expect(gold.entries).toHaveLength(70);
    gold.entries.forEach((entry, i) => {
      expect(entry.index).toBe(i);
      expect(entry.title, `#${i} title drifted from real-titles.raw.json`).toBe(real[i]);
    });
  });

  it('uses only known vocabulary', () => {
    for (const { index, label } of gold.entries) {
      expect(['match', 'non_match', 'team_tie'], `#${index} kind`).toContain(label.kind);
      if (label.category !== null) expect(CATEGORIES, `#${index} category`).toContain(label.category);
      if (label.round !== null) expect(ROUNDS, `#${index} round`).toContain(label.round);
      if (label.year !== null) expect(Number.isInteger(label.year) && label.year >= 1900 && label.year <= 2099, `#${index} year`).toBe(true);
      expect(typeof label.is_international, `#${index}`).toBe('boolean');
    }
  });

  it('labels every title without a minor signal (no under-age token occurs in these 70 titles)', () => {
    for (const { index, label } of gold.entries) {
      expect(label.minor_signal_in_title, `#${index}`).toBe(false);
      expect(['BS', 'GS', 'BD', 'GD'], `#${index} junior category`).not.toContain(label.category);
    }
  });

  it('non-matches carry a reason, no players and no format; matches have both sides', () => {
    for (const { index, label } of gold.entries) {
      if (label.kind === 'non_match') {
        expect(label.non_match_reason, `#${index}`).not.toBeNull();
        expect(label.side_a, `#${index}`).toBeNull();
        expect(label.side_b, `#${index}`).toBeNull();
        expect(label.format, `#${index}`).toBeNull();
      } else {
        expect(label.non_match_reason, `#${index}`).toBeNull();
        expect(label.side_a, `#${index}`).not.toBeNull();
        expect(label.side_b, `#${index}`).not.toBeNull();
        expect(['singles', 'doubles', 'unknown'], `#${index} format`).toContain(label.format);
      }
      if (label.kind === 'team_tie') expect(label.teams, `#${index}`).not.toBeNull();
    }
  });

  it('an ambiguous side has no players but lists its plausible readings; a clear or inferred side has players', () => {
    for (const { index, label } of gold.entries) {
      for (const side of [label.side_a, label.side_b]) {
        if (side === null) continue;
        if (side.split === 'ambiguous') {
          expect(side.players, `#${index}`).toBeNull();
          expect(side.plausible_readings?.length ?? 0, `#${index} needs plausible_readings`).toBeGreaterThan(1);
        } else if (label.kind === 'match') {
          expect(side.players?.length ?? 0, `#${index}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('a stated format agrees with the player counts it can see', () => {
    for (const { index, label } of gold.entries) {
      if (label.kind !== 'match') continue;
      const a = label.side_a?.players?.length;
      const b = label.side_b?.players?.length;
      if (a === undefined || b === undefined) continue;
      if (label.format === 'singles') expect([a, b], `#${index}`).toEqual([1, 1]);
      if (label.format === 'doubles') expect([a, b], `#${index}`).toEqual([2, 2]);
    }
  });

  it('every ambiguity is marked: unsure matches unsure_fields, low confidence is always unsure, and reasons are given', () => {
    for (const entry of gold.entries) {
      expect(entry.unsure, `#${entry.index}`).toBe(entry.unsure_fields.length > 0);
      if (entry.confidence_of_label === 'low') expect(entry.unsure, `#${entry.index} low confidence must be unsure`).toBe(true);
      if (entry.unsure) expect(entry.unsure_reasons.length, `#${entry.index} needs a reason`).toBeGreaterThan(0);
      if (entry.label.kind === 'match') {
        const hasAmbiguousSide = [entry.label.side_a, entry.label.side_b].some((s) => s?.split === 'ambiguous');
        if (hasAmbiguousSide) expect(entry.unsure, `#${entry.index} ambiguous split must be unsure`).toBe(true);
      }
    }
  });

  it('never infers a category from names: no category unless the title has an explicit token', () => {
    for (const { index, title, label } of gold.entries) {
      if (label.category === null) continue;
      expect(title, `#${index}`).toMatch(/\b(MS|WS|MD|WD|XD|men'?s|mixed|doubles|singles)\b/iu);
    }
  });
});
