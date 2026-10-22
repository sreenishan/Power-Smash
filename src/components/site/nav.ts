// Navigation data for the header and footer (spec 6.2, limited to pages that EXIST in M1).
// No Matches, Players, search, Live, Alerts or Send-your-video links until those pages exist (M2/M3).
// Audience entry points (D-024, D-025): organizers, sponsors, players and parents.
// Every href is written through path() (src/lib/urls.ts, R-LINKS): internal pages end with a slash ("/services/").

import { features as siteFeatures } from '../../content/legal/status';
import { ARCHIVE_ROUTES, PLAYERS_SECTION, ROUTES, path } from '../../lib/urls';

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

const link = (label: string, href: string): NavLink => ({ label, href: path(href) });

/** Every page that exists in M1 (the shell pages plus /book, /contact, /partner, /tournaments/submit and the legal pages), in canonical slash form. */
export const M1_ROUTES: readonly string[] = Object.values(ROUTES);

/** Header navigation: three audience entry points, then Tournaments. */
export const headerNav: readonly NavLink[] = [
  link('Organizers', ROUTES.services),
  link('Sponsors', ROUTES.partner),
  link('Players & parents', PLAYERS_SECTION),
  link('Tournaments', ROUTES.tournaments),
];

/** Archive links (Matches, Players). Shown ONLY when features.archivePages is true (D-012 wording approved); see headerNavFor(). */
export const archiveHeaderLinks: readonly NavLink[] = [link('Matches', ARCHIVE_ROUTES.matches), link('Players', ARCHIVE_ROUTES.players)];

/** The header navigation for a feature set. With archivePages off it is exactly `headerNav`. */
export function headerNavFor(flags: { readonly archivePages: boolean } = siteFeatures): readonly NavLink[] {
  if (flags.archivePages !== true) return headerNav;
  return [...headerNav.slice(0, 3), ...archiveHeaderLinks, ...headerNav.slice(3)];
}

export const bookCoverageLink: NavLink = link('Book coverage', ROUTES.book);

export interface FooterGroup {
  readonly title: string;
  readonly links: readonly NavLink[];
}

export const footerGroups: readonly FooterGroup[] = [
  {
    title: 'Organizers',
    links: [
      link('Coverage packages', ROUTES.services),
      link('Pricing', ROUTES.pricing),
      link('Book coverage', ROUTES.book),
      link('List your tournament', ROUTES.submitTournament),
    ],
  },
  {
    title: 'Sponsors',
    links: [link('Partner with us', ROUTES.partner)],
  },
  {
    title: 'Players & parents',
    links: [
      link('Highlight reels and match files', PLAYERS_SECTION),
      link('Tournaments', ROUTES.tournaments),
      link('Support the channel', ROUTES.support),
    ],
  },
  {
    title: 'Power Smash',
    links: [link('About', ROUTES.about), link('Contact', ROUTES.contact)],
  },
];

/** The footer groups for a feature set. With archivePages off it is exactly `footerGroups`; on, the archive links join "Players & parents". */
export function footerGroupsFor(flags: { readonly archivePages: boolean } = siteFeatures): readonly FooterGroup[] {
  if (flags.archivePages !== true) return footerGroups;
  return footerGroups.map((g) => (g.title === 'Players & parents' ? { ...g, links: [...archiveHeaderLinks.map((l) => (l.label === 'Matches' ? link('Match videos', ARCHIVE_ROUTES.matches) : link('Player profiles', ARCHIVE_ROUTES.players))), ...g.links] } : g));
}

export const legalLinks: readonly NavLink[] = [
  link('Privacy policy', ROUTES.privacy),
  link('Terms of use', ROUTES.terms),
  link('Cancellation and refunds', ROUTES.refunds),
  link('Delivery policy', ROUTES.delivery),
  link('Disclosures', ROUTES.disclosures),
  link('Content removal', ROUTES.contentRemoval),
];

/** Strip the query and hash: "/services/#players" -> "/services/". */
export function pathOf(href: string): string {
  return href.split('#')[0].split('?')[0];
}

const withoutTrailingSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The nav link for the current page is marked aria-current. The first-level section matches its children. Slash or no slash. */
export function isCurrent(href: string, pathname: string): boolean {
  if (href.includes('#')) return false; // anchors never mark a page as current
  const target = withoutTrailingSlash(pathOf(href));
  const here = withoutTrailingSlash(pathname);
  if (target === '/') return here === '/';
  return here === target || here.startsWith(`${target}/`);
}
