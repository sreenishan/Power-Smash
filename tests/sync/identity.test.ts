import { describe, expect, it } from 'vitest';
import { resolveVideoIdentity, planSlugRename, participantEffectiveAge, type IdentityDeps } from '../../src/lib/sync/identity';
import { MemoryArchiveStore } from '../../src/lib/sync/memory-archive';
import type { PlayerRow } from '../../src/lib/archive/types';
import { fictionalTitle, storedVideo } from './helpers';

const A1 = 'ARJUN VELMURUGAN';
const B1 = 'DEVAN RAJAN';
const A2 = 'BALA MURUGAN';
const B2 = 'KIRAN MOHAN';

function harness() {
  const store = new MemoryArchiveStore();
  let n = 0;
  const deps: IdentityDeps = {
    store,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
  return { store, deps };
}

function adultPlayer(id: string, displayName: string, norm: string): PlayerRow {
  return {
    id,
    slug: displayName.toLowerCase().replace(/ /gu, '-'),
    slug_kind: 'named',
    display_name: displayName,
    name_normalized: norm,
    name_key: norm,
    latin_key: norm,
    disambiguator: null,
    identity_tier: 'multi_token',
    age_status: 'adult_confirmed',
    age_signal: [],
    age_confirmed_by: 'admin-1',
    age_confirmed_at: '2026-10-01T00:00:00Z',
    age_confirmed_evidence: 'fictional',
    district: null,
    photo_path: null,
    bio: null,
    instagram_handle: null,
    claimed: false,
    noindex: false,
    visibility: 'public',
    is_provisional: false,
    provisional_tournament_id: null,
    merged_into: null,
    created_source: 'admin',
    manual_override: {},
    created_at: '',
    updated_at: '',
  };
}

const alias = (id: string, norm: string, playerId: string, status: 'confirmed' | 'provisional' | 'rejected' = 'confirmed', scopeTournament: string | null = null) => ({
  id,
  alias_normalized: norm,
  player_id: playerId,
  status,
  scope_tournament_id: scopeTournament,
  scope_district: null,
  created_by: 'admin-1',
  created_at: '',
});

describe('creating entities from a Tamil Nadu match (PC-01, PC-11, D-012, D-013)', () => {
  it('makes a pending hidden tournament, protected provisional players with opaque slugs, aliases and a published match', async () => {
    const { store, deps } = harness();
    const v = storedVideo('fake-i001', fictionalTitle([A1], [B1], { category: 'MS', round: 'Final' }));
    const out = await resolveVideoIdentity(v, deps);
    expect(out).toMatchObject({ status: 'resolved', playersCreated: 2, tournamentsCreated: 1, matchWritten: true, reviewReasons: [] });

    const t = [...store.tournaments.values()][0]!;
    expect(t).toMatchObject({ series_key: 'fake cup open', edition_year: 2026, region: 'tamil_nadu', district: 'Madurai', status: 'pending', visibility: 'hidden', source: 'parsed', categories: ['MS'] });
    expect(t.slug).toBe('fake-cup-open-badminton-tournament-2026-madurai');
    expect(store.tournamentAliases.map((a) => a.alias_normalized).sort()).toEqual(['fake cup open', 'fake cup open badminton tournament']);

    const players = [...store.players.values()];
    expect(players).toHaveLength(2);
    for (const p of players) {
      expect(p).toMatchObject({ age_status: 'unknown', is_provisional: true, noindex: true, visibility: 'hidden', slug_kind: 'opaque', district: null, photo_path: null, bio: null, instagram_handle: null, provisional_tournament_id: t.id, created_source: 'parsed' });
      expect(p.slug).toMatch(/^p-[0-9a-f]{16}$/u);
      expect(p.slug).not.toContain('arjun');
    }
    expect(store.playerAliases.every((a) => a.status === 'provisional' && a.scope_tournament_id === t.id)).toBe(true);

    const m = [...store.matches.values()][0]!;
    expect(m).toMatchObject({ video_id: 'fake-i001', tournament_id: t.id, category: 'MS', round: 'F', format: 'singles', publish_state: 'published', minor_hold: false });
    const parts = [...store.participants.values()];
    expect(parts.map((p) => [p.side, p.position, p.resolution, p.link_policy]).sort()).toEqual([
      ['A', 1, 'provisional', 'provisional_ok'],
      ['B', 1, 'provisional', 'provisional_ok'],
    ]);
  });

  it('is idempotent: a second run over the same inputs writes nothing', async () => {
    const { store, deps } = harness();
    const v = storedVideo('fake-i002', fictionalTitle([A1, A2], [B1, B2], { category: 'MD', round: 'SF' }));
    await resolveVideoIdentity(v, deps);
    const snapshot = JSON.stringify([[...store.tournaments], [...store.players], store.playerAliases, [...store.matches], [...store.participants].map(([, p]) => [p.side, p.position, p.player_id, p.resolution]), store.audit]);
    const again = await resolveVideoIdentity(v, deps);
    expect(again).toMatchObject({ status: 'resolved', playersCreated: 0, tournamentsCreated: 0, matchWritten: false, changed: false, candidates: 0 });
    const after = JSON.stringify([[...store.tournaments], [...store.players], store.playerAliases, [...store.matches], [...store.participants].map(([, p]) => [p.side, p.position, p.player_id, p.resolution]), store.audit]);
    expect(after).toBe(snapshot);
    expect(store.players.size).toBe(4);
  });

  it('a second video of the same edition reuses the provisional players and the tournament', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-i003', fictionalTitle([A1], [B1], { category: 'MS', round: 'QF' })), deps);
    const out = await resolveVideoIdentity(storedVideo('fake-i004', fictionalTitle([A1], [B1], { category: 'MS', round: 'SF' })), deps);
    expect(out).toMatchObject({ playersCreated: 0, tournamentsCreated: 0, matchWritten: true });
    expect(store.players.size).toBe(2);
    expect(store.tournaments.size).toBe(1);
    expect(store.matches.size).toBe(2);
  });

  it('a different edition makes NEW provisional players (never an auto-merge) and writes duplicate candidates for the admin', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-i005', fictionalTitle([A1], [B1], { year: 2025 })), deps);
    const out = await resolveVideoIdentity(storedVideo('fake-i006', fictionalTitle([A1], [B1], { year: 2026 })), deps);
    expect(store.players.size).toBe(4);
    expect(out.playersCreated).toBe(2);
    expect(out.candidates).toBe(2);
    const rows = store.audit.filter((a) => a.action === 'possible_duplicate');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor === 'sync' && r.entity === 'player' && (r.diff as { reason: string }).reason === 'same_name_key')).toBe(true);
    // no name in the audit rows
    expect(JSON.stringify(rows)).not.toMatch(/arjun|devan|velmurugan/iu);
    // nothing was merged
    expect([...store.players.values()].every((p) => p.merged_into === null)).toBe(true);
  });

  it('close spellings become weak or strong candidates, never merges', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-i007', fictionalTitle(['ARJUN VELMURUGAN'], [B1], { year: 2025 })), deps);
    const out = await resolveVideoIdentity(storedVideo('fake-i008', fictionalTitle(['ARJUN VELMURUGANN'], ['SURESH KANNAN'], { year: 2026 })), deps);
    expect(out.candidates).toBeGreaterThanOrEqual(1);
    const row = store.audit.find((a) => a.action === 'possible_duplicate')!;
    expect((row.diff as { reason: string }).reason).toBe('close_spelling');
    expect([...store.players.values()].every((p) => p.merged_into === null)).toBe(true);
  });
});

describe('which videos get entities (D-018, owner decision, PC-16, PC-17)', () => {
  it('a non-Tamil-Nadu event gets nothing', async () => {
    const { store, deps } = harness();
    const v = storedVideo('fake-n001', fictionalTitle([A1], [B1], { place: 'Bangalore' }));
    expect(v.visibility).toBe('listed_no_player_pages');
    expect(await resolveVideoIdentity(v, deps)).toMatchObject({ status: 'skipped', skip: 'listed_only', changed: false });
    expect([store.players.size, store.tournaments.size, store.matches.size, store.participants.size]).toEqual([0, 0, 0, 0]);
  });

  it('an event with no detectable place is listed but gets no players or tournaments', async () => {
    const { store, deps } = harness();
    const v = storedVideo('fake-n002', fictionalTitle([A1], [B1], { place: null }));
    expect(v.visibility).toBe('listed_no_player_pages');
    expect(await resolveVideoIdentity(v, deps)).toMatchObject({ skip: 'listed_only' });
    expect(store.players.size + store.tournaments.size + store.matches.size).toBe(0);
  });

  it('even when a lock made the video public, a non-Tamil-Nadu event gets nothing', async () => {
    const { store, deps } = harness();
    const v = storedVideo('fake-n003', fictionalTitle([A1], [B1], { place: 'Bangalore' }), { visibility: 'public' });
    expect(await resolveVideoIdentity(v, deps)).toMatchObject({ skip: 'listed_only' });
    expect(store.players.size).toBe(0);
  });

  it('an international broadcast, a hidden video and a non-match get nothing', async () => {
    const { store, deps } = harness();
    const intl = storedVideo('fake-n004', 'ANTHONY SINISUKA GINTING (INA) vs KENTO MOMOTA (JPN) || BWF World Tour Finals 2026');
    expect(await resolveVideoIdentity(intl, deps)).toMatchObject({ skip: 'international' });
    const hidden = storedVideo('fake-n005', fictionalTitle([A1], [B1]), { visibility: 'hidden' });
    expect(await resolveVideoIdentity(hidden, deps)).toMatchObject({ skip: 'not_public' });
    const other = storedVideo('fake-n006', 'Fake smash drill compilation');
    expect(await resolveVideoIdentity(other, deps)).toMatchObject({ skip: 'not_match' });
    expect(store.players.size + store.tournaments.size + store.matches.size).toBe(0);
  });

  it('single-token, same-name-on-both-sides and doubles partners follow the link policy', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-n007', fictionalTitle(['GANESH'], ['KIRAN'])), deps);
    expect(store.players.size).toBe(0); // single tokens never create a player (PC-01)
    expect([...store.participants.values()].map((p) => [p.resolution, p.player_id, p.link_policy])).toEqual([
      ['plain_text', null, 'plain_text_only'],
      ['plain_text', null, 'plain_text_only'],
    ]);
    const { store: s2, deps: d2 } = harness();
    await resolveVideoIdentity(storedVideo('fake-n008', fictionalTitle([A1], [A1])), d2);
    expect(s2.players.size).toBe(0);
    expect([...s2.participants.values()].map((p) => p.resolution)).toEqual(['blocked', 'blocked']);
    expect([...s2.matches.values()][0]!.publish_state).toBe('held'); // a hard flag holds the match
  });
});

describe('exact-alias tiers (PC-02): confirmed links, ambiguous waits, rejected never links', () => {
  function seeded() {
    const h = harness();
    h.store.players.set('p-adult-1', adultPlayer('p-adult-1', 'Arjun Velmurugan', 'arjun velmurugan'));
    h.store.playerAliases.push(alias('a-1', 'arjun velmurugan', 'p-adult-1'));
    return h;
  }

  it('one confirmed alias links with resolution exact_alias and creates no new player for that name', async () => {
    const { store, deps } = seeded();
    const out = await resolveVideoIdentity(storedVideo('fake-a001', fictionalTitle([A1], [B1])), deps);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a).toMatchObject({ player_id: 'p-adult-1', resolution: 'exact_alias', link_policy: 'provisional_ok' });
    expect(out.playersCreated).toBe(1); // only the opponent
  });

  it('two candidate players is AMBIGUOUS_ALIAS: nothing linked, match held, reason returned for the review queue', async () => {
    const { store, deps } = seeded();
    store.players.set('p-adult-2', adultPlayer('p-adult-2', 'Arjun Velmurugan', 'arjun velmurugan'));
    store.playerAliases.push(alias('a-2', 'arjun velmurugan', 'p-adult-2'));
    const out = await resolveVideoIdentity(storedVideo('fake-a002', fictionalTitle([A1], [B1])), deps);
    expect(out.reviewReasons).toEqual(['AMBIGUOUS_ALIAS']);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a).toMatchObject({ player_id: null, resolution: 'plain_text' });
    expect([...store.matches.values()][0]!.publish_state).toBe('held');
  });

  it('a rejected alias never links (a split sticks)', async () => {
    const { store, deps } = seeded();
    store.playerAliases.length = 0;
    store.playerAliases.push(alias('a-3', 'arjun velmurugan', 'p-adult-1', 'rejected'));
    await resolveVideoIdentity(storedVideo('fake-a003', fictionalTitle([A1], [B1])), deps);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a.player_id).not.toBe('p-adult-1');
  });

  it('an alias scoped to another tournament does not link', async () => {
    const { store, deps } = seeded();
    store.playerAliases.length = 0;
    store.playerAliases.push(alias('a-4', 'arjun velmurugan', 'p-adult-1', 'confirmed', 'some-other-tournament'));
    await resolveVideoIdentity(storedVideo('fake-a004', fictionalTitle([A1], [B1])), deps);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a.player_id).not.toBe('p-adult-1');
  });

  it('an adult_confirmed player is never changed by a minor signal: the participation carries it and the effective status is stricter', async () => {
    const { store, deps } = seeded();
    await resolveVideoIdentity(storedVideo('fake-a005', fictionalTitle([A1], [B1], { tournament: 'Fake Cup U13 Badminton Tournament' })), deps);
    const player = store.players.get('p-adult-1')!;
    expect(player.age_status).toBe('adult_confirmed');
    expect(player.age_signal).toEqual([]);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a.age_status).toBe('minor_suspected');
    expect(participantEffectiveAge(a.age_status, player.age_status)).toBe('minor_suspected');
    expect([...store.matches.values()][0]).toMatchObject({ minor_hold: true, publish_state: 'held' });
  });
});

describe('protected inheritance (D-012)', () => {
  it('a minor signal raises a protected player and the status sticks for later matches without the signal', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-p001', fictionalTitle([A1], [B1], { category: 'MS', round: 'QF' })), deps);
    expect([...store.players.values()].map((p) => p.age_status)).toEqual(['unknown', 'unknown']);
    // same edition, a junior category: the SAME players are raised to minor_suspected and signals accumulate
    await resolveVideoIdentity(storedVideo('fake-p002', fictionalTitle([A1], [B1], { category: 'BS', round: 'SF' })), deps);
    const players = [...store.players.values()];
    expect(players).toHaveLength(2);
    expect(players.every((p) => p.age_status === 'minor_suspected')).toBe(true);
    expect(players.every((p) => p.age_signal.some((s) => s.startsWith('junior_category:')))).toBe(true);
    expect(players.every((p) => p.slug_kind === 'opaque' && p.visibility === 'hidden' && p.noindex)).toBe(true);
    // a later match with no signal: participation unknown, effective status still minor_suspected, never lowered
    await resolveVideoIdentity(storedVideo('fake-p003', fictionalTitle([A1], [B1], { category: 'MS', round: 'F' })), deps);
    const m3 = [...store.matches.values()].find((m) => m.video_id === 'fake-p003')!;
    const parts = [...store.participants.values()].filter((p) => p.match_id === m3.id);
    expect(parts.every((p) => p.age_status === 'unknown')).toBe(true);
    for (const p of parts) expect(participantEffectiveAge(p.age_status, store.players.get(p.player_id!)!.age_status)).toBe('minor_suspected');
    expect([...store.players.values()].every((p) => p.age_status === 'minor_suspected')).toBe(true);
  });

  it('a new player from a minor-signal title starts minor_suspected and the match is held', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-p004', fictionalTitle([A1], [B1], { tournament: 'Fake Cup U13 Badminton Tournament' })), deps);
    const players = [...store.players.values()];
    expect(players.map((p) => p.age_status)).toEqual(['minor_suspected', 'minor_suspected']);
    expect([...store.matches.values()][0]).toMatchObject({ minor_hold: true, publish_state: 'held' });
    expect([...store.tournaments.values()][0]!.is_minor_signal).toBe(true);
  });
});

describe('suppression (D-014)', () => {
  it('a suppressed name is never linked or created and leaves no readable name in the match', async () => {
    const { store, deps } = harness();
    store.suppressedNameSet.add('arjun velmurugan');
    await resolveVideoIdentity(storedVideo('fake-s001', fictionalTitle([A1], [B1])), deps);
    expect([...store.players.values()].map((p) => p.name_normalized)).toEqual(['devan rajan']);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a).toMatchObject({ player_id: null, resolution: 'suppressed', raw_name: '[withheld]' });
    expect(JSON.stringify([...store.participants.values()])).not.toMatch(/velmurugan/iu);
  });

  it('a confirmed alias of a suppressed player id is not linked', async () => {
    const { store, deps } = harness();
    store.players.set('p-adult-9', adultPlayer('p-adult-9', 'Arjun Velmurugan', 'arjun velmurugan'));
    store.playerAliases.push(alias('a-9', 'arjun velmurugan', 'p-adult-9'));
    store.suppressedPlayerSet.add('p-adult-9');
    await resolveVideoIdentity(storedVideo('fake-s002', fictionalTitle([A1], [B1])), deps);
    const a = [...store.participants.values()].find((p) => p.side === 'A')!;
    expect(a).toMatchObject({ player_id: null, resolution: 'suppressed' });
  });

  it('a suppressed tournament is not linked to the match', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-s003', fictionalTitle([A1], [B1])), deps);
    const t = [...store.tournaments.values()][0]!;
    store.suppressedTournamentSet.add(t.id);
    await resolveVideoIdentity(storedVideo('fake-s004', fictionalTitle([A1], [B1], { round: 'F' })), deps);
    expect([...store.matches.values()].find((m) => m.video_id === 'fake-s004')!.tournament_id).toBeNull();
  });
});

describe('manual work is never overwritten', () => {
  it('locked match fields keep their value; unlocked ones follow the parse', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-m001', fictionalTitle([A1], [B1], { category: 'MS', round: 'QF' })), deps);
    const m = [...store.matches.values()][0]!;
    m.category = 'WS';
    m.manual_override = { category: true };
    await resolveVideoIdentity(storedVideo('fake-m001', fictionalTitle([A1], [B1], { category: 'MS', round: 'SF' })), deps);
    const after = [...store.matches.values()][0]!;
    expect(after.category).toBe('WS');
    expect(after.round).toBe('SF');
  });

  it('a locked participant list and a hand-linked slot are not rewritten', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-m002', fictionalTitle([A1], [B1])), deps);
    const m = [...store.matches.values()][0]!;
    const before = JSON.stringify([...store.participants.values()]);
    m.manual_override = { participants: true };
    await resolveVideoIdentity(storedVideo('fake-m002', fictionalTitle(['SURESH KANNAN'], ['MANI SELVAN'])), deps);
    expect(JSON.stringify([...store.participants.values()])).toBe(before);

    // without the full lock, a slot an admin linked by hand (resolution manual) is kept
    m.manual_override = {};
    const slotA = [...store.participants.values()].find((p) => p.side === 'A')!;
    slotA.resolution = 'manual';
    slotA.raw_name = 'Hand Linked';
    await resolveVideoIdentity(storedVideo('fake-m002', fictionalTitle(['SURESH KANNAN'], ['MANI SELVAN'])), deps);
    const now = [...store.participants.values()];
    expect(now.find((p) => p.side === 'A')!.raw_name).toBe('Hand Linked');
    expect(now.find((p) => p.side === 'B')!.raw_name).toBe('MANI SELVAN');
  });

  it('never promotes a held match, but demotes a published one that gains a minor hold', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-m003', fictionalTitle([A1], [B1], { category: 'MS' })), deps);
    const m = [...store.matches.values()][0]!;
    expect(m.publish_state).toBe('published');
    m.publish_state = 'held'; // the admin (or an earlier review) holds it
    await resolveVideoIdentity(storedVideo('fake-m003', fictionalTitle([A1], [B1], { category: 'MS' })), deps);
    expect([...store.matches.values()][0]!.publish_state).toBe('held');

    const { store: s2, deps: d2 } = harness();
    await resolveVideoIdentity(storedVideo('fake-m004', fictionalTitle([A1], [B1], { category: 'MS' })), d2);
    expect([...s2.matches.values()][0]!.publish_state).toBe('published');
    await resolveVideoIdentity(storedVideo('fake-m004', fictionalTitle([A1], [B1], { tournament: 'Fake Cup U13 Badminton Tournament' })), d2);
    expect([...s2.matches.values()][0]).toMatchObject({ publish_state: 'held', minor_hold: true });
  });

  it('respects auto_publish_clean_parses = false: new matches are held', async () => {
    const { store, deps } = harness();
    store.settings.auto_publish_clean_parses = 'false';
    await resolveVideoIdentity(storedVideo('fake-m005', fictionalTitle([A1], [B1])), deps);
    expect([...store.matches.values()][0]!.publish_state).toBe('held');
  });
});

describe('tournaments: series and edition matching by alias (PC-11)', () => {
  it('a spelling variant registered as an alias resolves to the existing edition instead of a new tournament', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-t001', fictionalTitle([A1], [B1])), deps);
    const t = [...store.tournaments.values()][0]!;
    await store.addTournamentAlias('fake cup championship badminton tournament', t.id);
    const out = await resolveVideoIdentity(storedVideo('fake-t002', fictionalTitle([A2], [B2], { tournament: 'Fake Cup Championship Badminton Tournament' })), deps);
    expect(out.tournamentsCreated).toBe(0);
    expect(store.tournaments.size).toBe(1);
    expect([...store.matches.values()].find((m) => m.video_id === 'fake-t002')!.tournament_id).toBe(t.id);
  });

  it('the alias matches only the same edition year', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-t003', fictionalTitle([A1], [B1], { year: 2025 })), deps);
    const t = [...store.tournaments.values()][0]!;
    await store.addTournamentAlias('fake cup championship badminton tournament', t.id);
    await resolveVideoIdentity(storedVideo('fake-t004', fictionalTitle([A2], [B2], { year: 2026, tournament: 'Fake Cup Championship Badminton Tournament' })), deps);
    expect(store.tournaments.size).toBe(2);
  });

  it('two editions reachable through one alias is ambiguous: no tournament linked, reason raised', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-t005', fictionalTitle([A1], [B1], { tournament: 'Fake Cup Open Badminton Tournament' })), deps);
    await resolveVideoIdentity(storedVideo('fake-t006', fictionalTitle([A1], [B1], { tournament: 'Sample Shield Badminton Tournament' })), deps);
    const [t1, t2] = [...store.tournaments.values()];
    await store.addTournamentAlias('shared name', t1!.id);
    await store.addTournamentAlias('shared name', t2!.id);
    const out = await resolveVideoIdentity(storedVideo('fake-t007', fictionalTitle([A2], [B2], { tournament: 'Shared Name Badminton Tournament' })), deps);
    // 'shared name' is the series key of that title; both editions are 2026 so the alias is ambiguous
    expect(out.reviewReasons).toEqual(['AMBIGUOUS_ALIAS']);
    expect([...store.matches.values()].find((m) => m.video_id === 'fake-t007')!.tournament_id).toBeNull();
  });

  it('a slug collision gets a counter, never overwrites', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-t008', fictionalTitle([A1], [B1])), deps);
    const first = [...store.tournaments.values()][0]!;
    // another series that already owns the slug text this title would produce (no alias, different key)
    store.tournaments.delete(first.id);
    await store.insertTournament({ ...first, id: '00000000-0000-4000-8000-0000000000aa', series_key: 'other series', slug: first.slug });
    await resolveVideoIdentity(storedVideo('fake-t009', fictionalTitle([A2], [B2])), deps);
    expect([...store.tournaments.values()].map((t) => t.slug).sort()).toEqual(['fake-cup-open-badminton-tournament-2026-madurai', 'fake-cup-open-badminton-tournament-2026-madurai-2']);
  });

  it('an existing tournament only gains categories and a minor signal, and never loses data', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-t010', fictionalTitle([A1], [B1], { category: 'MS' })), deps);
    await resolveVideoIdentity(storedVideo('fake-t011', fictionalTitle([A2], [B2], { category: 'WS' })), deps);
    const t = [...store.tournaments.values()][0]!;
    expect(t.categories).toEqual(['MS', 'WS']);
    expect(t.is_minor_signal).toBe(false);
  });
});

describe('slug rename (PC-14)', () => {
  it('redirects the old path to the new one and flattens an earlier hop', () => {
    const rows = planSlugRename('tournament', [{ from_path: '/tournaments/first/', to_path: '/tournaments/second/', http_status: 301 }], 'second', 'third', 'tid-1');
    expect(rows).toEqual(
      expect.arrayContaining([
        { from_path: '/tournaments/second/', to_path: '/tournaments/third/', http_status: 301, entity_type: 'tournament', entity_id: 'tid-1' },
        { from_path: '/tournaments/first/', to_path: '/tournaments/third/', http_status: 301, entity_type: 'tournament', entity_id: 'tid-1' },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('nothing to do when the slug did not change', () => {
    expect(planSlugRename('player', [], 'same', 'same', 'x')).toEqual([]);
  });
});

describe('match duplicates (PC-19)', () => {
  it('the same match in another video is recorded for the admin and duplicate_of is NOT set', async () => {
    const { store, deps } = harness();
    await resolveVideoIdentity(storedVideo('fake-d001', fictionalTitle([A1], [B1], { category: 'MS', round: 'F' })), deps);
    const out = await resolveVideoIdentity(storedVideo('fake-d002', fictionalTitle([A1], [B1], { category: 'MS', round: 'F' })), deps);
    expect(out.candidates).toBeGreaterThanOrEqual(1);
    expect(store.audit.some((a) => a.action === 'possible_duplicate_match')).toBe(true);
    expect([...store.matches.values()].every((m) => m.duplicate_of === null)).toBe(true);
  });
});
