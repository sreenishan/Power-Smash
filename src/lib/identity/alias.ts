// Exact-alias matching tiers (PC-01, PC-02, D-013). PURE. Never auto-merges; it only says which tier a name falls in.
//   confirmed   exactly one confirmed, in-scope, not-rejected alias row matches: link.
//   ambiguous   more than one candidate player: AMBIGUOUS_ALIAS, queue for the owner, link nothing.
//   provisional two or more name tokens and no alias: create a provisional player scoped to the edition and queue it.
//   text_only   a single token or initials-only name: never linked across editions, rendered as plain text.
import { nameKey, normalizeName } from '../parser/normalize';
import type { IdAlias, IdPlayer } from './types';

export interface AliasContext {
  tournamentId?: string | null;
  district?: string | null;
}

export type AliasMatch =
  | { tier: 'confirmed'; playerId: string }
  | { tier: 'ambiguous'; candidates: string[] }
  | { tier: 'provisional' }
  | { tier: 'text_only' };

export function normaliseAlias(raw: string): string | null {
  return normalizeName(raw);
}

/** Count of real name words (non-initial tokens). 0 = initials only, 1 = one word such as GANESH (or 'S KARTHIK'). */
export function nameWordCount(raw: string): number {
  const key = nameKey(raw);
  if (key === null) return 0;
  const words = key.split('|')[0]!.trim();
  return words === '' ? 0 : words.split(' ').length;
}

/**
 * PC-01: a name may link or create a provisional player only with TWO OR MORE name tokens of which at least one is a real word.
 * 'A KUMAR' and 'KARTHIK S' qualify; 'GANESH' (one token) and 'S K' (initials only) never do.
 */
export function isLinkableName(raw: string): boolean {
  const norm = normaliseAlias(raw);
  return norm !== null && norm.split(' ').length >= 2 && nameWordCount(raw) >= 1;
}

function inScope(a: IdAlias, ctx: AliasContext): boolean {
  if (a.scopeTournamentId !== null && a.scopeTournamentId !== (ctx.tournamentId ?? null)) return false;
  if (a.scopeDistrict !== null && a.scopeDistrict !== (ctx.district ?? null)) return false;
  return true;
}

export function matchAlias(raw: string, aliases: readonly IdAlias[], players: readonly IdPlayer[], ctx: AliasContext = {}): AliasMatch {
  const norm = normaliseAlias(raw);
  if (norm === null) return { tier: 'text_only' };
  const live = new Map(players.filter((p) => p.mergedInto === null).map((p) => [p.id, p]));
  const rejected = new Set(aliases.filter((a) => a.aliasNormalized === norm && a.status === 'rejected').map((a) => a.playerId));
  const linkable = isLinkableName(raw);
  const candidates = new Set<string>();
  for (const a of aliases) {
    if (a.aliasNormalized !== norm || a.status !== 'confirmed') continue;
    if (rejected.has(a.playerId) || !live.has(a.playerId)) continue;
    if (!inScope(a, ctx)) continue;
    // A single token or initials-only alias only links when it is scoped (tournament or district): PC-01.
    if (!linkable && a.scopeTournamentId === null && a.scopeDistrict === null) continue;
    candidates.add(a.playerId);
  }
  if (candidates.size === 1) return { tier: 'confirmed', playerId: [...candidates][0]! };
  if (candidates.size > 1) return { tier: 'ambiguous', candidates: [...candidates].sort() };
  return linkable ? { tier: 'provisional' } : { tier: 'text_only' };
}

/** An explicit owner merge outranks an old rejection (a split writes one on the parent): confirmed > rejected > provisional. */
const STATUS_RANK = { confirmed: 2, rejected: 1, provisional: 0 } as const;

/** Moves aliases from `dropId` to `keepId`, dropping duplicates (same alias and scope) and keeping the strongest status. */
export function moveAliases(aliases: readonly IdAlias[], dropId: string, keepId: string): IdAlias[] {
  const keyOf = (a: IdAlias) => `${a.aliasNormalized}|${a.scopeTournamentId ?? ''}|${a.scopeDistrict ?? ''}`;
  const out: IdAlias[] = aliases.filter((a) => a.playerId !== dropId).map((a) => ({ ...a }));
  const byKey = new Map(out.filter((a) => a.playerId === keepId).map((a) => [keyOf(a), a]));
  for (const a of aliases) {
    if (a.playerId !== dropId) continue;
    const existing = byKey.get(keyOf(a));
    if (existing) {
      if (STATUS_RANK[a.status] > STATUS_RANK[existing.status]) existing.status = a.status;
      continue;
    }
    const moved = { ...a, playerId: keepId };
    byKey.set(keyOf(moved), moved);
    out.push(moved);
  }
  return out;
}
