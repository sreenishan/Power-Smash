// The scoring console's pure logic (D-113): the queue of taps waiting for the server, the score the scorer sees (the last confirmed
// score with the waiting taps applied by the same engine the server uses), and what each kind of answer does to the queue.
//
// Offline-safe: every tap gets its own key when it is tapped (newTapKey) and the sequence number it expects, and keeps both when it is
// sent again, so a tap whose answer was lost is stored once (the server answers "duplicate"). Waiting taps live in memory, so a lost
// connection loses nothing. saveQueue/loadQueue can also keep them across a reload in a browser store passed in by the caller; the
// screen passes none today, because the Privacy Policy says our pages store nothing in the browser (tests/legal/reality.test.ts):
// that needs a policy sentence first (see docs/m5/integration/live.md).
import type { LiveConsoleDto, LiveSnapshot, LiveTapDto, ScoreEventKind } from '../../../lib/admin/live-scoring/types';
import type { StoreResult } from '../../../lib/admin/types';
import type { Side } from '../../../lib/competition/types';
import type { LiveState } from '../../../lib/competition/scoring';
import { applyTap, cuesOf, stateFromSnapshot } from '../../../lib/live-scores/replay';

export interface PendingTap {
  key: string;
  kind: ScoreEventKind;
  side: Side | null;
  expectedSeq: number;
  tries: number;
}

export interface ConsoleModel {
  data: LiveConsoleDto;
  queue: PendingTap[];
  /** A plain sentence for the scorer, or null. */
  problem: string | null;
  /** The console must load the match again before more taps (another device scored, or the score could not be read back). */
  needsReload: boolean;
}

export const STALE_TEXT = 'The score was changed on another device. Reload the match and check it before scoring again.';
export const OFFLINE_TEXT = 'No connection. Your taps are kept on this phone and sent again automatically.';
// The waiting taps live only in this screen's memory (no browser storage until the privacy text allows it): signing in again starts
// the admin afresh and loses them, so the text never promises they survive a sign-in.
export const SIGNED_OUT_TEXT = 'You are signed out. Taps not sent yet are lost when you sign in again: write the score down first, then sign in and check it.';
/** A revoked assignment or an ended account: signing in again cannot help. */
export const FORBIDDEN_TEXT = 'You no longer have access to this match. Write the score down and tell the organiser or Power Smash.';

/** Sending stops (no loop of refused sends) after signed out or no access; the waiting taps stay on screen so the count is visible. */
export function sendingHalted(m: Pick<ConsoleModel, 'problem'>): boolean {
  return m.problem === SIGNED_OUT_TEXT || m.problem === FORBIDDEN_TEXT;
}

export function newModel(data: LiveConsoleDto, queue: PendingTap[] = []): ConsoleModel {
  // Waiting taps from before a reload are kept when they are one unbroken run that starts at or before the server's last tap: the
  // first may already be stored (its answer was lost), and sending it again with the same key answers "duplicate". A run that starts
  // after the server's score cannot be right and is dropped. The server decides the rest (STALE when another device scored).
  const first = queue[0]?.expectedSeq ?? 0;
  const run = queue.every((t, i) => t.expectedSeq === first + i);
  return { data, queue: run && first <= data.snapshot.lastSeq ? [...queue] : [], problem: null, needsReload: false };
}

/** The engine state the scorer sees: the confirmed score plus every waiting tap. Null when it cannot be rebuilt. */
export function shownState(m: ConsoleModel): LiveState | null {
  let s = stateFromSnapshot(m.data.snapshot, m.data.ruleset);
  if (!s) return null;
  for (const t of m.queue) {
    const r = applyTap(s, t.kind, t.side);
    if (!r.ok) return null;
    s = r.state;
  }
  return s;
}

export function shownCues(m: ConsoleModel): string[] {
  const s = shownState(m);
  return s ? cuesOf(s, m.data.sides) : [];
}

/** What the buttons may do now (the server checks again). */
export function abilities(m: ConsoleModel): { point: boolean; undo: boolean; firstServer: boolean; start: boolean; pause: boolean; resume: boolean; end: boolean } {
  const s = shownState(m);
  const status = m.data.status;
  const blocked = m.needsReload || s === null;
  return {
    point: !blocked && status === 'live' && !(s?.matchOver ?? true),
    undo: !blocked && status === 'live' && (s?.rallies.length ?? 0) > 0,
    firstServer: !blocked && (status === 'scheduled' || status === 'ready' || status === 'live') && (s?.rallies.length ?? 1) === 0,
    start: !m.needsReload && (status === 'scheduled' || status === 'ready'),
    pause: !m.needsReload && status === 'live' && m.queue.length === 0,
    resume: !m.needsReload && status === 'paused',
    end: !m.needsReload && (status === 'live' || status === 'paused') && m.queue.length === 0,
  };
}

/** Adds a tap (refused with a sentence when the engine refuses it on the shown score). */
export function enqueue(m: ConsoleModel, kind: ScoreEventKind, side: Side | null, key: string): { ok: true; model: ConsoleModel } | { ok: false; reason: string } {
  if (m.needsReload) return { ok: false, reason: STALE_TEXT };
  const s = shownState(m);
  if (!s) return { ok: false, reason: STALE_TEXT };
  const r = applyTap(s, kind, side);
  if (!r.ok) return { ok: false, reason: r.reasons[0] ?? 'That tap is not possible now.' };
  const tap: PendingTap = { key, kind, side, expectedSeq: m.data.snapshot.lastSeq + m.queue.length, tries: 0 };
  return { ok: true, model: { ...m, queue: [...m.queue, tap], problem: null } };
}

export type AnswerKind = 'done' | 'retry' | 'stale' | 'refused' | 'signed_out' | 'forbidden';

/** Classifies the server's answer to the first waiting tap. */
export function classify(r: StoreResult<LiveTapDto>): AnswerKind {
  if (r.ok) return 'done';
  if (r.code === 'STALE') return 'stale';
  if (r.code === 'UNAUTHORIZED') return 'signed_out';
  if (r.code === 'FORBIDDEN') return 'forbidden';
  // a backend error without a sentence is the network or a timeout: send again (same key, same sequence)
  if (r.code === 'BACKEND_ERROR' && !r.errors?.form) return 'retry';
  if (r.code === 'BACKEND_ERROR') return 'stale';
  return 'refused';
}

/** The model after the server answered the FIRST waiting tap. */
export function answer(m: ConsoleModel, r: StoreResult<LiveTapDto>): ConsoleModel {
  const [head, ...rest] = m.queue;
  if (!head) return m;
  const kind = classify(r);
  if (kind === 'done' && r.ok) {
    const d = r.data;
    const data: LiveConsoleDto = { ...m.data, snapshot: d.snapshot, status: d.status, revision: d.revision };
    // the rest of the queue follows on from this answer (its sequence numbers were counted from the old score plus the queue)
    const ok = rest.every((t, i) => t.expectedSeq === d.snapshot.lastSeq + i);
    const next: ConsoleModel = { ...m, data, queue: ok ? rest : [], problem: ok ? null : STALE_TEXT, needsReload: !ok };
    const cues = shownCues(next);
    return { ...next, data: { ...data, cues } };
  }
  if (kind === 'retry') return { ...m, queue: [{ ...head, tries: head.tries + 1 }, ...rest], problem: OFFLINE_TEXT };
  if (kind === 'signed_out') return { ...m, problem: SIGNED_OUT_TEXT };
  if (kind === 'forbidden') return { ...m, problem: FORBIDDEN_TEXT };
  const text = !r.ok && typeof r.errors?.form === 'string' && r.errors.form !== '' ? r.errors.form : STALE_TEXT;
  // stale or refused: the waiting taps were counted on a score that is not the server's; drop them and reload
  return { ...m, queue: [], problem: kind === 'stale' ? STALE_TEXT : text, needsReload: true };
}

/** Seconds before sending a failed tap again: 2, 4, 8, 16, then every 30. */
export function retryDelayMs(tries: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(1, Math.min(tries, 5)));
}

// ----------------------------------------------------------------------------- keeping the queue on this phone

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storeKey = (matchId: string) => `ps-live-queue:${matchId}`;
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

export function saveQueue(storage: StorageLike | null, matchId: string, queue: readonly PendingTap[]): void {
  if (!storage) return;
  try {
    if (queue.length === 0) storage.removeItem(storeKey(matchId));
    else storage.setItem(storeKey(matchId), JSON.stringify(queue));
  } catch {
    // private window or a full store: the queue lives in memory only
  }
}

export function loadQueue(storage: StorageLike | null, matchId: string): PendingTap[] {
  if (!storage) return [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(storeKey(matchId)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (t): t is PendingTap =>
          typeof t === 'object' && t !== null && typeof t.key === 'string' && KEY_RE.test(t.key) && ['rally', 'undo', 'first_server'].includes(t.kind) &&
          (t.side === null || t.side === 'A' || t.side === 'B') && Number.isInteger(t.expectedSeq) && t.expectedSeq >= 0 && Number.isInteger(t.tries),
      )
      .slice(0, 200);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------- words

export function scoreLine(s: LiveSnapshot): string {
  const done = s.games.map((g) => `${g.a}-${g.b}`).join(', ');
  if (s.matchOver) return `Final games: ${done}`;
  return `${done ? `${done}, ` : ''}game ${s.gameNumber}: ${s.pointsA}-${s.pointsB}`;
}

export const STATUS_WORDS: Readonly<Record<string, string>> = {
  scheduled: 'Not started',
  ready: 'Ready to start',
  live: 'Live',
  paused: 'Paused',
  completed: 'Finished, waiting for confirmation',
  retired: 'Retired, waiting for confirmation',
  abandoned: 'Abandoned, waiting for confirmation',
};

/** The fixed reasons the console sends (the audit shows which button was used). */
export const STATUS_REASON: Readonly<Record<'start' | 'pause' | 'resume' | 'end', string>> = {
  start: 'Started from the scoring console',
  pause: 'Paused from the scoring console',
  resume: 'Resumed from the scoring console',
  end: 'Ended from the scoring console',
};
