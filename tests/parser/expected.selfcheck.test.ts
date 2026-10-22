/**
 * GREEN (M0): proves the machinery behind the red tests is sound, so that a red result in
 * fixtures.red.test.ts can only mean "the parser does not exist yet".
 *
 *  1. compareParse() accepts a parse equal to the expectation and rejects tampered ones.
 *  2. expected.proposed.json is internally consistent with the integer confidence scheme, the
 *     name helpers and the age-signal rules (so the data cannot contradict the code).
 *  3. Every value in expected.proposed.json agrees with the audit's compact text in
 *     titles.proposed.json (category, round, year, age, format, tournament, review, names), which
 *     catches transcription mistakes in the conversion.
 */
import { describe, expect, it } from 'vitest';
import { computeConfidence } from '../../src/lib/parser/confidence';
import { describeName } from '../../src/lib/parser/normalize';
import { HARD_FLAGS, SOFT_FLAGS } from '../../src/lib/parser/types';
import type { HardFlag, SoftFlag } from '../../src/lib/parser/types';
import { compareParse } from './helpers/compare';
import { expectedFile, proposedFixtures } from './helpers/fixtures';
import type { ExpectedEntry } from './helpers/fixtures';

const entries = expectedFile().entries;
const compact = new Map(proposedFixtures().map((f) => [f.id, f.expected]));

type Exp = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isScored = (e: Exp): boolean => e.kind === 'match' || e.kind === 'team_tie';
const players = (e: Exp): Exp[] => [...(e.sideA ?? []), ...(e.sideB ?? [])];

describe('compareParse (the comparison machinery of the red tests)', () => {
  it('accepts every expectation compared with a copy of itself', () => {
    for (const entry of entries) {
      expect(compareParse(clone(entry.expected), entry.expected, entry.pending_fields ?? []), entry.id).toEqual([]);
    }
  });

  it('ignores keys that the expectation does not state and skips pending paths', () => {
    expect(compareParse({ kind: 'match', extra: 1 }, { kind: 'match' })).toEqual([]);
    expect(compareParse({ kind: 'match', minorHold: false }, { minorHold: true }, ['minorHold'])).toEqual([]);
    expect(compareParse({ sideA: [{ displayName: 'x' }] }, { sideA: [{ displayName: 'A' }] }, ['sideA[].displayName'])).toEqual([]);
  });

  it('reports a wrong scalar, a wrong flag set, a wrong side size and a wrong soft flag', () => {
    const entry = entries.find((e) => e.id === 'PF-051') as ExpectedEntry; // uneven sides
    const e = entry.expected as Exp;
    const wrongKind = { ...clone(e), kind: 'non_match' };
    expect(compareParse(wrongKind, e)[0]).toMatch(/^kind: expected "match", got "non_match"/u);
    const noFlag = { ...clone(e), hardFlags: [] as string[] };
    expect(compareParse(noFlag, e).join('\n')).toMatch(/hardFlags/u);
    const evenSides = { ...clone(e), sideB: [clone(e.sideB[0]), clone(e.sideB[0])] };
    expect(compareParse(evenSides, e).join('\n')).toMatch(/sideB: expected 1 item/u);
    const lessSoft = { ...clone(e), softFlags: e.softFlags.slice(1) };
    expect(compareParse(lessSoft, e).join('\n')).toMatch(/softFlags/u);
    const wrongName = clone(e);
    wrongName.sideA[0].displayName = 'Nobody';
    expect(compareParse(wrongName, e).join('\n')).toMatch(/sideA\[0\]\.displayName/u);
  });

  it('treats hardFlags as an unordered set and sideA as an ordered list', () => {
    expect(compareParse({ hardFlags: ['B', 'A'] }, { hardFlags: ['A', 'B'] })).toEqual([]);
    expect(compareParse({ sideA: [{ n: 2 }, { n: 1 }] }, { sideA: [{ n: 1 }, { n: 2 }] })).not.toEqual([]);
  });
});

describe('expected.proposed.json is consistent with the integer confidence scheme (PC-03)', () => {
  for (const entry of entries) {
    const e = entry.expected as Exp;
    if (!isScored(e)) continue;
    it(`${entry.id} points, flags and review agree with computeConfidence()`, () => {
      for (const flag of e.hardFlags as string[]) expect(HARD_FLAGS as readonly string[]).toContain(flag);
      for (const hit of e.softFlags as { flag: string }[]) expect(SOFT_FLAGS as readonly string[]).toContain(hit.flag);
      const outcome = computeConfidence({
        hard: e.hardFlags as HardFlag[],
        soft: (e.softFlags as { flag: SoftFlag; count: number }[]).map((h) => ({ flag: h.flag, count: h.count })),
      });
      expect(Number.isInteger(e.confidencePoints)).toBe(true);
      expect(e.confidencePoints).toBe(outcome.points);
      expect(e.needsReview).toBe(outcome.needsReview);
      expect(e.softFlags).toEqual(outcome.softFlags);
    });

    it(`${entry.id} soft flags follow from its own fields and names`, () => {
      const hits = new Map((e.softFlags as { flag: string; count: number }[]).map((h) => [h.flag, h.count]));
      expect(hits.has('NO_TOURNAMENT'), 'NO_TOURNAMENT').toBe(e.tournamentName === null);
      expect(hits.has('NO_CATEGORY'), 'NO_CATEGORY').toBe(e.category === null);
      expect(hits.has('NO_ROUND'), 'NO_ROUND').toBe(e.round === null);
      expect(hits.has('NO_YEAR'), 'NO_YEAR').toBe(e.year === null);
      const singles = players(e).filter((p) => p.identityTier === 'single_token').length;
      expect(hits.get('SINGLE_TOKEN_NAME') ?? 0, 'SINGLE_TOKEN_NAME').toBe(singles);
      const short = players(e).some((p) => describeName(p.displayName).nameLength < 2);
      expect(hits.has('SHORT_NAME'), 'SHORT_NAME').toBe(short);
    });
  }
});

describe('expected.proposed.json player fields agree with the name helpers', () => {
  for (const entry of entries) {
    const e = entry.expected as Exp;
    players(e).forEach((p, i) => {
      it(`${entry.id} player ${i} (${p.displayName})`, () => {
        const info = describeName(p.displayName);
        expect(p.nameNormalized).toBe(info.nameNormalized);
        expect(p.nameKey).toBe(info.nameKey);
        expect(p.latinKey).toBe(info.latinKey);
        expect(p.identityTier).toBe(info.identityTier);
        expect(p.nameNormalized, 'a name key must never be empty').not.toBe('');
        expect(p.nameNormalized).not.toBeNull();
      });
    });
  }
});

describe('expected.proposed.json age and entity rules', () => {
  for (const entry of entries) {
    const e = entry.expected as Exp;
    if (!isScored(e)) continue;
    it(`${entry.id} minor signal rules (D-012): parser never emits a confirmed status`, () => {
      expect(e.minorHold).toBe((e.ageSignals as string[]).length > 0);
      for (const p of players(e)) {
        expect(['adult_confirmed', 'minor_confirmed']).not.toContain(p.ageStatus);
        if (e.minorHold && !(entry.pending_fields ?? []).includes('sideA[].ageStatus')) expect(p.ageStatus).toBe('minor_suspected');
      }
      if (e.ageGroup === 'U21') expect(e.ageSignals).toEqual([]);
      if (['BS', 'GS', 'BD', 'GD'].includes(e.category)) expect(e.ageSignals).toContain(`junior_category:${e.category}`);
    });
  }

  it('international and ambiguous-VS entries block entity creation', () => {
    for (const entry of entries) {
      const e = entry.expected as Exp;
      if (e.isInternational === true) expect(e.entityCreation, entry.id).toBe('blocked');
      if ((e.hardFlags ?? []).includes('AMBIGUOUS_VS')) expect(e.entityCreation, entry.id).toBe('blocked');
      if (e.kind === 'non_match') {
        expect(e.entityCreation, entry.id).toBe('blocked');
        expect(e.nonMatchReason, entry.id).not.toBeNull();
      }
    }
  });

  it('relations point at existing fixtures', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const entry of entries) for (const r of entry.relations ?? []) expect(ids.has(r.with), `${entry.id} -> ${r.with}`).toBe(true);
  });
});

/** Compare the converted values with the audit's compact text, field by field. */
describe('expected.proposed.json agrees with the audit text in titles.proposed.json', () => {
  const ageName = (token: string): string | null => {
    if (token === 'null') return null;
    if (token === 'Senior') return 'senior';
    if (token === 'Open') return 'open';
    return token;
  };
  for (const entry of entries) {
    const text = compact.get(entry.id) as string;
    const e = entry.expected as Exp;
    const pend = new Set(entry.pending_fields ?? []);
    if (pend.has('*')) continue;
    it(`${entry.id}`, () => {
      const field = (key: string): string | undefined => new RegExp(`(?:^|\\|)${key}=([^|]*)`, 'u').exec(text)?.[1]?.trim();

      const cat = field('cat');
      if (cat !== undefined && /^(null|[A-Z]{2})$/u.test(cat)) expect(e.category, 'category').toBe(cat === 'null' ? null : cat);
      const rd = field('rd');
      if (rd !== undefined && /^(null|[A-Za-z0-9]+)$/u.test(rd)) expect(e.round, 'round').toBe(rd === 'null' ? null : rd);
      const yr = field('yr');
      if (yr !== undefined && /^(null|\d{4})$/u.test(yr)) expect(e.year, 'year').toBe(yr === 'null' ? null : Number(yr));
      const age = field('age');
      if (age !== undefined && !pend.has('ageSignals')) {
        const want = age === 'null' ? null : age === '35+' ? '35+' : ageName(age);
        expect(e.ageGroup, 'ageGroup').toBe(want);
      }
      const intl = /intl=(true|false)/u.exec(text)?.[1];
      if (intl !== undefined && !pend.has('isInternational')) expect(e.isInternational, 'isInternational').toBe(intl === 'true');
      const tour = /tour='([^']*)'/u.exec(text)?.[1];
      if (tour !== undefined && !/not matched|truncated/u.test(text.slice(text.indexOf('tour=')))) {
        // lower-case titles in the audit text are display-cased by the parser
        expect(String(e.tournamentName).toLowerCase(), 'tournamentName').toBe(tour.toLowerCase());
      }
      if (/\|tour=null/u.test(text)) expect(e.tournamentName, 'tournamentName').toBeNull();
      const format = /^(?:match\(candidate\)|match|team_tie|non_match)?\|?(singles|doubles)\|/u.exec(text)?.[1] ?? /format=(singles|doubles|unknown)/u.exec(text)?.[1];
      if (format !== undefined) expect(e.format, 'format').toBe(format);
      if (/^non_match/u.test(text)) expect(e.kind).toBe('non_match');
      if (/^team_tie/u.test(text)) expect(e.kind).toBe('team_tie');

      // 'review=Y or N per policy' is a judgement call in the audit and is deliberately not matched here
      const review = /review=(Y|N)(?=\(|\||$)/u.exec(text)?.[1];
      if (review !== undefined && isScored(e)) expect(e.needsReview, 'needsReview as stated by the audit').toBe(review === 'Y');
      const listed = /review=Y\(([^)]*)\)/u.exec(text)?.[1] ?? '';
      for (const token of listed.split(/;\s*/u)) {
        const flag = token.trim().split(' ')[0] as string;
        if ((HARD_FLAGS as readonly string[]).includes(flag)) expect(e.hardFlags, `audit lists ${flag}`).toContain(flag);
        else if ((SOFT_FLAGS as readonly string[]).includes(flag)) {
          expect((e.softFlags as { flag: string }[]).map((h) => h.flag), `audit lists ${flag}`).toContain(flag);
        }
      }

      for (const [side, key] of [['A', 'sideA'], ['B', 'sideB']] as const) {
        const m = new RegExp(`(?:^|\\|)${side}=\\[([^\\]]*)\\]`, 'u').exec(text);
        if (!m || m[1]?.includes("'") || pend.has(`${key}[].displayName`)) continue;
        const want = (m[1] as string).split(';').map((s) => s.trim().replace(/\s+(seed|country|districtHint|affiliationHint)=.*$/u, ''));
        expect(players(e).length > 0 ? (e[key] as Exp[]).map((p) => p.displayName) : [], `${side} display names`).toEqual(want);
      }
    });
  }
});
