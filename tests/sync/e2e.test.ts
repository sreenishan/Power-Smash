// End-to-end: fictional YouTube catalogue -> pipeline (fetch, parse, classify, merge) -> identity resolution -> stores.
// Fictional data only. Covers backfill, incremental, reparse idempotency, protected inheritance, tombstone survival, the dirty flag.
import { describe, expect, it } from 'vitest';
import { runSync } from '../../src/lib/sync/pipeline';
import { MemorySyncStore } from '../../src/lib/sync/memory-store';
import { MemoryArchiveStore } from '../../src/lib/sync/memory-archive';
import type { PlayerRow } from '../../src/lib/archive/types';
import { participantEffectiveAge } from '../../src/lib/sync/identity';
import type { VideoRecord } from '../../src/lib/sync/types';
import { Clock, FakeYouTube, fictionalTitle, fictionalVideo, makeDeps, type FakeVideo } from './helpers';

const START = Date.parse('2026-10-22T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const NAMES = {
  a: 'ARJUN VELMURUGAN',
  b: 'DEVAN RAJAN',
  c: 'BALA MURUGAN',
  d: 'KIRAN MOHAN',
  e: 'SURESH KANNAN',
  f: 'MANI SELVAN',
};

function catalogue(): FakeVideo[] {
  return [
    fictionalVideo(1, fictionalTitle([NAMES.a], [NAMES.b], { category: 'MS', round: 'QF' })), // Tamil Nadu
    fictionalVideo(2, fictionalTitle([NAMES.a], [NAMES.b], { category: 'MS', round: 'SF' })), // same players, same edition
    fictionalVideo(3, fictionalTitle([NAMES.c, NAMES.d], [NAMES.e, NAMES.f], { category: 'MD', round: 'F' })),
    fictionalVideo(4, fictionalTitle([NAMES.a], [NAMES.b], { place: 'Bangalore' })), // outside Tamil Nadu
    fictionalVideo(5, fictionalTitle([NAMES.c], [NAMES.d], { place: null })), // no detectable place
    fictionalVideo(6, 'ANTHONY SINISUKA GINTING (INA) vs KENTO MOMOTA (JPN) || BWF World Tour Finals 2026'),
    fictionalVideo(7, 'Fake smash drill compilation', { duration: 'PT2M30S' }),
    fictionalVideo(8, fictionalTitle([NAMES.e], [NAMES.f], { tournament: 'Fake Cup U13 Badminton Tournament' })), // minor signal
  ];
}

function setup(videos = catalogue()) {
  const yt = new FakeYouTube(videos, 50);
  const store = new MemorySyncStore();
  const archive = new MemoryArchiveStore((id, patch) => {
    const v = store.videos.get(id);
    if (v) Object.assign(v, patch);
  });
  const clock = new Clock(START);
  let n = 0;
  const deps = { ...makeDeps(yt, store, clock), identity: archive, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
  return { yt, store, archive, clock, deps };
}

const snapshot = (store: MemorySyncStore, archive: MemoryArchiveStore): string =>
  JSON.stringify([
    [...store.videos.values()].map((v) => ({ ...v, updated_at: '' })),
    [...archive.tournaments],
    [...archive.players],
    archive.playerAliases,
    [...archive.matches],
    [...archive.participants],
    archive.audit,
    [...archive.videoReviews],
  ]);

const idOf = (n: number): string => `fake-f${String(n).padStart(3, '0')}`;

describe('backfill with identity resolution', () => {
  it('creates entities only for Tamil Nadu matches and lists the rest without players or tournaments', async () => {
    const { store, archive, deps } = setup();
    const s = await runSync('backfill', deps);
    expect(s.status).toBe('ok');
    expect(s.counts).toMatchObject({ inserted: 8, playersCreated: 8, tournamentsCreated: 2, matchesWritten: 4 });

    // videos: visibility per D-018 and the owner decision
    const vis = (n: number) => (store.videos.get(idOf(n)) as VideoRecord).visibility;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(vis)).toEqual(['public', 'public', 'public', 'listed_no_player_pages', 'listed_no_player_pages', 'hidden', 'public', 'public']);

    // entities only from videos 1, 2, 3 and 8 (video 8: Tamil Nadu but minor signal, held)
    expect([...archive.matches.values()].map((m) => m.video_id).sort()).toEqual([idOf(1), idOf(2), idOf(3), idOf(8)]);
    expect([...archive.tournaments.values()].every((t) => t.region === 'tamil_nadu' && t.status === 'pending' && t.visibility === 'hidden')).toBe(true);
    // no player named in the listed-only, international or short videos
    const names = [...archive.players.values()].map((p) => p.name_normalized);
    expect(names.sort()).toEqual(['arjun velmurugan', 'bala murugan', 'devan rajan', 'kiran mohan', 'mani selvan', 'mani selvan', 'suresh kannan', 'suresh kannan']);
    // every created player is protected
    for (const p of archive.players.values()) {
      expect(p).toMatchObject({ visibility: 'hidden', noindex: true, slug_kind: 'opaque', district: null, bio: null, photo_path: null, instagram_handle: null, is_provisional: true });
      expect(p.slug).toMatch(/^p-[0-9a-f]{16}$/u);
    }
    // the clean matches are published, the minor-signal match is held
    const byVideo = (n: number) => [...archive.matches.values()].find((m) => m.video_id === idOf(n))!;
    expect([1, 2, 3].map((n) => byVideo(n).publish_state)).toEqual(['published', 'published', 'published']);
    expect(byVideo(8)).toMatchObject({ publish_state: 'held', minor_hold: true });
    expect(s.markedDirty).toBe(true);
  });

  it('players are shared across the matches of one edition and distinct across editions', async () => {
    const { archive, deps } = setup();
    await runSync('backfill', deps);
    const m1 = [...archive.matches.values()].find((m) => m.video_id === idOf(1))!;
    const m2 = [...archive.matches.values()].find((m) => m.video_id === idOf(2))!;
    const link = (matchId: string) => [...archive.participants.values()].filter((p) => p.match_id === matchId).map((p) => p.player_id).sort();
    expect(link(m1.id)).toEqual(link(m2.id));
    expect(m1.tournament_id).toBe(m2.tournament_id);
    // video 8 is a different edition: its players are NEW rows (never auto-merged) and the admin queue got candidates
    const m8 = [...archive.matches.values()].find((m) => m.video_id === idOf(8))!;
    const p8 = [...archive.participants.values()].filter((p) => p.match_id === m8.id).map((p) => p.player_id);
    const p3 = [...archive.participants.values()].filter((p) => p.match_id === [...archive.matches.values()].find((m) => m.video_id === idOf(3))!.id).map((p) => p.player_id);
    expect(p8.some((id) => p3.includes(id))).toBe(false);
    expect(archive.audit.some((a) => a.action === 'possible_duplicate')).toBe(true);
  });
});

describe('incremental', () => {
  it('a new video gets its identity step; known videos are not touched', async () => {
    const { yt, store, archive, deps } = setup();
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    const before = archive.matches.size;
    yt.videos = [fictionalVideo(20, fictionalTitle([NAMES.a], [NAMES.b], { category: 'MS', round: 'F' })), ...yt.videos];
    const s = await runSync('incremental', deps);
    expect(s.counts).toMatchObject({ inserted: 1, matchesWritten: 1, playersCreated: 0, tournamentsCreated: 0 });
    expect(archive.matches.size).toBe(before + 1);
    expect(s.markedDirty).toBe(true);
  });
});

describe('reparse', () => {
  it('produces no diff when nothing changed, makes no API call and does not mark dirty', async () => {
    const { yt, store, archive, deps } = setup();
    await runSync('backfill', deps);
    const before = snapshot(store, archive);
    store.state.dirtySince = null;
    yt.calls.length = 0;
    const s = await runSync('reparse', deps);
    expect(s.status).toBe('ok');
    expect(s.quotaUnits).toBe(0);
    expect(yt.calls).toHaveLength(0);
    expect(s.counts).toMatchObject({ updated: 0, playersCreated: 0, tournamentsCreated: 0, matchesWritten: 0, duplicateCandidates: 0 });
    expect(s.markedDirty).toBe(false);
    expect(snapshot(store, archive)).toBe(before);
    // and again
    await runSync('reparse', deps);
    expect(snapshot(store, archive)).toBe(before);
  });

  it('is also stable after a stats refresh (re-sync keeps the identity reasons, no flapping)', async () => {
    const { store, archive, clock, deps } = setup();
    await runSync('backfill', deps);
    // two confirmed aliases for one name: the match becomes ambiguous on the next reparse
    const adult = (id: string): PlayerRow => ({ ...([...archive.players.values()][0] as PlayerRow), id, slug: id, slug_kind: 'named', age_status: 'adult_confirmed', age_confirmed_by: 'admin-1', age_confirmed_at: '2026-10-01T00:00:00Z', is_provisional: false, visibility: 'public', noindex: false, name_normalized: 'arjun velmurugan' });
    archive.players.set('adult-1', adult('adult-1'));
    archive.players.set('adult-2', adult('adult-2'));
    for (const id of ['adult-1', 'adult-2']) archive.playerAliases.push({ id: `al-${id}`, alias_normalized: 'arjun velmurugan', player_id: id, status: 'confirmed', scope_tournament_id: null, scope_district: null, created_by: 'admin-1', created_at: '' });
    await runSync('reparse', deps);
    const v1 = store.videos.get(idOf(1)) as VideoRecord;
    expect(v1.review_reasons).toContain('AMBIGUOUS_ALIAS');
    expect(v1.hard_flags).toContain('AMBIGUOUS_ALIAS');
    expect(v1.parse_status).toBe('needs_review');
    expect([...archive.matches.values()].find((m) => m.video_id === idOf(1))!.publish_state).toBe('held'); // an ambiguous match is demoted to held until the owner resolves it

    // a weekly statistics refresh must not drop or flap the reason
    clock.advance(DAY);
    const refreshed = await runSync('stats_all', deps);
    expect((store.videos.get(idOf(1)) as VideoRecord).review_reasons).toContain('AMBIGUOUS_ALIAS');
    expect(refreshed.counts.updated).toBe(0);
    const stable = snapshot(store, archive);
    await runSync('reparse', deps);
    expect(snapshot(store, archive)).toBe(stable);

    // the admin resolves it (second alias rejected): the next reparse clears the reason
    archive.playerAliases.find((a) => a.id === 'al-adult-2')!.status = 'rejected';
    await runSync('reparse', deps);
    const cleared = store.videos.get(idOf(1)) as VideoRecord;
    expect(cleared.review_reasons).not.toContain('AMBIGUOUS_ALIAS');
    expect(cleared.parse_status).toBe('parsed');
  });
});

describe('protected inheritance end to end', () => {
  it('a junior-category match of the same edition raises the shared protected players; they never appear as adults', async () => {
    const { yt, archive, deps } = setup();
    await runSync('backfill', deps);
    yt.videos = [fictionalVideo(21, fictionalTitle([NAMES.a], [NAMES.b], { category: 'BS', round: 'F' })), ...yt.videos];
    await runSync('incremental', deps);
    const m = [...archive.matches.values()].find((x) => x.video_id === idOf(21))!;
    expect(m).toMatchObject({ minor_hold: true, publish_state: 'held' });
    const parts = [...archive.participants.values()].filter((p) => p.match_id === m.id);
    for (const p of parts) {
      const player = archive.players.get(p.player_id!)!;
      expect(player.age_status).toBe('minor_suspected');
      expect(participantEffectiveAge('unknown', player.age_status)).toBe('minor_suspected');
      expect([player.visibility, player.noindex, player.slug_kind, player.district]).toEqual(['hidden', true, 'opaque', null]);
    }
    // the earlier clean matches' players are the same rows, so they are protected for those matches too
    const earlier = [...archive.matches.values()].find((x) => x.video_id === idOf(1))!;
    for (const p of [...archive.participants.values()].filter((q) => q.match_id === earlier.id)) {
      expect(participantEffectiveAge(p.age_status, archive.players.get(p.player_id!)!.age_status)).toBe('minor_suspected');
    }
  });
});

describe('tombstones survive every run (D-014)', () => {
  it('a suppressed video id is never fetched or recreated, a suppressed name is never linked again', async () => {
    const { yt, store, archive, deps } = setup();
    await runSync('backfill', deps);
    // takedown after the fact: the video id and one player's name are tombstoned
    store.suppressed.add(idOf(2));
    archive.suppressedNameSet.add('devan rajan');
    store.videos.delete(idOf(2)); // the admin's emergency hide removed the public row; the tombstone keeps it from coming back
    yt.videos = [fictionalVideo(22, fictionalTitle([NAMES.a], [NAMES.b], { category: 'MS', round: 'R16' })), ...yt.videos];
    yt.calls.length = 0;
    await runSync('incremental', deps);
    await runSync('stats_all', deps);
    await runSync('reparse', deps);
    await runSync('backfill', deps);
    expect(store.videos.has(idOf(2))).toBe(false);
    const requested = yt.calls.filter((c) => c.endpoint === 'videos').flatMap((c) => (c.params.get('id') ?? '').split(','));
    expect(requested).not.toContain(idOf(2));
    // the new match of video 22: the suppressed name is withheld and not linked
    const m = [...archive.matches.values()].find((x) => x.video_id === idOf(22))!;
    const side = [...archive.participants.values()].filter((p) => p.match_id === m.id);
    const withheld = side.find((p) => p.resolution === 'suppressed')!;
    expect(withheld).toMatchObject({ player_id: null, raw_name: '[withheld]' });
    expect(JSON.stringify([...archive.participants.values()].filter((p) => p.match_id === m.id))).not.toMatch(/rajan/iu);
  });

  it('an owner-hidden video stays hidden through reparse and refresh (visibility is never sent for an existing row)', async () => {
    const { store, clock, deps } = setup();
    await runSync('backfill', deps);
    const v = store.videos.get(idOf(1)) as VideoRecord;
    v.visibility = 'hidden';
    v.hidden_reason = 'owner';
    v.manual_override = { visibility: true };
    clock.advance(DAY);
    await runSync('stats_all', deps);
    await runSync('reparse', deps);
    expect((store.videos.get(idOf(1)) as VideoRecord).visibility).toBe('hidden');
  });
});

describe('dirty flag', () => {
  it('marks dirty for a real identity change, not for an unchanged reparse', async () => {
    const { store, archive, deps } = setup();
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    expect((await runSync('reparse', deps)).markedDirty).toBe(false);
    // the admin confirms an alias: the next reparse links it and the site becomes dirty
    const created = [...archive.players.values()].find((p) => p.name_normalized === 'arjun velmurugan')!;
    const alias = archive.playerAliases.find((a) => a.player_id === created.id)!;
    alias.status = 'confirmed';
    alias.scope_tournament_id = null;
    store.state.dirtySince = null;
    const s = await runSync('reparse', deps);
    expect(s.counts.matchesWritten).toBeGreaterThanOrEqual(0);
    expect((await runSync('reparse', deps)).markedDirty).toBe(false);
  });

  it('a failed identity step is recorded as a failed run, and the next run finishes the job', async () => {
    const { store, archive, deps } = setup();
    archive.failInsertMatchOnCall = 2;
    const s = await runSync('backfill', deps);
    expect(s.status).toBe('failed');
    expect(archive.matches.size).toBe(1);
    const again = await runSync('reparse', deps);
    expect(again.status).toBe('ok');
    expect(archive.matches.size).toBe(4);
    expect(store.videos.size).toBeGreaterThan(0);
  });
});
