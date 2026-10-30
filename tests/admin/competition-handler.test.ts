// The competition actions through the request handler (POST /api/admin/competition.<name>): strict validation, owner only at aal2,
// refusals as plain words in `errors`, STALE as 409; plus the policy table and the browser client's addresses. Fictional data only.
import { describe, expect, it } from 'vitest';
import { ADMIN_ACTIONS, isActionAllowed, type AdminActionName } from '../../src/lib/admin/policy';
import { createHttpAdminStore } from '../../src/lib/admin/http-store';
import { COMP_SEED } from '../../src/lib/admin/competition/memory-backend';
import { COMPETITION_STORE_METHODS } from '../../src/lib/admin/competition/types';
import { MemoryAdminStore, SEED } from '../../src/lib/admin/memory-store';
import { EDITOR_ID, makeHandler, makeKeys, NOW, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; data?: any; errors?: Record<string, string> };
// the 22 actions of the competition store; the six live scoring actions (D-113, competition.live*) have their own tests (tests/live-scores)
const LIVE_ACTIONS = ['competition.liveMatches', 'competition.liveMatch', 'competition.liveSettings', 'competition.liveScore', 'competition.liveStatus', 'competition.saveLiveSettings'];
const COMPETITION_ACTIONS = (Object.keys(ADMIN_ACTIONS) as AdminActionName[]).filter((a) => a.startsWith('competition.') && !LIVE_ACTIONS.includes(a));

async function setup() {
  const keys = await makeKeys();
  const store = new MemoryAdminStore({ now: () => NOW, randomSeed: () => 77 });
  const h = makeHandler(keys, {}, store);
  const token = await signToken(keys);
  return { ...h, keys, token, call: async (action: string, body: unknown = {}, t: string | null = token) => h.handle(req(action, t, body), action) };
}

describe('competition actions: policy', () => {
  it('there are 22, each owner only at aal2; writes are audited; reads are reads', () => {
    expect(COMPETITION_ACTIONS).toHaveLength(22);
    for (const a of COMPETITION_ACTIONS) {
      expect(ADMIN_ACTIONS[a]).toMatchObject({ roles: ['owner'], requiresAal2: true });
      expect(isActionAllowed('editor', a, { editorsEnabled: true })).toBe(false);
    }
    const reads = COMPETITION_ACTIONS.filter((a) => ADMIN_ACTIONS[a].kind === 'read').sort();
    expect(reads).toEqual(['competition.courts', 'competition.event', 'competition.ranking', 'competition.rankings', 'competition.settings', 'competition.tournaments']);
  });
  it('every action maps to one store method and the browser client posts to the same address', async () => {
    expect(COMPETITION_STORE_METHODS).toHaveLength(COMPETITION_ACTIONS.length);
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createHttpAdminStore({ getToken: () => 't', fetch: f }) as unknown as Record<string, (a: unknown, b?: unknown) => Promise<unknown>>;
    for (const m of COMPETITION_STORE_METHODS) await client[m]!({ userId: 'spoofed', role: 'owner' }, {});
    const expected = COMPETITION_STORE_METHODS.map((m) => `/api/admin/competition.${m.slice('competition'.length, 'competition'.length + 1).toLowerCase()}${m.slice('competition'.length + 1)}`);
    expect(calls).toEqual(expected);
    expect(expected.every((u) => COMPETITION_ACTIONS.includes(u.slice('/api/admin/'.length) as AdminActionName))).toBe(true);
  });
  it('the browser client keeps STALE as its own code', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, code: 'STALE', errors: { form: 'The match changed.' } }), { status: 409 })) as unknown as typeof fetch;
    const r = await createHttpAdminStore({ getToken: () => 't', fetch: f }).competitionConfirmResult({ userId: 'x', role: 'owner' }, { matchId: 'm', expectedRevision: 1, reason: 'abc' });
    expect(r).toEqual({ ok: false, code: 'STALE', errors: { form: 'The match changed.' } });
  });
});

describe('competition actions: request validation', () => {
  it('unknown fields, wrong types and missing reasons are 400 and never reach the store', async () => {
    const s = await setup();
    const before = s.store.state.audit.length;
    const bad: [string, unknown][] = [
      ['competition.event', { eventId: 'not-a-uuid' }],
      ['competition.event', { eventId: COMP_SEED.eventMs, phone: '910000000000' }],
      ['competition.addEntry', { eventId: COMP_SEED.eventMs, players: [COMP_SEED.anand, COMP_SEED.bala, COMP_SEED.eswar], seed: null, status: 'pending', reason: 'demo' }],
      ['competition.addEntry', { eventId: COMP_SEED.eventMs, players: [COMP_SEED.anand], seed: null, status: 'withdrawn', reason: 'demo' }],
      ['competition.setEntry', { entryId: COMP_SEED.eventMs, status: 'confirmed', seed: 0, reason: 'demo' }],
      ['competition.generateDraw', { eventId: COMP_SEED.eventMs, separateClubs: false, seeds: 2 }],
      ['competition.generateDraw', { eventId: COMP_SEED.eventMs, seed: -1, separateClubs: false, seeds: 2, reason: 'demo' }],
      ['competition.recordResult', { matchId: COMP_SEED.eventMs, expectedRevision: 1, status: 'won', games: [], walkoverWinner: null, retiringSide: null, reason: 'demo' }],
      ['competition.recordResult', { matchId: COMP_SEED.eventMs, expectedRevision: 1, status: 'completed', games: [{ a: 21, b: 1 }, { a: 21, b: 1 }, { a: 21, b: 1 }, { a: 21, b: 1 }, { a: 21, b: 1 }, { a: 21, b: 1 }], walkoverWinner: null, retiringSide: null, reason: 'demo' }],
      ['competition.recordResult', { matchId: COMP_SEED.eventMs, expectedRevision: 0, status: 'completed', games: [], walkoverWinner: null, retiringSide: null, reason: 'demo' }],
      ['competition.saveMatch', { id: null, expectedRevision: null, eventId: COMP_SEED.eventMs, roundCode: 'F', matchNumber: 1, groupLabel: null, sideA: null, sideB: null, scheduledAt: '2026-11-07 10:00', courtId: null, reason: 'demo' }],
      ['competition.schedule', { tournamentId: SEED.t1, windows: [{ date: '2026-11-07', start: '9am', end: '18:00' }], durationMinutes: 40, restMinutes: 20, save: false, reason: 'demo' }],
      ['competition.computeRanking', { label: 'Demo', category: 'XX', ageGroup: null, asOf: '2026-10-22', reason: 'demo' }],
      ['competition.approvePointsTable', { label: 'Demo', levels: { district: { W: 1.5 } }, windowDays: 364, bestN: 4, reason: 'demo' }],
    ];
    for (const [action, body] of bad) {
      const r = await s.call(action, body);
      expect(r.status, `${action} ${JSON.stringify(body)}`).toBe(400);
      expect((await json(r)).code).toBe('invalid');
    }
    expect(s.store.state.audit.length).toBe(before);
  });
  it('an editor (even when signed in at aal2) is refused', async () => {
    const s = await setup();
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    expect((await s.call('competition.tournaments', {}, editor)).status).toBe(403);
    expect((await s.call('competition.tournaments', {}, null)).status).toBe(401);
  });
});

describe('competition actions: through the handler', () => {
  it('reads, makes and publishes a draw, and returns the engine refusal as words', async () => {
    const s = await setup();
    const list = await json(await s.call('competition.tournaments'));
    expect(list.ok).toBe(true);
    expect(list.data.find((t: { id: string }) => t.id === SEED.t1).events).toHaveLength(2);
    const refused = await s.call('competition.generateDraw', { eventId: COMP_SEED.eventMs, separateClubs: false, seeds: 4, reason: 'demo draw' });
    expect(refused.status).toBe(400);
    expect(await json(refused)).toEqual({ ok: false, code: 'INVALID', errors: { form: 'A draw of 4 lines can have at most 2 seeds.' } });
    const made = await json(await s.call('competition.generateDraw', { eventId: COMP_SEED.eventMs, separateClubs: true, seeds: 2, reason: 'demo draw' }));
    expect(made.data).toMatchObject({ seed: 77, status: 'draft', format: 'knockout' });
    const pub = await json(await s.call('competition.publishDraw', { eventId: COMP_SEED.eventMs, drawId: made.data.drawId, reason: 'demo publish' }));
    expect(pub.data).toMatchObject({ status: 'published', created: 3 });
  });
  it('a stale result form is 409 STALE; an impossible score is 400 with the reason', async () => {
    const s = await setup();
    const made = await json(await s.call('competition.generateDraw', { eventId: COMP_SEED.eventMs, seed: 5, separateClubs: false, seeds: 2, reason: 'demo draw' }));
    await s.call('competition.publishDraw', { eventId: COMP_SEED.eventMs, drawId: made.data.drawId, reason: 'demo publish' });
    const ev = await json(await s.call('competition.event', { eventId: COMP_SEED.eventMs }));
    const m = ev.data.matches[0];
    const impossible = await s.call('competition.recordResult', { matchId: m.id, expectedRevision: m.revision, status: 'completed', games: [{ a: 21, b: 20 }, { a: 21, b: 3 }], walkoverWinner: null, retiringSide: null, reason: 'demo result' });
    expect(impossible.status).toBe(400);
    expect((await json(impossible)).errors?.['games']).toMatch(/21-20|lead|over/i);
    const stale = await s.call('competition.recordResult', { matchId: m.id, expectedRevision: m.revision + 5, status: 'completed', games: [{ a: 21, b: 3 }, { a: 21, b: 3 }], walkoverWinner: null, retiringSide: null, reason: 'demo result' });
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe('STALE');
  });
  it('an unknown event is 404', async () => {
    const s = await setup();
    const r = await s.call('competition.event', { eventId: '00000000-0000-4000-8000-000000000000' });
    expect(r.status).toBe(404);
  });
});
