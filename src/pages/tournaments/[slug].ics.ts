import type { APIRoute, GetStaticPaths } from 'astro';
import { assertValidTournaments, hasCalendarFile, tournamentIcs, tournaments, type TournamentRecord } from '../../content/tournaments';
import { todayIst } from '../../lib/dates';

// Add-to-calendar file for a tournament page (spec 7.7): /tournaments/<slug>.ics, one all-day event, public fields only (D-029).
// Prerendered from the owner-entered list; only tournaments still to come and not cancelled get one (the nightly deploy, D-008,
// drops it once the tournament is over). The page links to it only when it exists (hasCalendarFile, same rule).
export const prerender = true;

export const getStaticPaths = (() => {
  assertValidTournaments();
  const today = todayIst();
  return tournaments.filter((t) => hasCalendarFile(t, today)).map((tournament) => ({ params: { slug: tournament.slug }, props: { tournament } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, site, url }) => {
  const { tournament } = props as { tournament: TournamentRecord };
  return new Response(tournamentIcs(tournament, { origin: site ?? url, now: new Date() }), {
    status: 200,
    headers: { 'content-type': 'text/calendar; charset=utf-8' },
  });
};
