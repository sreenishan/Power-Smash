// The protected-player rules in ONE place (D-012, D-013, D-018). Pure and fail-closed: anything the code does not recognise is protected.
//
// Player status -> page:
//   adult_confirmed                       -> full public profile (indexable, in the directory, sitemap and search index);
//   unknown                               -> a MINIMAL page, noindex, only while `unknown_match_mode` is `noindex_minimal`
//                                            (name and a removal link; no photo, bio, district, stats or parsed links); otherwise none;
//   minor_confirmed / minor_suspected     -> no page at all;
//   a player id that is missing, or any other value -> treated as `unknown`.
// Match -> page (a match is only as public as its LEAST public participant):
//   hidden   no page: a minor takes part (minor_match_mode = hidden), or the event or the video is hidden;
//   minimal  a page that is noindex and shows only the raw title and the YouTube player: no parsed names or links, not in the grid,
//            related lists, sitemap, search or JSON; the slug is opaque (`match-<id>`);
//   listed   a non-Tamil-Nadu event (D-018): listed with the raw title, no player links, no tournament page;
//   full     everything adult and public.

import type { AgeStatus, ArchiveSettings, RawMatch, RawPlayer, RawTournament } from './provider';

const KNOWN: readonly AgeStatus[] = ['adult_confirmed', 'minor_confirmed', 'minor_suspected', 'unknown'];

/** The status used for a player id, failing closed: a missing player or an unrecognised value is `unknown`. */
export function effectiveAgeStatus(player: Pick<RawPlayer, 'ageStatus'> | undefined | null): AgeStatus {
  const s = player?.ageStatus;
  return s !== undefined && (KNOWN as readonly string[]).includes(s) ? s : 'unknown';
}

/** Protected = anything that is not adult_confirmed (unknown included, D-012). */
export function isProtectedPlayer(player: Pick<RawPlayer, 'ageStatus'> | undefined | null): boolean {
  return effectiveAgeStatus(player) !== 'adult_confirmed';
}

export function isMinorStatus(status: AgeStatus): boolean {
  return status === 'minor_confirmed' || status === 'minor_suspected';
}

export type PlayerPageKind = 'full' | 'minimal' | 'none';

export function playerPageKind(player: Pick<RawPlayer, 'ageStatus' | 'hasProfile'>, settings: ArchiveSettings): PlayerPageKind {
  if (player.hasProfile === false) return 'none';
  const status = effectiveAgeStatus(player);
  if (status === 'adult_confirmed') return 'full';
  if (status === 'unknown' && settings.unknownMatchMode === 'noindex_minimal') return 'minimal';
  return 'none';
}

export type MatchKind = 'full' | 'listed' | 'minimal' | 'hidden';

export function classifyMatch(
  match: Pick<RawMatch, 'sideA' | 'sideB' | 'visibility' | 'tournamentId' | 'pageMode'>,
  playersById: ReadonlyMap<string, RawPlayer>,
  tournamentsById: ReadonlyMap<string, RawTournament>,
  settings: ArchiveSettings,
): MatchKind {
  if (match.visibility === 'hidden') return 'hidden';
  let scope = match.visibility ?? 'public';
  if (match.tournamentId) {
    const t = tournamentsById.get(match.tournamentId);
    if (!t) return 'hidden'; // a dangling reference: fail closed
    if (t.visibility === 'hidden') return 'hidden';
    if (t.visibility === 'listed_no_player_pages') scope = 'listed_no_player_pages';
  }
  let sawUnknown = false;
  for (const id of [...match.sideA, ...match.sideB]) {
    const status = effectiveAgeStatus(playersById.get(id));
    if (isMinorStatus(status)) return 'hidden';
    if (status === 'unknown') sawUnknown = true;
  }
  if (match.pageMode === 'minimal') sawUnknown = true; // the source already says: protected participants
  if (sawUnknown) return settings.unknownMatchMode === 'noindex_minimal' ? 'minimal' : 'hidden';
  return scope === 'listed_no_player_pages' ? 'listed' : 'full';
}

/** True when a page of this kind may be indexed (the layout still forces noindex everywhere until PUBLIC_ALLOW_INDEXING is true). */
export function isIndexableKind(kind: MatchKind | PlayerPageKind): boolean {
  return kind === 'full' || kind === 'listed';
}
