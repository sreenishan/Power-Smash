/**
 * Smoke tests over the 70 real titles (tests/fixtures/real-titles.raw.json).
 *
 * Only STRUCTURAL invariants are asserted here (never a semantic label: those live in the gold set
 * and are measured per field once the owner has spot-checked it, OT-35):
 *   - parseTitle never throws on a real title (GREEN);
 *   - it returns an implemented parse that preserves the raw title and obeys the output contract
 *     (GREEN since M2b).
 */
import { describe, expect, it } from 'vitest';
import { HARD_FLAGS, SOFT_FLAGS, REVIEW_THRESHOLD_POINTS, isNotImplemented, parseTitle } from '../../src/lib/parser';
import type { ParsedPlayer, ParseResult } from '../../src/lib/parser';
import { realTitles } from './helpers/fixtures';

const titles = realTitles();
const KINDS = ['match', 'non_match', 'team_tie'];
const FORMATS = ['singles', 'doubles', 'unknown'];
const TIERS = ['multi_token', 'single_token', 'initials_only'];
const LINK_POLICIES = ['provisional_ok', 'plain_text_only', 'blocked'];

describe('real titles: parseTitle never throws', () => {
  it.each(titles.map((title, index) => [index, title] as const))('#%i %s', (_index, title) => {
    expect(() => parseTitle(title)).not.toThrow();
  });
});

function checkPlayer(player: ParsedPlayer, where: string): void {
  expect(typeof player.displayName, `${where} displayName`).toBe('string');
  expect(player.displayName.trim().length, `${where} displayName must not be empty`).toBeGreaterThan(0);
  expect(typeof player.nameNormalized, `${where} nameNormalized`).toBe('string');
  expect(player.nameNormalized.length, `${where} nameNormalized must never be empty`).toBeGreaterThan(0);
  expect(typeof player.nameKey, `${where} nameKey`).toBe('string');
  expect(player.nameKey.length, `${where} nameKey must never be empty`).toBeGreaterThan(0);
  expect(TIERS, `${where} identityTier`).toContain(player.identityTier);
  expect(LINK_POLICIES, `${where} linkPolicy`).toContain(player.linkPolicy);
  expect(['minor_suspected', 'unknown'], `${where} ageStatus (the parser never confirms an age)`).toContain(player.ageStatus);
  if (player.truncated) expect(player.linkPolicy, `${where} a truncated name must never link`).toBe('blocked');
}

function checkInvariants(title: string, result: ParseResult): void {
  expect(result.rawTitle, 'raw title preserved byte-exact').toBe(title);
  expect(typeof result.parserVersion).toBe('string');
  expect(result.parserVersion.length).toBeGreaterThan(0);
  expect(result.normalizedTitle).toBe(result.normalizedTitle.trim());
  expect(result.normalizedTitle).not.toMatch(/\s{2,}/u);
  expect(Array.isArray(result.signals)).toBe(true);

  expect(KINDS).toContain(result.kind);
  expect(typeof result.isInternational).toBe('boolean');
  if (result.isInternational) expect(result.entityCreation, 'international titles create no rows').toBe('blocked');
  if (result.kind === 'non_match') {
    expect(result.nonMatchReason, 'a non_match carries a reason').not.toBeNull();
    expect(result.sideA).toEqual([]);
    expect(result.sideB).toEqual([]);
    expect(result.entityCreation).toBe('blocked');
  } else {
    expect(result.nonMatchReason).toBeNull();
  }
  if (result.kind === 'team_tie') expect(result.teams).not.toBeNull();
  else expect(result.teams).toBeNull();

  expect(Array.isArray(result.sideA)).toBe(true);
  expect(Array.isArray(result.sideB)).toBe(true);
  result.sideA.forEach((p, i) => checkPlayer(p, `sideA[${i}]`));
  result.sideB.forEach((p, i) => checkPlayer(p, `sideB[${i}]`));

  expect(FORMATS).toContain(result.format);
  if (result.format === 'singles') expect([result.sideA.length, result.sideB.length]).toEqual([1, 1]);
  if (result.format === 'doubles') expect([result.sideA.length, result.sideB.length]).toEqual([2, 2]);

  if (result.year !== null) {
    expect(Number.isInteger(result.year)).toBe(true);
    expect(result.year).toBeGreaterThanOrEqual(1900);
    expect(result.year).toBeLessThanOrEqual(2099);
  }
  if (result.tournamentName !== null) expect(result.tournamentName.trim().length).toBeGreaterThan(0);
  if (result.tournamentName !== null) expect(result.tournamentName, 'tournament name carries no trailing year').not.toMatch(/\s(?:19|20)\d{2}$/u);

  // the integer confidence contract (PC-03)
  expect(Number.isInteger(result.confidencePoints), 'confidence is an integer').toBe(true);
  expect(result.confidencePoints).toBeGreaterThanOrEqual(0);
  expect(result.confidencePoints).toBeLessThanOrEqual(100);
  for (const flag of result.hardFlags) expect(HARD_FLAGS as readonly string[]).toContain(flag);
  for (const hit of result.softFlags) {
    expect(SOFT_FLAGS as readonly string[]).toContain(hit.flag);
    expect(Number.isInteger(hit.count) && Number.isInteger(hit.points)).toBe(true);
  }
  if (result.kind !== 'non_match') {
    expect(result.needsReview, 'review rule').toBe(result.hardFlags.length > 0 || result.confidencePoints < REVIEW_THRESHOLD_POINTS);
  } else {
    expect(result.needsReview).toBe(false);
  }
  expect(result.minorHold).toBe(result.ageSignals.length > 0 && result.ageSignals.some((s) => !s.startsWith('unknown_age_word:')));
}

describe('real titles: an implemented parse with the structural invariants', () => {
  it.each(titles.map((title, index) => [index, title] as const))('#%i %s', (index, title) => {
    const outcome = parseTitle(title);
    expect(isNotImplemented(outcome), `real title #${index}: parseTitle returned NOT_IMPLEMENTED (the corrected parser lands in milestone M2b)`).toBe(false);
    checkInvariants(title, outcome as ParseResult);
  });
});
