// Merge, split and rename PLANS (D-006 RPCs, D-012, D-013, D-014, PC-02). PURE: each function takes the current state and
// returns the new state plus an audit payload and (for merge) an undo snapshot. The database RPCs apply the same rules in
// SQL inside one transaction; the in-memory admin store applies these functions directly. Never auto-merges anything.
import { latinKey, nameKey, normalizeName } from '../parser/normalize';
import { opaquePlayerSlug, playerSlug } from '../parser/slug';
import { isProtectedAgeStatus } from '../parser/types';
import { moveAliases } from './alias';
import { addRedirect } from './redirects';
import { decideMergeStatus, inheritForSplit } from './status';
import { isSuppressed } from './suppression';
import type { IdAlias, IdPlayer, OverrideRecord, SlugRedirect, Suppression } from './types';

export type IdentityErrorCode =
  | 'SAME_PLAYER'
  | 'ALREADY_MERGED'
  | 'SUPPRESSED'
  | 'MINOR_ADULT_MERGE_BLOCKED'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'EMPTY_NAME'
  | 'ALIAS_NOT_OWNED'
  | 'REDIRECT_LOOP'
  | 'NOT_FOUND';

export type Fail = { ok: false; code: IdentityErrorCode };

export interface IdentityState {
  players: IdPlayer[];
  aliases: IdAlias[];
  redirects: SlugRedirect[];
}

export interface AuditPayload {
  action: string;
  details: Record<string, unknown>;
}

/** Slug for a player given the status it will have: protected = opaque; adult = name-based with a counter on collision. */
export function chooseSlug(p: Pick<IdPlayer, 'id' | 'displayName' | 'ageStatus'>, taken: ReadonlySet<string>): string {
  if (isProtectedAgeStatus(p.ageStatus)) return opaquePlayerSlug(p.id);
  for (let counter = 1; counter < 1000; counter++) {
    const r = playerSlug({ id: p.id, displayName: p.displayName, ageStatus: p.ageStatus, ...(counter > 1 ? { counter } : {}) });
    if (!r.ok) return opaquePlayerSlug(p.id); // Tamil-only name etc: no wrong slug, an opaque one
    if (!taken.has(r.slug)) return r.slug;
  }
  return opaquePlayerSlug(p.id);
}

function takenSlugs(players: readonly IdPlayer[], redirects: readonly SlugRedirect[], except?: string): Set<string> {
  const s = new Set<string>();
  for (const p of players) if (p.id !== except) s.add(p.slug);
  for (const r of redirects) s.add(r.fromSlug);
  return s;
}

/** Adds redirects for a slug change `from` -> `to`; a protected result has no public page to point at, so the old slug is 410. */
function redirectForSlugChange(redirects: SlugRedirect[], from: string, to: string, hadPublicPage: boolean, hasPublicPage: boolean): { ok: true; redirects: SlugRedirect[] } | Fail {
  if (from === to || !hadPublicPage) return { ok: true, redirects };
  const r = hasPublicPage ? addRedirect(redirects, from, to, 301) : addRedirect(redirects, from, null, 410);
  return r.ok ? { ok: true, redirects: r.redirects } : { ok: false, code: 'REDIRECT_LOOP' };
}

const hasPublicPage = (p: Pick<IdPlayer, 'ageStatus' | 'provisional' | 'visibility'>): boolean => p.ageStatus === 'adult_confirmed' && p.visibility === 'public';

/** Makes (alias, player) an unscoped CONFIRMED row: upgrades a rejected or provisional row, adds one when none exists, never duplicates. */
function confirmAlias(aliases: IdAlias[], playerId: string, aliasNormalized: string, newId: () => string): IdAlias[] {
  const same = (a: IdAlias) => a.playerId === playerId && a.aliasNormalized === aliasNormalized && a.scopeTournamentId === null && a.scopeDistrict === null;
  if (aliases.some(same)) return aliases.map((a) => (same(a) ? { ...a, status: 'confirmed' as const } : a));
  return [...aliases, { id: newId(), aliasNormalized, playerId, status: 'confirmed', scopeTournamentId: null, scopeDistrict: null }];
}

// ---------------------------------------------------------------- merge

export interface MergeInput {
  keepId: string;
  dropId: string;
  override?: OverrideRecord | null;
  suppressions?: readonly Suppression[];
  newId: () => string;
}

export interface MergeUndo {
  keepBefore: IdPlayer;
  dropBefore: IdPlayer;
  aliasesBefore: IdAlias[];
  redirectsBefore: SlugRedirect[];
}

export type MergeResult = { ok: true; state: IdentityState; audit: AuditPayload; undo: MergeUndo; overrideLogged: OverrideRecord | null } | Fail;

export function planMerge(state: IdentityState, input: MergeInput): MergeResult {
  if (input.keepId === input.dropId) return { ok: false, code: 'SAME_PLAYER' };
  const keep = state.players.find((p) => p.id === input.keepId);
  const drop = state.players.find((p) => p.id === input.dropId);
  if (!keep || !drop) return { ok: false, code: 'NOT_FOUND' };
  if (keep.mergedInto || drop.mergedInto) return { ok: false, code: 'ALREADY_MERGED' };
  // D-014: a suppressed (hidden by takedown) identity is never resurrected through a merge.
  const sup = input.suppressions ?? [];
  if (isSuppressed(sup, { playerId: keep.id, name: keep.displayName }) || isSuppressed(sup, { playerId: drop.id, name: drop.displayName })) {
    return { ok: false, code: 'SUPPRESSED' };
  }
  const decision = decideMergeStatus(keep, drop, input.override);
  if (!decision.allowed) return { ok: false, code: decision.code };

  const keepBecomesProtected = isProtectedAgeStatus(decision.ageStatus);
  const nextKeep: IdPlayer = {
    ...keep,
    ageStatus: decision.ageStatus,
    consentStatus: decision.consentStatus,
    ageSignals: [...new Set([...keep.ageSignals, ...drop.ageSignals])],
    provisional: keep.provisional && drop.provisional,
  };
  let redirects = [...state.redirects];
  // keep's slug changes only when it becomes protected (D-012: no name in a protected slug).
  if (keepBecomesProtected && keep.ageStatus === 'adult_confirmed') {
    nextKeep.slug = opaquePlayerSlug(keep.id);
    const r = redirectForSlugChange(redirects, keep.slug, nextKeep.slug, hasPublicPage(keep), false);
    if (!r.ok) return r;
    redirects = r.redirects;
  }
  const keepAfterPublic = hasPublicPage(nextKeep);
  const rd = redirectForSlugChange(redirects, drop.slug, nextKeep.slug, hasPublicPage(drop), keepAfterPublic);
  if (!rd.ok) return rd;
  redirects = rd.redirects;

  // the dropped name stays an alias of the kept player so the next sync keeps linking to one person
  let aliases = moveAliases(state.aliases, drop.id, keep.id);
  const dropAlias = normalizeName(drop.displayName);
  if (dropAlias !== null) aliases = confirmAlias(aliases, keep.id, dropAlias, input.newId);
  const nextDrop: IdPlayer = { ...drop, mergedInto: keep.id, visibility: 'hidden' };
  return {
    ok: true,
    overrideLogged: decision.overrideLogged,
    state: { players: state.players.map((p) => (p.id === keep.id ? nextKeep : p.id === drop.id ? nextDrop : p)), aliases, redirects },
    audit: {
      action: 'player.merge',
      details: {
        keepId: keep.id,
        dropId: drop.id,
        resultingAgeStatus: decision.ageStatus,
        statusBefore: { keep: keep.ageStatus, drop: drop.ageStatus },
        override: decision.overrideLogged,
      },
    },
    undo: { keepBefore: keep, dropBefore: drop, aliasesBefore: state.aliases.map((a) => ({ ...a })), redirectsBefore: state.redirects.map((r) => ({ ...r })) },
  };
}

/** Undo of a merge made moments ago: restores the exact before-state of the two players, aliases and redirects. */
export function applyMergeUndo(state: IdentityState, undo: MergeUndo): IdentityState {
  return {
    players: state.players.map((p) => (p.id === undo.keepBefore.id ? undo.keepBefore : p.id === undo.dropBefore.id ? undo.dropBefore : p)),
    aliases: undo.aliasesBefore,
    redirects: undo.redirectsBefore,
  };
}

// ---------------------------------------------------------------- split

export interface SplitInput {
  playerId: string;
  newPlayerId: string;
  newDisplayName: string;
  /** Alias rows that belong to the new person. */
  moveAliasIds?: string[];
  newId: () => string;
}

export type SplitResult = { ok: true; state: IdentityState; child: IdPlayer; audit: AuditPayload } | Fail;

export function planSplit(state: IdentityState, input: SplitInput): SplitResult {
  const parent = state.players.find((p) => p.id === input.playerId);
  if (!parent) return { ok: false, code: 'NOT_FOUND' };
  if (parent.mergedInto) return { ok: false, code: 'ALREADY_MERGED' };
  const name = input.newDisplayName.trim();
  const nk = nameKey(name);
  const norm = normalizeName(name);
  if (nk === null || norm === null) return { ok: false, code: 'EMPTY_NAME' };
  const move = new Set(input.moveAliasIds ?? []);
  const owned = new Map(state.aliases.filter((a) => a.playerId === parent.id).map((a) => [a.id, a]));
  for (const id of move) if (!owned.has(id)) return { ok: false, code: 'ALIAS_NOT_OWNED' };

  const inherited = inheritForSplit(parent);
  const base: IdPlayer = {
    id: input.newPlayerId,
    slug: '',
    displayName: name,
    ...inherited,
    nameKey: nk,
    latinKey: latinKey(name),
    visibility: 'hidden', // reviewed before it goes anywhere (provisional players have no page, D-013)
    mergedInto: null,
  };
  base.slug = chooseSlug(base, takenSlugs(state.players, state.redirects));
  const child = base;

  const aliases: IdAlias[] = [];
  for (const a of state.aliases) {
    if (move.has(a.id)) {
      aliases.push({ ...a, playerId: child.id });
      // PC-02: a rejected row on the parent makes the split stick through the next sync
      aliases.push({ ...a, id: input.newId(), playerId: parent.id, status: 'rejected' });
    } else {
      aliases.push(a);
    }
  }
  if (!aliases.some((a) => a.playerId === child.id && a.aliasNormalized === norm && a.scopeTournamentId === null)) {
    aliases.push({ id: input.newId(), aliasNormalized: norm, playerId: child.id, status: 'provisional', scopeTournamentId: null, scopeDistrict: null });
  }
  return {
    ok: true,
    child,
    state: { players: [...state.players, child], aliases, redirects: state.redirects },
    audit: { action: 'player.split', details: { parentId: parent.id, childId: child.id, movedAliasIds: [...move], inheritedAgeStatus: child.ageStatus } },
  };
}

// ---------------------------------------------------------------- rename

export interface RenameInput {
  playerId: string;
  newDisplayName: string;
  keepOldAsAlias?: boolean;
  newId: () => string;
}

export type RenameResult = { ok: true; state: IdentityState; audit: AuditPayload } | Fail;

export function planRename(state: IdentityState, input: RenameInput): RenameResult {
  const p = state.players.find((x) => x.id === input.playerId);
  if (!p) return { ok: false, code: 'NOT_FOUND' };
  const name = input.newDisplayName.trim();
  const nk = nameKey(name);
  const norm = normalizeName(name);
  if (nk === null || norm === null) return { ok: false, code: 'EMPTY_NAME' };
  const next: IdPlayer = { ...p, displayName: name, nameKey: nk, latinKey: latinKey(name) };
  let redirects = [...state.redirects];
  // only an adult_confirmed page has a name-based slug; protected slugs are opaque and never change
  if (p.ageStatus === 'adult_confirmed') {
    next.slug = chooseSlug(next, takenSlugs(state.players, state.redirects, p.id));
    const r = redirectForSlugChange(redirects, p.slug, next.slug, hasPublicPage(p), hasPublicPage(next));
    if (!r.ok) return r;
    redirects = r.redirects;
  }
  let aliases = [...state.aliases];
  const addAlias = (alias: string | null) => {
    if (alias === null) return;
    if (aliases.some((a) => a.playerId === p.id && a.aliasNormalized === alias && a.scopeTournamentId === null && a.scopeDistrict === null)) return;
    aliases.push({ id: input.newId(), aliasNormalized: alias, playerId: p.id, status: 'confirmed', scopeTournamentId: null, scopeDistrict: null });
  };
  if (input.keepOldAsAlias !== false) addAlias(normalizeName(p.displayName));
  addAlias(norm);
  aliases = aliases.filter((a) => !(a.playerId === p.id && a.status === 'rejected' && a.aliasNormalized === norm));
  return {
    ok: true,
    state: { players: state.players.map((x) => (x.id === p.id ? next : x)), aliases, redirects },
    audit: { action: 'player.rename', details: { playerId: p.id, slugChanged: next.slug !== p.slug, keepOldAsAlias: input.keepOldAsAlias !== false } },
  };
}
