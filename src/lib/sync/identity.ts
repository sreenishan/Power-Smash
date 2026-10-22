/**
 * IDENTITY RESOLUTION (spec 10.5): from a stored video's `parse_result` to tournaments, players, aliases, matches and
 * match_participants. Pure logic over an `IdentityStore`; no I/O of its own.
 *
 * Rules (each has a test in tests/sync/identity.test.ts):
 *  - Only a detected TAMIL NADU match video that is `public` gets entities (D-018; owner decision: no detectable place = listed, no
 *    player pages). International, non-match, team-tie and ambiguous-VS parses never create anything (PC-16, PC-17).
 *  - Exact-alias tiers only (PC-01, PC-02, D-013): one confirmed in-scope alias links; two or more candidates are AMBIGUOUS_ALIAS
 *    (nothing linked, owner queue); two or more name tokens with no alias make a PROVISIONAL player scoped to the tournament
 *    edition; single tokens, initials, truncated and blocked names stay plain text. Nothing is ever merged on similarity: fuzzy
 *    neighbours are only WRITTEN as possible-duplicate candidates for the admin queue.
 *  - Age (D-012): the parser only emits `unknown` or `minor_suspected`; a new player starts `unknown`, is PROTECTED (opaque slug,
 *    no profile data, noindex, hidden) until an admin confirms an adult, and a minor signal only RAISES a protected player.
 *    An adult_confirmed player is never changed by the sync: the participation carries the signal and the views take the stricter.
 *  - Manual work is never overwritten: `matches.manual_override` locks (including `participants`), `resolution = manual` slots,
 *    and every `publish_state` an admin chose (the sync never promotes a held match; it only demotes a match that gained a hold).
 *  - Suppression (D-014): a suppressed name or player id is never linked or created; the participant keeps no readable name.
 *  - Idempotent: a second run over the same inputs writes nothing.
 */
import { effectiveAgeStatus, mostRestrictiveAge } from '../archive/types';
import type { AgeStatus, MatchParticipantRow, MatchRow, PlayerRow, TournamentRow } from '../archive/types';
import { findPossibleDuplicates, matchAlias, normaliseAlias } from '../identity';
import type { IdAlias, IdPlayer } from '../identity/types';
import { addRedirect } from '../identity/redirects';
import type { SlugRedirect } from '../identity/types';
import { normalizeName, opaquePlayerSlug, tournamentSlug } from '../parser';
import type { AgeSignal, ParsedPlayer, ParseResult } from '../parser/types';
import { DISTRICT_NAMES } from '../parser/vocab';
import { eventScope } from '../youtube/classify';
import type { AuditInsert, IdentityStore, ParticipantInsert, PlayerInsert, TournamentInsert } from './identity-store';
import { IDENTITY_REVIEW_REASONS, type VideoRecord } from './types';

export interface IdentityDeps {
  store: IdentityStore;
  newId: () => string;
}

export type IdentitySkip = 'no_parse' | 'international' | 'not_match' | 'blocked' | 'listed_only' | 'not_public' | 'suppressed_name';

export interface IdentityOutcome {
  status: 'resolved' | 'skipped';
  skip: IdentitySkip | null;
  /** Reasons the identity step currently asserts for the video (AMBIGUOUS_ALIAS), empty when none. */
  reviewReasons: string[];
  playersCreated: number;
  tournamentsCreated: number;
  /** True when a match row was inserted or changed, or its participants were rewritten. */
  matchWritten: boolean;
  candidates: number;
  /** True when anything at all was written (players, aliases, tournaments, match, participants, candidates). */
  changed: boolean;
}

const MAX_POSITION = 4;
const LATIN_PREFIX = 3;
const NEAR_LIMIT = 100;

const skipped = (skip: IdentitySkip): IdentityOutcome => ({ status: 'skipped', skip, reviewReasons: [], playersCreated: 0, tournamentsCreated: 0, matchWritten: false, candidates: 0, changed: false });

const asIdPlayer = (p: PlayerRow): IdPlayer => ({
  id: p.id,
  slug: p.slug,
  displayName: p.display_name,
  ageStatus: p.age_status,
  ageSignals: [...p.age_signal],
  nameKey: p.name_key,
  latinKey: p.latin_key,
  provisional: p.is_provisional,
  consentStatus: 'unknown',
  visibility: p.visibility,
  mergedInto: p.merged_into,
});

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------

interface TournamentResolution {
  tournament: TournamentRow | null;
  created: boolean;
  ambiguous: boolean;
  wrote: boolean;
}

async function uniqueTournamentSlug(store: IdentityStore, parse: ParseResult, district: string | null, id: string): Promise<string> {
  const base = tournamentSlug({ name: parse.tournamentName ?? '', year: parse.year, city: district });
  const root = base.ok ? base.slug : `tournament-${id.replace(/-/gu, '').slice(0, 8)}`;
  const clipped = root.slice(0, 96);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? clipped : `${clipped}-${n}`;
    if (!(await store.isTournamentSlugTaken(candidate))) return candidate;
  }
  return `tournament-${id.replace(/-/gu, '').slice(0, 16)}`;
}

async function resolveTournament(parse: ParseResult, deps: IdentityDeps): Promise<TournamentResolution> {
  const { store } = deps;
  const none: TournamentResolution = { tournament: null, created: false, ambiguous: false, wrote: false };
  if (parse.tournamentLinkPolicy !== 'candidate_ok' || !parse.seriesKey || !parse.tournamentName) return none;
  const year = parse.year;
  const district = parse.locationHint !== null && DISTRICT_NAMES.has(parse.locationHint) ? parse.locationHint : null;

  let t = await store.findTournament(parse.seriesKey, year);
  if (!t) {
    const names = [...new Set([parse.seriesKey, normalizeName(parse.tournamentName)].filter((x): x is string => typeof x === 'string' && x !== ''))];
    const viaAlias = (await store.findTournamentsByAlias(names)).filter((x) => x.edition_year === year);
    const distinct = [...new Map(viaAlias.map((x) => [x.id, x])).values()];
    if (distinct.length > 1) return { ...none, ambiguous: true };
    t = distinct[0] ?? null;
  }
  if (t && (await store.isTournamentSuppressed(t.id))) return none;

  if (t) {
    const patch: Parameters<IdentityStore['updateTournament']>[1] = {};
    if (parse.category && !t.categories.includes(parse.category)) patch.categories = [...t.categories, parse.category];
    if (parse.ageGroup && !t.age_groups.includes(parse.ageGroup)) patch.age_groups = [...t.age_groups, parse.ageGroup];
    if (parse.minorHold && !t.is_minor_signal) patch.is_minor_signal = true;
    if (district !== null && t.district === null && !t.manual_override.district) patch.district = district;
    if (Object.keys(patch).length === 0) return { tournament: t, created: false, ambiguous: false, wrote: false };
    await store.updateTournament(t.id, patch);
    return { tournament: { ...t, ...patch }, created: false, ambiguous: false, wrote: true };
  }

  const id = deps.newId();
  const row: TournamentInsert = {
    id,
    slug: await uniqueTournamentSlug(store, parse, district, id),
    name: parse.tournamentName,
    series_key: parse.seriesKey,
    edition_year: year,
    edition_no: parse.editionNo,
    season_label: parse.seasonLabel,
    edition_year_source: parse.yearSource,
    level: null,
    region: 'tamil_nadu',
    city: null,
    district,
    venue: null,
    start_date: null,
    end_date: null,
    categories: parse.category ? [parse.category] : [],
    age_groups: parse.ageGroup ? [parse.ageGroup] : [],
    entry_info: null,
    registration_url: null,
    poster_path: null,
    status: 'pending', // a parser-made candidate waits for the admin (D-013)
    is_featured: false,
    featured_until: null,
    covered_by_power_smash: true,
    is_promoted: false,
    is_minor_signal: parse.minorHold,
    source: 'parsed',
    visibility: 'hidden',
    show_contact_public: false,
    manual_override: {},
  };
  await store.insertTournament(row);
  const aliases = new Set([parse.seriesKey, normalizeName(parse.tournamentName) ?? '']);
  for (const a of aliases) if (a !== '') await store.addTournamentAlias(a, id);
  return {
    tournament: { ...row, created_at: '', updated_at: '' } as TournamentRow,
    created: true,
    ambiguous: false,
    wrote: true,
  };
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

interface ParticipantPlan {
  rows: ParticipantInsert[];
  ambiguous: boolean;
  playersCreated: number;
  wrote: boolean;
  candidates: number;
}

const COUNTRY = /^[A-Z]{3}$/u;

function baseParticipant(p: ParsedPlayer, side: 'A' | 'B', position: number, signals: AgeSignal[]): Omit<ParticipantInsert, 'id' | 'match_id' | 'player_id' | 'resolution' | 'link_policy'> {
  return {
    side,
    position,
    raw_name: p.raw,
    identity_tier: p.identityTier,
    truncated: p.truncated,
    age_status: p.ageStatus,
    age_signal: [...signals],
    seed: p.seed ?? null,
    country: p.country !== undefined && COUNTRY.test(p.country) ? p.country : null,
    district_hint: p.districtHint ?? null,
    affiliation_hint: p.affiliationHint ?? null,
  };
}

async function candidatesFor(created: PlayerInsert, deps: IdentityDeps): Promise<AuditInsert[]> {
  const prefix = created.latin_key ? created.latin_key.slice(0, LATIN_PREFIX) : null;
  const near = (await deps.store.findPlayersNear(created.name_key, prefix, NEAR_LIMIT)).filter((p) => p.id !== created.id && p.merged_into === null);
  if (near.length === 0) return [];
  const self = { ...created, created_at: '', updated_at: '' } as PlayerRow;
  const pairs = findPossibleDuplicates([asIdPlayer(self), ...near.map(asIdPlayer)]).filter((d) => d.aId === created.id || d.bId === created.id);
  return pairs.map((d) => ({
    actor: 'sync',
    action: 'possible_duplicate',
    entity: 'player',
    entity_id: created.id,
    // ids and counts only: no names in the log (a minor's name must not leak into an audit row)
    diff: { other_player: d.aId === created.id ? d.bId : d.aId, reason: d.reason, strength: d.strength, distance: d.distance, needs_override: d.needsOverride },
    reason: null,
  }));
}

async function planParticipants(parse: ParseResult, tournament: TournamentRow | null, deps: IdentityDeps): Promise<ParticipantPlan> {
  const { store } = deps;
  const plan: ParticipantPlan = { rows: [], ambiguous: false, playersCreated: 0, wrote: false, candidates: 0 };
  const slots: { p: ParsedPlayer; side: 'A' | 'B'; position: number }[] = [];
  for (const [side, list] of [['A', parse.sideA], ['B', parse.sideB]] as const) list.slice(0, MAX_POSITION).forEach((p, i) => slots.push({ p, side, position: i + 1 }));

  const norms = [...new Set(slots.map((s) => normaliseAlias(s.p.displayName)).filter((n): n is string => n !== null))];
  const suppressedNames = await store.suppressedNames(norms);
  const aliasRows = norms.length > 0 ? await store.findAliases(norms) : [];
  const players = new Map((aliasRows.length > 0 ? await store.getPlayers([...new Set(aliasRows.map((a) => a.player_id))]) : []).map((p) => [p.id, p] as const));
  const suppressedIds = await store.suppressedPlayerIds([...players.keys()]);
  const idAliases: IdAlias[] = aliasRows.map((a) => ({ id: a.id, aliasNormalized: a.alias_normalized, playerId: a.player_id, status: a.status, scopeTournamentId: a.scope_tournament_id, scopeDistrict: a.scope_district }));
  const idPlayers = [...players.values()].map(asIdPlayer);

  const used = new Set<string>();
  const createdByNorm = new Map<string, string>();
  const candidateRows: AuditInsert[] = [];
  const district = parse.locationHint;

  for (const { p, side, position } of slots) {
    const base = baseParticipant(p, side, position, parse.ageSignals);
    const norm = normaliseAlias(p.displayName);
    const plain = (resolution: 'plain_text' | 'blocked'): void => {
      plan.rows.push({ id: deps.newId(), match_id: '', ...base, player_id: null, resolution, link_policy: resolution === 'blocked' ? 'blocked' : 'plain_text_only' });
    };

    if (norm !== null && suppressedNames.has(norm)) {
      // D-014: a suppressed person keeps no readable name in the match and is never linked
      plan.rows.push({ id: deps.newId(), match_id: '', ...base, raw_name: '[withheld]', player_id: null, resolution: 'suppressed', link_policy: 'blocked' });
      continue;
    }
    if (norm === null || p.linkPolicy !== 'provisional_ok' || p.identityTier !== 'multi_token' || p.truncated) {
      plain(p.linkPolicy === 'blocked' ? 'blocked' : 'plain_text');
      continue;
    }

    const link = (playerId: string, resolution: 'exact_alias' | 'provisional'): void => {
      used.add(playerId);
      plan.rows.push({ id: deps.newId(), match_id: '', ...base, player_id: playerId, resolution, link_policy: 'provisional_ok' });
    };
    const raiseIfProtected = async (id: string): Promise<void> => {
      const pl = players.get(id);
      if (!pl || pl.age_status === 'adult_confirmed') return; // an adult is never changed by the sync
      const status = mostRestrictiveAge(pl.age_status, p.ageStatus);
      const signals = [...new Set([...pl.age_signal, ...parse.ageSignals])].sort();
      if (status !== pl.age_status || !sameJson(signals, [...pl.age_signal].sort())) {
        await store.updatePlayerAge(id, status, signals);
        plan.wrote = true;
      }
    };

    const m = matchAlias(p.displayName, idAliases, idPlayers, { tournamentId: tournament?.id ?? null, district });
    if (m.tier === 'ambiguous') {
      plan.ambiguous = true;
      plain('plain_text');
      continue;
    }
    if (m.tier === 'confirmed') {
      if (suppressedIds.has(m.playerId)) {
        plan.rows.push({ id: deps.newId(), match_id: '', ...base, raw_name: '[withheld]', player_id: null, resolution: 'suppressed', link_policy: 'blocked' });
      } else if (used.has(m.playerId)) {
        plain('plain_text'); // the same person twice in one match is never linked twice
      } else {
        await raiseIfProtected(m.playerId);
        link(m.playerId, 'exact_alias');
      }
      continue;
    }
    if (m.tier === 'text_only' || tournament === null) {
      plain('plain_text'); // a provisional player is scoped to a tournament edition (PC-01): without one, plain text
      continue;
    }

    // provisional tier: reuse this edition's provisional player for the name, or create one
    const scoped = [...new Set(idAliases.filter((a) => a.aliasNormalized === norm && a.status === 'provisional' && a.scopeTournamentId === tournament.id).map((a) => a.playerId))].filter(
      (id) => players.get(id)?.merged_into === null && !suppressedIds.has(id),
    );
    if (scoped.length > 1) {
      plan.ambiguous = true;
      plain('plain_text');
      continue;
    }
    const existingId = scoped[0] ?? createdByNorm.get(norm) ?? null;
    if (existingId !== null) {
      if (used.has(existingId)) plain('plain_text');
      else {
        await raiseIfProtected(existingId);
        link(existingId, 'provisional');
      }
      continue;
    }

    const id = deps.newId();
    const row: PlayerInsert = {
      id,
      slug: opaquePlayerSlug(id), // protected until an admin confirms an adult: nothing about the person in the slug (PC-14)
      slug_kind: 'opaque',
      display_name: p.displayName,
      name_normalized: p.nameNormalized,
      name_key: p.nameKey,
      latin_key: p.latinKey,
      disambiguator: null,
      identity_tier: 'multi_token',
      age_status: p.ageStatus,
      age_signal: [...parse.ageSignals],
      age_confirmed_by: null,
      age_confirmed_at: null,
      age_confirmed_evidence: null,
      district: null,
      photo_path: null,
      bio: null,
      instagram_handle: null,
      claimed: false,
      noindex: true,
      visibility: 'hidden',
      is_provisional: true,
      provisional_tournament_id: tournament.id,
      merged_into: null,
      created_source: 'parsed',
      manual_override: {},
    };
    await store.insertPlayer(row);
    await store.addPlayerAlias({ id: deps.newId(), alias_normalized: norm, player_id: id, status: 'provisional', scope_tournament_id: tournament.id, scope_district: null, created_by: 'sync' });
    createdByNorm.set(norm, id);
    plan.playersCreated++;
    plan.wrote = true;
    candidateRows.push(...(await candidatesFor(row, deps)));
    link(id, 'provisional');
  }
  if (candidateRows.length > 0) {
    await store.recordAudit(candidateRows);
    plan.candidates = candidateRows.length;
    plan.wrote = true;
  }
  return plan;
}

function sameParticipant(a: MatchParticipantRow, b: ParticipantInsert): boolean {
  return (
    a.raw_name === b.raw_name &&
    a.player_id === b.player_id &&
    a.resolution === b.resolution &&
    a.identity_tier === b.identity_tier &&
    a.link_policy === b.link_policy &&
    a.truncated === b.truncated &&
    a.age_status === b.age_status &&
    sameJson(a.age_signal, b.age_signal) &&
    a.seed === b.seed &&
    a.country === b.country &&
    a.district_hint === b.district_hint &&
    a.affiliation_hint === b.affiliation_hint
  );
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export async function resolveVideoIdentity(video: VideoRecord, deps: IdentityDeps): Promise<IdentityOutcome> {
  const { store } = deps;
  const parse = video.parse_result as ParseResult | null;
  if (!parse) return skipped('no_parse');
  if (video.is_international || parse.isInternational) return skipped('international');
  if (video.type !== 'match' || parse.kind !== 'match') return skipped('not_match');
  if (parse.entityCreation === 'blocked') return skipped('blocked');
  if (eventScope(parse) !== 'tamil_nadu') return skipped('listed_only');
  if (video.visibility !== 'public') return skipped('not_public');

  const settings = await store.getSettings();
  const t = await resolveTournament(parse, deps);
  const plan = await planParticipants(parse, t.tournament, deps);
  const ambiguous = t.ambiguous || plan.ambiguous;
  const reviewReasons: string[] = ambiguous ? [...IDENTITY_REVIEW_REASONS] : [];

  const existing = await store.getMatchByVideo(video.youtube_id);
  const lock = existing?.manual_override ?? {};
  const desired = {
    tournament_id: t.tournament?.id ?? null,
    category: parse.category,
    age_group: parse.ageGroup,
    round: parse.round,
    format: parse.format,
    played_on: parse.playedOn,
    match_key: parse.matchKey,
    score_text: parse.scoreText,
    minor_hold: parse.minorHold,
  };
  // a clean parse publishes without review when the owner's setting says so (D-013); anything else is held
  const clean = video.parse_status === 'parsed' && video.hard_flags.length === 0 && !parse.minorHold && !ambiguous && !t.ambiguous;
  const autoPublish = settings.auto_publish_clean_parses === 'true' && clean;

  let matchWritten = false;
  let candidates = plan.candidates;
  let match: MatchRow | null = existing;
  let matchId: string;

  if (!existing) {
    matchId = deps.newId();
    await store.insertMatch({
      id: matchId,
      video_id: video.youtube_id,
      ...desired,
      duplicate_of: null,
      winner_side: null,
      publish_state: autoPublish ? 'published' : 'held',
      manual_override: {},
    });
    matchWritten = true;
    if (parse.matchKey) {
      const twins = (await store.findMatchesByKey(parse.matchKey)).filter((m) => m.id !== matchId && m.video_id !== video.youtube_id);
      if (twins.length > 0) {
        // PC-19: the same match in another video. Recorded for the admin; duplicate_of is NOT set automatically (it would hide a page).
        await store.recordAudit(twins.map((m) => ({ actor: 'sync', action: 'possible_duplicate_match', entity: 'match', entity_id: matchId, diff: { other_match: m.id }, reason: null })));
        candidates += twins.length;
      }
    }
  } else {
    matchId = existing.id;
    const patch: Parameters<IdentityStore['updateMatch']>[1] = {};
    const fields = ['tournament_id', 'category', 'age_group', 'round', 'format', 'played_on', 'match_key', 'score_text'] as const;
    for (const f of fields) {
      if ((lock as Record<string, true | undefined>)[f]) continue; // locked by the owner (PC-20); match_key and score_text have no lock
      if (existing[f] !== desired[f]) (patch as Record<string, unknown>)[f] = desired[f];
    }
    if (desired.minor_hold && !existing.minor_hold) patch.minor_hold = true; // a hold is only ever added here
    const holdNow = existing.minor_hold || desired.minor_hold;
    if (existing.publish_state === 'published' && (holdNow || !clean)) patch.publish_state = 'held'; // demote only; never promote
    if (Object.keys(patch).length > 0) {
      await store.updateMatch(existing.id, patch);
      match = { ...existing, ...patch } as MatchRow;
      matchWritten = true;
    }
  }
  void match;

  // participants: a locked list or a hand-linked slot is never rewritten
  if (!lock.participants) {
    const current = existing ? await store.getParticipants(matchId) : [];
    const keyOf = (r: { side: string; position: number }): string => `${r.side}${r.position}`;
    const wanted = new Map(plan.rows.map((r) => [keyOf(r), r] as const));
    const toDelete: string[] = [];
    const toInsert: ParticipantInsert[] = [];
    for (const cur of current) {
      if (cur.resolution === 'manual') {
        wanted.delete(keyOf(cur));
        continue;
      }
      const want = wanted.get(keyOf(cur));
      if (want && sameParticipant(cur, want)) {
        wanted.delete(keyOf(cur));
        continue;
      }
      toDelete.push(cur.id);
    }
    for (const w of wanted.values()) toInsert.push({ ...w, match_id: matchId });
    if (toDelete.length > 0) await store.deleteParticipants(toDelete);
    if (toInsert.length > 0) await store.insertParticipants(toInsert);
    if (toDelete.length > 0 || toInsert.length > 0) matchWritten = true;
  }

  return {
    status: 'resolved',
    skip: null,
    reviewReasons,
    playersCreated: plan.playersCreated,
    tournamentsCreated: t.created ? 1 : 0,
    matchWritten,
    candidates,
    changed: matchWritten || plan.wrote || t.wrote,
  };
}

/**
 * Effective age status of a stored participant against its player (for tests and the pipeline's own assertions):
 * the same rule the database applies in `app.effective_age_status`.
 */
export function participantEffectiveAge(participation: AgeStatus, player: AgeStatus | null): AgeStatus {
  return effectiveAgeStatus(participation, player);
}

/**
 * Slug rename (PC-14): when a persisted slug has to change, the old path must 301 to the new one and any earlier redirect that
 * pointed at the old path is flattened to the new target. Returns the redirect rows to upsert; `[]` when nothing changes.
 * The sync itself never renames a slug (slugs persist once assigned); the admin RPCs and any future rename call this.
 */
export function planSlugRename(
  kind: 'tournament' | 'player',
  existing: readonly { from_path: string; to_path: string | null; http_status: 301 | 410 }[],
  oldSlug: string,
  newSlug: string,
  entityId: string,
): { from_path: string; to_path: string | null; http_status: 301 | 410; entity_type: 'tournament' | 'player'; entity_id: string }[] {
  if (oldSlug === newSlug) return [];
  const dir = kind === 'tournament' ? '/tournaments/' : '/players/';
  const list: SlugRedirect[] = existing.map((r) => ({ fromSlug: r.from_path, toSlug: r.to_path, type: r.http_status }));
  const r = addRedirect(list, `${dir}${oldSlug}/`, `${dir}${newSlug}/`, 301);
  if (!r.ok) return [];
  const before = new Map(existing.map((e) => [e.from_path, `${e.to_path}|${e.http_status}`] as const));
  return r.redirects
    .filter((x) => before.get(x.fromSlug) !== `${x.toSlug}|${x.type}`)
    .map((x) => ({ from_path: x.fromSlug, to_path: x.toSlug, http_status: x.type, entity_type: kind, entity_id: entityId }));
}
