// Suppression and tombstones (D-014). PURE. Sync, reparse, merge and backfill call these before any insert.
import { normalizeName } from '../parser/normalize';
import type { IdPlayer, Suppression } from './types';

export function isSuppressed(list: readonly Suppression[], probe: { name?: string | null; youtubeId?: string | null; playerId?: string | null }): boolean {
  const name = probe.name ? normalizeName(probe.name) : null;
  return list.some(
    (s) =>
      (s.kind === 'name_normalized' && name !== null && s.key === name) ||
      (s.kind === 'youtube_id' && !!probe.youtubeId && s.key === probe.youtubeId) ||
      (s.kind === 'player_id' && !!probe.playerId && s.key === probe.playerId),
  );
}

/** Suppression entries created when a player is emergency-hidden: by id and by normalised name. */
export function suppressionsForPlayer(p: Pick<IdPlayer, 'id' | 'displayName'>): Suppression[] {
  const out: Suppression[] = [{ kind: 'player_id', key: p.id }];
  const n = normalizeName(p.displayName);
  if (n !== null) out.push({ kind: 'name_normalized', key: n });
  return out;
}

export function addSuppressions(list: readonly Suppression[], extra: readonly Suppression[]): Suppression[] {
  const out = [...list];
  for (const e of extra) if (!out.some((s) => s.kind === e.kind && s.key === e.key)) out.push(e);
  return out;
}

/** A tombstoned player: hidden, never hard-deleted. */
export function tombstone<T extends IdPlayer>(p: T): T {
  return { ...p, visibility: 'hidden' };
}
