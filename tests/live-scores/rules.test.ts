// The shared live-score rules (D-113) and their SQL copies: switches on only when exactly true, the tap key rule, the cache header,
// the live window bounds, and the in-build gate (features.liveScores missing = off).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_RE,
  isIdempotencyKey,
  LIVE_POLL_MS,
  LIVE_SCORES_CACHE_CONTROL,
  LIVE_WINDOW_SECONDS_DEFAULT,
  LIVE_WINDOW_SECONDS_MAX,
  LIVE_WINDOW_SECONDS_MIN,
  liveScoresEnvOn,
  liveScoresFlagOn,
  newTapKey,
} from '../../src/lib/live-scores/rules';
import { liveScoresInBuild, liveScoresServerOn } from '../../src/lib/live-scores/in-build';
import { features } from '../../src/content/legal/status';

const sql17 = readFileSync('supabase/migrations/0017_competition.sql', 'utf8');
const sql21 = readFileSync('supabase/migrations/0021_live_scores.sql', 'utf8');

describe('switches', () => {
  it('the server switch is on only for exactly "true"', () => {
    expect(liveScoresEnvOn({ LIVE_SCORES_ENABLED: 'true' })).toBe(true);
    for (const v of ['TRUE', 'True', '1', 'yes', ' true', '', undefined, true]) expect(liveScoresEnvOn({ LIVE_SCORES_ENABLED: v })).toBe(false);
    expect(liveScoresEnvOn(null)).toBe(false);
  });
  it('the legal switch is on only for exactly true; a missing flag is off', () => {
    expect(liveScoresFlagOn({ liveScores: true })).toBe(true);
    for (const v of ['true', 1, null, undefined]) expect(liveScoresFlagOn({ liveScores: v })).toBe(false);
    expect(liveScoresFlagOn({})).toBe(false);
    expect(liveScoresFlagOn(null)).toBe(false);
  });
  it('the endpoint needs both switches', () => {
    expect(liveScoresServerOn({ LIVE_SCORES_ENABLED: 'true' }, { liveScores: true })).toBe(true);
    expect(liveScoresServerOn({ LIVE_SCORES_ENABLED: 'true' }, { liveScores: false })).toBe(false);
    expect(liveScoresServerOn({}, { liveScores: true })).toBe(false);
  });
  it('the build and the endpoint follow features.liveScores (absent or false today = no live region)', () => {
    const on = (features as unknown as Record<string, unknown>).liveScores === true;
    expect(liveScoresInBuild()).toBe(on);
    expect(liveScoresServerOn({ LIVE_SCORES_ENABLED: 'true' })).toBe(on);
    expect(liveScoresServerOn({})).toBe(false);
  });
});

describe('tap keys and the SQL copies', () => {
  it('the key rule is the same text as the 0017 check constraint and the 0021 RPC', () => {
    expect(IDEMPOTENCY_KEY_RE.source).toBe('^[A-Za-z0-9_-]{8,80}$');
    expect(sql17).toContain("idempotency_key ~ '^[A-Za-z0-9_-]{8,80}$'");
    expect(sql21).toContain("!~ '^[A-Za-z0-9_-]{8,80}$'");
  });
  it('newTapKey makes a valid, distinct key', () => {
    const k1 = newTapKey();
    const k2 = newTapKey();
    expect(isIdempotencyKey(k1) && isIdempotencyKey(k2)).toBe(true);
    expect(k1).not.toBe(k2);
    expect(newTapKey(() => new Uint8Array(12))).toBe(`t${'0'.repeat(24)}`);
    for (const bad of ['short', 'has space 123', 'x'.repeat(81), 'emoji-key-éé', 12345678]) expect(isIdempotencyKey(bad)).toBe(false);
  });
  it('the live window bounds and default match the SQL', () => {
    expect([LIVE_WINDOW_SECONDS_MIN, LIVE_WINDOW_SECONDS_DEFAULT, LIVE_WINDOW_SECONDS_MAX]).toEqual([60, 300, 3600]);
    expect(sql21).toContain('live_window_seconds integer not null default 300');
    expect(sql21).toContain('check (live_window_seconds between 60 and 3600)');
    expect(sql21).toContain("app.competition_int(p_record -> 'windowSeconds', 'windowSeconds', 60, 3600)");
  });
  it('the database switch is off by default', () => {
    expect(sql21).toContain('add column live_scores_public boolean not null default false');
  });
});

describe('caching and polling', () => {
  it('answers are cached about a minute; the page asks about every minute', () => {
    expect(LIVE_SCORES_CACHE_CONTROL).toBe('public, s-maxage=30, stale-while-revalidate=15');
    expect(LIVE_POLL_MS).toBe(60_000);
  });
});
