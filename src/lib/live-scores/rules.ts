// Near-live scores (D-113): the rules shared by the server (the endpoint, the admin service, the memory backend), the browser (the
// event page script and the scoring console) and mirrored in SQL (supabase/migrations/0021_live_scores.sql). Pure: no I/O, no clock.
// A change here is a change on every side; tests/live-scores/rules.test.ts pins the SQL copies.

/** The kinds of tap in the append-only rally log (public.match_score_events, 0017). */
export const SCORE_EVENT_KINDS = ['first_server', 'rally', 'undo'] as const;
export type ScoreEventKind = (typeof SCORE_EVENT_KINDS)[number];

/** A tap's idempotency key: the same rule as the check constraint of match_score_events (0017) and admin_live_score (0021). */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** The highest expected sequence number the RPC accepts (admin_live_score: 0..1,000,000). */
export const MAX_SEQ = 1_000_000;

/** Statuses a console may change: start (scheduled/ready -> live), pause, resume, end. */
export const LIVE_ACTIONS = ['start', 'pause', 'resume', 'end'] as const;
export type LiveAction = (typeof LIVE_ACTIONS)[number];
/** How a match ends from the console. A walkover has no rallies: it is recorded on the Results screen. */
export const LIVE_END_STATUSES = ['completed', 'retired', 'abandoned'] as const;
export type LiveEndStatus = (typeof LIVE_END_STATUSES)[number];

/** The live window (competition_settings.live_window_seconds, 0021): the default and its bounds, in seconds. */
export const LIVE_WINDOW_SECONDS_DEFAULT = 300;
export const LIVE_WINDOW_SECONDS_MIN = 60;
export const LIVE_WINDOW_SECONDS_MAX = 3600;

/** The event page asks again about every minute (D-113) while the event has a live or paused match (LIVE_IDLE_POLL_MS otherwise). */
export const LIVE_POLL_MS = 60_000;
/**
 * While nothing is live, a visible page still looks again this often, so a visitor at the venue sees a match go live without
 * reloading. The answers are cached at the edge (s-maxage), so an idle page costs almost nothing.
 */
export const LIVE_IDLE_POLL_MS = 300_000;

/**
 * Cache header of a successful answer: shared caches keep it for 30 s and may serve it 15 s longer while fetching a new one. Kept
 * short on purpose: a player the owner protects or removes during a match can stay named in a cached answer for at most about 45 s
 * (D-124). The page asks every 60 s, so a fresher cache costs at most two database reads a minute per event.
 * UNVERIFIED for Vercel: no fact in docs/VERIFIED_FACTS.md or docs/m3/vercel-facts.md confirms how Vercel's CDN treats s-maxage and
 * stale-while-revalidate on a function response (check on a preview: the second request within a minute should show
 * `x-vercel-cache: HIT`). Errors are never cached (NO_STORE).
 */
export const LIVE_SCORES_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=15';
export const NO_STORE = 'no-store';

/** The runtime switch: exactly the text "true" turns the endpoint on; anything else (absent, "1", "TRUE") keeps it off. */
export const LIVE_SCORES_ENV = 'LIVE_SCORES_ENABLED';
export function liveScoresEnvOn(env: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return env?.[LIVE_SCORES_ENV] === 'true';
}

/** The legal switch features.liveScores (src/content/legal/status.ts, added by the integrator). Exactly true, never truthy. */
export function liveScoresFlagOn(flags: unknown): boolean {
  return typeof flags === 'object' && flags !== null && (flags as Record<string, unknown>).liveScores === true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** True for a tap key the database will accept. */
export const isIdempotencyKey = (v: unknown): v is string => typeof v === 'string' && IDEMPOTENCY_KEY_RE.test(v);

/** A fresh tap key: "t" + 24 random hex characters (fits IDEMPOTENCY_KEY_RE). `randomBytes` is injected for tests. */
export function newTapKey(randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return `t${Array.from(randomBytes(12), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
