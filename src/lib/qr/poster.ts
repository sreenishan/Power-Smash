// What a printable poster shows (spec 9.4): pure functions that turn a tournament record (or the channel) and the site address into
// the text, the QR target and the SVG. The page (src/pages/posters/) only draws the result.
//
// Owner-input rules (D-034): without a usable PUBLIC_SITE_URL there is NO QR code, only a `missing` problem that the page draws as a
// <Todo> (the strict release gate then fails). A local address (http://localhost) may preview a poster in the developer build
// (`preview: true`, shown with a "do not print" banner) and counts as missing in the strict build.
import type { TournamentRecord } from '../../content/tournaments';
import { tournamentPlace } from '../../content/tournaments';
import { formatDateRange } from '../dates';
import { CHANNEL_POSTER_SLUG, buildQrTarget, checkSiteOrigin, isPosterSlug, qrSvg, type QrDestination } from './index';

export type PosterKind = 'tournament' | 'channel';

export interface PosterModel {
  slug: string;
  kind: PosterKind;
  /** Big line: "Find your match videos". */
  headline: string;
  /** The tournament name, or the channel line. */
  title: string;
  /** Dates and place (tournament posters only; empty strings when the record has none). */
  dateLine: string;
  placeLine: string;
  /** "Scan to watch the matches" style instruction under the code. */
  scanLine: string;
  qr:
    | { status: 'ok'; svg: string; target: string; displayUrl: string; preview: boolean }
    | { status: 'missing'; todo: string };
}

export const POSTER_HEADLINE = 'Find your match videos';
export const POSTER_SCAN_LINE = 'Scan with your phone camera';

const TODO_SITE_URL = 'PUBLIC_SITE_URL: the real https address of the website, so the QR code on the poster opens the right page';

/** Slugs that get a poster: the channel, plus every tournament that is not cancelled. Throws on a slug that cannot be a poster address. */
export function posterSlugs(list: readonly TournamentRecord[]): string[] {
  const slugs: string[] = [CHANNEL_POSTER_SLUG];
  for (const t of list) {
    if (t.status === 'cancelled') continue;
    if (!isPosterSlug(t.slug)) throw new Error(`Tournament "${t.slug}" cannot have a poster: the slug must be lowercase letters, digits and hyphens (at most 80 characters).`);
    if (t.slug === CHANNEL_POSTER_SLUG) throw new Error(`Tournament slug "${CHANNEL_POSTER_SLUG}" is reserved for the channel poster.`);
    slugs.push(t.slug);
  }
  return slugs;
}

export interface PosterInput {
  slug: string;
  tournaments: readonly TournamentRecord[];
  /** PUBLIC_SITE_URL (env.siteUrl). */
  siteUrl: string | null;
  /** The strict release build (PS_STRICT=1): a local address is then as bad as none. */
  strict: boolean;
  channelName?: string;
}

/** Everything the poster page draws, or null when no poster exists for the slug. */
export function buildPoster(input: PosterInput): PosterModel | null {
  const isChannel = input.slug === CHANNEL_POSTER_SLUG;
  const record = isChannel ? undefined : input.tournaments.find((t) => t.slug === input.slug && t.status !== 'cancelled');
  if (!isChannel && !record) return null;

  const destination: QrDestination = isChannel ? { kind: 'channel' } : { kind: 'tournament', slug: input.slug };
  const origin = checkSiteOrigin(input.siteUrl, { allowLocalHttp: !input.strict });
  let qr: PosterModel['qr'] = { status: 'missing', todo: TODO_SITE_URL };
  if (origin.ok && !(input.strict && origin.local)) {
    const target = buildQrTarget(origin.origin, destination);
    if (target) {
      const shown = new URL(target);
      const title = isChannel ? 'QR code for the Power Smash channel' : `QR code for ${record!.name}`;
      qr = {
        status: 'ok',
        svg: qrSvg(target, { label: title }),
        target,
        displayUrl: `${shown.host}${shown.pathname === '/' ? '' : shown.pathname}`,
        preview: origin.local,
      };
    }
  }

  return {
    slug: input.slug,
    kind: isChannel ? 'channel' : 'tournament',
    headline: POSTER_HEADLINE,
    title: isChannel ? (input.channelName ?? 'Power Smash') : record!.name,
    dateLine: record ? formatDateRange(record.startDate, record.endDate) : '',
    placeLine: record ? tournamentPlace(record) : '',
    scanLine: POSTER_SCAN_LINE,
    qr,
  };
}
