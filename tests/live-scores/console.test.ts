// The scoring console (D-113): the offline-safe queue (same key and sequence on a retry, dropped on STALE, kept on this phone), the
// score the scorer sees (the engine on top of the server's score), and a server render of the console on a phone: big labelled tap
// targets, the cues as a polite status, the end choices behind a confirmation. Fictional names only.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminContext, type AdminCtx } from '../../src/admin/ui';
import { ConsoleBody, LiveSettingsCard, MatchList } from '../../src/admin/screens/scoring/Scoring';
import {
  abilities,
  answer,
  classify,
  enqueue,
  loadQueue,
  newModel,
  OFFLINE_TEXT,
  retryDelayMs,
  saveQueue,
  scoreLine,
  shownCues,
  shownState,
  STALE_TEXT,
  SIGNED_OUT_TEXT,
  FORBIDDEN_TEXT,
  sendingHalted,
  type ConsoleModel,
  type StorageLike,
} from '../../src/admin/screens/scoring/logic';
import { DEFAULT_RULESET } from '../../src/lib/competition/scoring';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import type { LiveConsoleDto, LiveScoringAdminStore, LiveSnapshot } from '../../src/lib/admin/live-scoring/types';
import { failResult, okResult, type StoreResult } from '../../src/lib/admin/types';
import { replayScoreEvents } from '../../src/lib/live-scores/replay';

const OWNER = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' as const };
const M1 = '9f000000-0000-4000-8000-000000000001';

function snapshotAfter(sides: string, first: 'A' | 'B' | null = null): LiveSnapshot {
  let seq = 0;
  const events = [...(first ? [{ seq: ++seq, kind: 'first_server' as const, side: first }] : []), ...[...sides].map((s) => ({ seq: ++seq, kind: 'rally' as const, side: s as 'A' | 'B' }))];
  const r = replayScoreEvents(events, DEFAULT_RULESET);
  if (!r.ok) throw new Error('replay');
  return r.snapshot;
}

function dto(over: Partial<LiveConsoleDto> = {}): LiveConsoleDto {
  return {
    matchId: M1,
    tournamentName: 'Demo Open Cup',
    label: 'MS Final match 1',
    courtLabel: 'Court 1',
    status: 'live',
    revision: 2,
    ruleset: { ...DEFAULT_RULESET },
    sides: { A: 'Demo Arun', B: 'Demo Bala' },
    snapshot: snapshotAfter(''),
    cues: [],
    ...over,
  };
}

const tapOk = (snapshot: LiveSnapshot, duplicate = false) => okResult({ duplicate, seq: snapshot.lastSeq, status: 'live' as const, revision: 2, snapshot });

describe('the queue', () => {
  it('each tap gets the next expected sequence after the server score and the waiting taps', () => {
    let m = newModel(dto({ snapshot: snapshotAfter('AB') }));
    for (const k of ['fake-key-0001', 'fake-key-0002']) {
      const r = enqueue(m, 'rally', 'A', k);
      if (!r.ok) throw new Error(r.reason);
      m = r.model;
    }
    expect(m.queue.map((t) => t.expectedSeq)).toEqual([2, 3]);
    expect(shownState(m)?.current).toEqual({ a: 3, b: 1 });
  });
  it('the engine refuses an impossible tap before it is queued', () => {
    const m = newModel(dto());
    const r = enqueue(m, 'undo', null, 'fake-key-0001');
    expect(r.ok || r.reason).toBe('Nothing to undo; no points have been recorded.');
  });
  it('a done answer moves the score on and keeps the rest of the queue', () => {
    let m = newModel(dto());
    for (const k of ['fake-key-0001', 'fake-key-0002']) m = (enqueue(m, 'rally', 'A', k) as { ok: true; model: ConsoleModel }).model;
    m = answer(m, tapOk(snapshotAfter('A')));
    expect(m.queue).toHaveLength(1);
    expect(m.data.snapshot.pointsA).toBe(1);
    expect(shownState(m)?.current).toEqual({ a: 2, b: 0 });
    m = answer(m, tapOk(snapshotAfter('AA')));
    expect(m.queue).toHaveLength(0);
    expect(m.problem).toBeNull();
  });
  it('no connection: the tap stays first with the SAME key and sequence, tries counted', () => {
    let m = (enqueue(newModel(dto()), 'rally', 'B', 'fake-key-0001') as { ok: true; model: ConsoleModel }).model;
    m = answer(m, failResult('BACKEND_ERROR'));
    expect(m.queue[0]).toMatchObject({ key: 'fake-key-0001', expectedSeq: 0, tries: 1 });
    expect(m.problem).toBe(OFFLINE_TEXT);
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
  it('STALE or a refusal drops the queue and asks for a reload; signed out keeps the taps', () => {
    const q = (enqueue(newModel(dto()), 'rally', 'B', 'fake-key-0001') as { ok: true; model: ConsoleModel }).model;
    const stale = answer(q, failResult('STALE'));
    expect(stale).toMatchObject({ queue: [], needsReload: true, problem: STALE_TEXT });
    const refused = answer(q, failResult('INVALID', { form: 'The match is paused; resume it first.' }));
    expect(refused).toMatchObject({ queue: [], needsReload: true, problem: 'The match is paused; resume it first.' });
    const out = answer(q, failResult('UNAUTHORIZED'));
    expect(out.queue).toHaveLength(1);
    expect(out.problem).toBe(SIGNED_OUT_TEXT);
    expect(sendingHalted(out)).toBe(true);
    // the waiting taps live in memory only: the text never promises they survive signing in again
    expect(SIGNED_OUT_TEXT).not.toMatch(/kept on this phone/);
    expect(SIGNED_OUT_TEXT).toMatch(/write the score down/);
    // a revoked assignment or an ended account is not "signed out": signing in again cannot help
    expect(classify(failResult('FORBIDDEN'))).toBe('forbidden');
    const gone = answer(q, failResult('FORBIDDEN'));
    expect(gone.problem).toBe(FORBIDDEN_TEXT);
    expect(gone.problem).not.toMatch(/sign in/i);
    expect(sendingHalted(gone)).toBe(true);
    expect(classify(failResult('BACKEND_ERROR', { form: 'The score could not be read back.' }))).toBe('stale');
  });
  it('after a reload, a waiting run that starts at or before the server score is kept (the server answers duplicate); a later one is dropped', () => {
    const q = [{ key: 'fake-key-0001', kind: 'rally' as const, side: 'A' as const, expectedSeq: 1, tries: 0 }, { key: 'fake-key-0002', kind: 'rally' as const, side: 'A' as const, expectedSeq: 2, tries: 0 }];
    expect(newModel(dto({ snapshot: snapshotAfter('AA') }), q).queue).toHaveLength(2);
    expect(newModel(dto({ snapshot: snapshotAfter('') }), q).queue).toHaveLength(0);
    expect(newModel(dto({ snapshot: snapshotAfter('A') }), [q[1]!, q[0]!]).queue).toHaveLength(0);
  });
  it('is kept on this phone, and a broken or blocked store is harmless', () => {
    const mem = new Map<string, string>();
    const store: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    const q = [{ key: 'fake-key-0001', kind: 'rally' as const, side: 'A' as const, expectedSeq: 0, tries: 2 }];
    saveQueue(store, M1, q);
    expect(loadQueue(store, M1)).toEqual(q);
    saveQueue(store, M1, []);
    expect(mem.size).toBe(0);
    mem.set(`ps-live-queue:${M1}`, JSON.stringify([{ key: 'x', kind: 'rally', side: 'A', expectedSeq: 0, tries: 0 }, 'junk']));
    expect(loadQueue(store, M1)).toEqual([]);
    mem.set(`ps-live-queue:${M1}`, '{not json');
    expect(loadQueue(store, M1)).toEqual([]);
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => saveQueue(throwing, M1, q)).not.toThrow();
    expect(loadQueue(throwing, M1)).toEqual([]);
    expect(loadQueue(null, M1)).toEqual([]);
  });
});

describe('what the buttons may do', () => {
  it('follows the status, the score and the queue', () => {
    expect(abilities(newModel(dto({ status: 'scheduled' })))).toMatchObject({ point: false, start: true, firstServer: true, end: false });
    expect(abilities(newModel(dto()))).toMatchObject({ point: true, undo: false, pause: true, end: true, firstServer: true });
    const played = newModel(dto({ snapshot: snapshotAfter('A') }));
    expect(abilities(played)).toMatchObject({ undo: true, firstServer: false });
    const won = newModel(dto({ snapshot: snapshotAfter('A'.repeat(42)) }));
    expect(abilities(won)).toMatchObject({ point: false, undo: true, end: true });
    expect(abilities(newModel(dto({ status: 'paused' })))).toMatchObject({ point: false, resume: true, pause: false });
    const waiting = (enqueue(newModel(dto()), 'rally', 'A', 'fake-key-0001') as { ok: true; model: ConsoleModel }).model;
    expect(abilities(waiting)).toMatchObject({ pause: false, end: false, point: true });
    expect(abilities({ ...waiting, needsReload: true })).toMatchObject({ point: false, undo: false, start: false });
  });
  it('the words', () => {
    expect(scoreLine(snapshotAfter('AB'.repeat(19) + 'AA' + 'AB'))).toBe('21-19, game 2: 1-1');
    expect(scoreLine(snapshotAfter('A'.repeat(42)))).toBe('Final games: 21-0, 21-0');
    expect(shownCues(newModel(dto({ snapshot: snapshotAfter('A'.repeat(11)) })))[0]).toBe('Interval: Demo Arun reached 11.');
  });
});

// ----------------------------------------------------------------------------- server render

function ctx(): AdminCtx {
  const client = new MemoryAdminStore({ now: () => new Date('2026-11-07T05:00:00.000Z') });
  return { client, actor: OWNER, mode: 'preview', notify: () => undefined, check: ((r: StoreResult<unknown>) => r.ok) as AdminCtx['check'], signOut: () => undefined, version: 0, bump: () => undefined };
}
const render = (el: ReactElement) => renderToStaticMarkup(createElement(AdminContext.Provider, { value: ctx() }, el));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const store = {} as LiveScoringAdminStore;

describe('the console, rendered', () => {
  it('a live match: big point buttons named after the sides, undo, the cues as a polite status, a real score table', () => {
    const html = render(createElement(ConsoleBody, { model: newModel(dto({ snapshot: snapshotAfter('A'.repeat(11), 'B') })), setModel: () => undefined, store, onBack: () => undefined, reload: async () => undefined }));
    const t = text(html);
    expect(t).toContain('Point to Demo Arun');
    expect(t).toContain('Point to Demo Bala');
    expect(t).toContain('Undo the last point');
    expect(t).toContain('Interval: Demo Arun reached 11.');
    expect(t).toContain('Demo Arun (serving)');
    expect(t).toContain('End the match');
    expect(t).toContain('Pause');
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(html).toContain('min-h-[6rem]');
    expect(html).toMatch(/<th scope="row"/);
    expect(t).not.toMatch(/card number|UPI|password/i);
  });
  it('before the start: the start button and the first-server choice, no point buttons enabled', () => {
    const html = render(createElement(ConsoleBody, { model: newModel(dto({ status: 'scheduled' })), setModel: () => undefined, store, onBack: () => undefined, reload: async () => undefined }));
    const t = text(html);
    expect(t).toContain('Start the match');
    expect(t).toContain('Who serves first?');
    expect((html.match(/<button[^>]*disabled=""[^>]*>Point to/g) ?? []).length).toBe(2);
  });
  it('a reload is offered after another device scored', () => {
    const m = { ...newModel(dto()), needsReload: true, problem: STALE_TEXT };
    const t = text(render(createElement(ConsoleBody, { model: m, setModel: () => undefined, store, onBack: () => undefined, reload: async () => undefined })));
    expect(t).toContain('Reload the match');
    expect(t).toContain(STALE_TEXT);
  });
  it('the match list and the settings card render their headings (data loads after mount)', () => {
    const t = text(render(createElement('div', null, createElement(LiveSettingsCard, { store }), createElement(MatchList, { store, onOpen: () => undefined }))));
    expect(t).toContain('Live scores on the website');
    expect(t).toContain('Matches to score');
  });
});
