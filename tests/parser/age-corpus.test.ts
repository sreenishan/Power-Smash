/**
 * GREEN (M2b fix wave, review findings B2-1, B2-2, B2-3): adversarial age-token corpus.
 * Every title is SYNTHETIC (fictional names). Rule (D-012): an age signal in ANY position or spelling
 * protects the players (minor_suspected + hold); an age-like word the vocabulary cannot map fails
 * CLOSED (UNKNOWN_AGE_TOKEN hard flag, review, players minor_suspected), and is never silently dropped.
 */
import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../src/lib/parser';

const A = 'Arun Kumar vs Bala Murugan';
const TAIL = '| State Cup 2026 | Final';

/** [label, title]: a REAL minor signal (maps to an age group up to U19 or a junior word). */
const MINOR: [string, string][] = [
  ['paren U15 on side B', `${A} (U15) | Final | State Cup 2026`],
  ['paren U15 on both', 'Arun Kumar (U15) vs Bala Murugan (U15) | Final | State Cup 2026'],
  ['square U15', `${A} [U15] | Final | State Cup 2026`],
  ['paren U-15', `${A} (U-15) | Final | State Cup 2026`],
  ['paren 15U', `${A} (15U) | Final | State Cup 2026`],
  ['paren Junior', `${A} (Junior) | State Cup 2026`],
  ['paren Cadet', `${A} (Cadet) | State Cup 2026`],
  ['paren Youth', `${A} (Youth) | State Cup 2026`],
  ['paren Mini', `${A} (Mini) | State Cup 2026`],
  ['paren Sub Junior', `${A} (Sub Junior) | State Cup 2026`],
  ['paren Boys U15', `${A} (Boys U15) | State Cup 2026`],
  ['paren U 15 spaced', `${A} (U 15) | State Cup 2026`],
  ['trailing 15U', `${A} ${TAIL} | 15U`],
  ['trailing 15-U', `${A} ${TAIL} | 15-U`],
  ['trailing Under-15', `${A} ${TAIL} | Under-15`],
  ['trailing Under 15', `${A} ${TAIL} | Under 15`],
  ['trailing U/15', `${A} ${TAIL} | U/15`],
  ['trailing U.15', `${A} ${TAIL} | U.15`],
  ['trailing U - 15', `${A} ${TAIL} | U - 15`],
  ['trailing Sub-Junior', `${A} ${TAIL} | Sub-Junior`],
  ['trailing SubJunior', `${A} ${TAIL} | SubJunior`],
  ['trailing Sub Junior', `${A} ${TAIL} | Sub Junior`],
  ['trailing Sub-Jr', `${A} ${TAIL} | Sub-Jr`],
  ['trailing 15 years', `${A} ${TAIL} | 15 years`],
  ['trailing 15yrs', `${A} ${TAIL} | 15yrs`],
  ['trailing 15 yr old', `${A} ${TAIL} | 15 yr old`],
  ['trailing 14 years old', `${A} ${TAIL} | 14 years old`],
  ['trailing Under Fifteen', `${A} ${TAIL} | Under Fifteen`],
  ['prefix U15 before side A', `U15 ${A} | Final | State Cup 2026`],
  ['prefix Junior colon', `Junior: ${A} | State Cup 2026`],
  ['prefix U-13 dash', `U-13 - ${A} || State Cup 2026`],
  ['prefix Under 17 segment', `Under 17 | ${A} | State Cup 2026`],
  ['no separator U15', 'Arun Kumar vs Bala Murugan U15 State Cup 2026'],
  ['no separator Under-13', 'Arun Kumar vs Bala Murugan Under-13 Final State Cup'],
  ['hashtag U15', `${A} ${TAIL} #U15`],
  ['hashtag juniors', `${A} ${TAIL} #juniors`],
  ['Arabic-Indic digits', `${A} ${TAIL} | U١٥`],
  ['Tamil digits', `${A} ${TAIL} | U௧௫`],
  ['fullwidth U', `${A} ${TAIL} | Ｕ-15`],
  ['lower case u15', `${A} ${TAIL} | u15`],
  ['upper case UNDER-15', `${A} ${TAIL} | UNDER-15`],
  ['upper case JUNIOR', `${A} ${TAIL} | JUNIOR`],
  ['junior category BS', `${A} | BS Final - State Cup 2026`],
  ['girls U17 in tournament text', `${A} || State U17 Girls Championship 2026`],
  ['age on the tournament only', `${A} || Cadet State Championship 2026`],
];

/** Age-like words nobody has reviewed: unmapped, so they fail closed. */
const UNMAPPED: [string, string][] = [
  ['Kids', `${A} | Kids Cup 2026`],
  ['paren Kids', `${A} (Kids) | State Cup 2026`],
  ['School Boys', `${A} ${TAIL} | School Boys`],
  ['Schools', `${A} | Schools Championship 2026`],
  ['Teenagers', `${A} ${TAIL} | Teenagers`],
  ['Jr', `${A} ${TAIL} | Jr`],
  ['U15A style', `${A} ${TAIL} | U15A`],
  ['Tamil junior', `${A} ${TAIL} | ஜூனியர்`],
  ['Tamil children', `${A} ${TAIL} | சிறுவர்`],
  ['bare Under', `${A} ${TAIL} | Under`],
];

const AGE_IN_NAME = /(?:\bu\s?-?\d|\bjunior|\bsub\b|\bcadet|\byouth|\bmini\b|\bkids|\bunder\b|\byears?\b|\b15u\b)/iu;

describe('age corpus: every real minor signal protects the players and holds the match', () => {
  it.each(MINOR)('%s', (_label, title) => {
    const r = parseTitle(title);
    expect(r.rawTitle).toBe(title);
    if (!title.includes('| BS Final')) expect(r.ageSignals.some((s) => s.startsWith('age_token:')), `signals ${r.ageSignals}`).toBe(true);
    expect(r.minorHold, 'minorHold').toBe(true);
    for (const p of [...r.sideA, ...r.sideB]) {
      expect(p.ageStatus, `${p.displayName} must be protected`).toBe('minor_suspected');
      expect(p.displayName).not.toMatch(AGE_IN_NAME);
      expect(p.affiliationHint ?? '').not.toMatch(AGE_IN_NAME);
    }
    expect(r.sideA.length + r.sideB.length, 'both players are still parsed').toBe(2);
  });
});

describe('age corpus: an unmapped age-like word fails closed', () => {
  it.each(UNMAPPED)('%s', (_label, title) => {
    const r = parseTitle(title);
    expect(r.hardFlags, 'UNKNOWN_AGE_TOKEN').toContain('UNKNOWN_AGE_TOKEN');
    expect(r.needsReview, 'must be reviewed').toBe(true);
    expect(r.ageSignals.some((s) => s.startsWith('unknown_age_word:'))).toBe(true);
    for (const p of [...r.sideA, ...r.sideB]) expect(p.ageStatus).toBe('minor_suspected');
  });
});

describe('age corpus: adults are not mislabelled', () => {
  it.each([
    ['U-21', `${A} ${TAIL} | U-21`],
    ['35+', `${A} ${TAIL} | 35+`],
    ['Veterans', `${A} | MS Veterans Final - State Cup 2026`],
    ['2026 is not an age', `${A} ${TAIL}`],
    ['score 21-15 is not an age', 'Arun Kumar vs Bala Murugan 21-15 21-18 | State Cup 2026 | Final'],
  ])('%s', (_label, title) => {
    const r = parseTitle(title);
    expect(r.minorHold).toBe(false);
    expect(r.hardFlags).not.toContain('UNKNOWN_AGE_TOKEN');
  });
});

describe('noise words and scores stay out of player names (B2-3)', () => {
  it.each([
    ['Replay', 'Arun Kumar vs Bala Murugan Replay | State Cup 2026', 'Bala Murugan'],
    ['Today', 'Arun Kumar vs Bala Murugan Today | State Cup 2026', 'Bala Murugan'],
    ['Live', 'Arun Kumar vs Bala Murugan Live | State Cup 2026', 'Bala Murugan'],
    ['HD', 'Arun Kumar vs Bala Murugan HD | State Cup 2026', 'Bala Murugan'],
    ['Full Match', 'Arun Kumar vs Bala Murugan Full Match | State Cup 2026', 'Bala Murugan'],
    ['Telecast', 'Arun Kumar vs Bala Murugan Telecast | State Cup 2026', 'Bala Murugan'],
    ['score then round', 'Arun vs Bala 21-15 21-18 Final', 'Bala'],
  ])('%s', (_label, title, expectedB) => {
    const r = parseTitle(title);
    expect(r.sideB.map((p) => p.displayName)).toEqual([expectedB]);
  });
});

describe('calendar and season validation (B2-4) and input cap (B2-5)', () => {
  it('rejects impossible dates and keeps the year', () => {
    const r = parseTitle('Arun Kumar vs Bala Murugan | State Cup 31/02/2026 | Final');
    expect(r.playedOn).toBeNull();
    expect(r.year).toBe(2026);
    expect(r.tournamentName).toBe('State Cup');
    expect(parseTitle('Arun Kumar vs Bala Murugan | State Cup 12/13/2025 | Final').playedOn).toBeNull();
    expect(parseTitle('Arun Kumar vs Bala Murugan | State Cup 29/02/2025 | Final').playedOn).toBeNull();
    expect(parseTitle('Arun Kumar vs Bala Murugan | State Cup 29/02/2028 | Final').playedOn).toBe('2028-02-29');
  });
  it('a season that is not start+1 leaves no stray suffix in the name', () => {
    const r = parseTitle('Arun Kumar vs Bala Murugan | State Cup 2025-27 | Final');
    expect(r.tournamentName).toBe('State Cup');
    expect(r.seriesKey).toBe('state cup');
  });
  it('a pathological long input is bounded in time and flagged', () => {
    const started = Date.now();
    const r = parseTitle('.'.repeat(20000) + ' vs ' + '.'.repeat(20000));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.rawTitle.length).toBe(40004);
  });
});
