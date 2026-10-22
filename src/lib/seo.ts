// SEO helpers: indexing safety (hard rule 9), robots.txt, titles, canonical and Open Graph defaults. Pure functions.

/**
 * Default Open Graph image (a path under public/). It is an SVG today and WhatsApp, Facebook and X link previews do not
 * render an SVG og:image (docs/BRAND.md, D-041 item 5). When the owner approves a rasteriser, produce og-default.png
 * (1200 x 630) and change ONLY this constant.
 */
export const DEFAULT_OG_IMAGE_PATH = '/brand/og-default.svg';
export const DEFAULT_OG_IMAGE_ALT = 'Power Smash';
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export const SITE_NAME = 'Power Smash';

/** Indexing is OFF unless the build variable PUBLIC_ALLOW_INDEXING is exactly "true" (set only at G1). */
export function isIndexingAllowed(raw: string | undefined | null): boolean {
  return raw === 'true';
}

/** A page is noindex when its own prop asks for it OR indexing is not allowed. A page can never turn noindex off. */
export function shouldNoindex(options: { pageNoindex?: boolean; allowIndexing: boolean }): boolean {
  return options.pageNoindex === true || !options.allowIndexing;
}

/**
 * Page title with the brand suffix: "Services | Power Smash". A title that already contains the brand is left alone.
 */
export function titleWithBrand(title: string): string {
  const t = title.trim();
  return t.toLowerCase().includes(SITE_NAME.toLowerCase()) ? t : `${t} | ${SITE_NAME}`;
}

/**
 * Page paths end with a slash ("/about/"): the build writes /about/index.html and the canonical must match what the server
 * serves. The rule lives in ONE place, src/lib/urls.ts (R-LINKS): this is the same function under its older name, kept so
 * existing imports keep working. Use path() and absoluteUrl() from urls.ts in new code.
 */
export { path as withTrailingSlash } from './urls';

export interface RobotsOptions {
  allowIndexing: boolean;
  /** Absolute sitemap URL. Pass it only when a sitemap is really built (none in M1). */
  sitemapUrl?: string | null;
}

/** robots.txt body: Disallow everything unless indexing is allowed. */
export function robotsTxt(options: RobotsOptions): string {
  if (!options.allowIndexing) {
    return 'User-agent: *\nDisallow: /\n';
  }
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /go/', // tracked redirects are never indexed (D-031)
  ];
  if (options.sitemapUrl) lines.push('', `Sitemap: ${options.sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}

/** Title and description for every page this worker owns (unique, checked by tests/site/seo.test.ts). */
export const PAGE_META = {
  home: {
    title: 'Power Smash - Tamil Nadu Badminton Videos & Tournament Coverage',
    description:
      'Power Smash is a Tamil Nadu badminton YouTube channel. Book tournament coverage, partner with us, or ask for your match video and highlight reel.',
  },
  services: {
    title: 'Tournament Coverage & Player Videos',
    description:
      'Coverage for Tamil Nadu badminton tournaments, plus highlight reels and match files for players. See the packages and ask for a quote.',
  },
  pricing: {
    title: 'Pricing',
    description:
      'Every Power Smash coverage, player-video, promotion and sponsorship product in one place, with the delivery and refund policies.',
  },
  support: {
    title: 'Support the Channel',
    description:
      'Join the Power Smash YouTube channel, follow us on Instagram and Facebook, and share the channel with other badminton players.',
  },
  about: {
    title: 'About Power Smash',
    description: 'Who Power Smash is: a YouTube-first badminton media brand for Tamil Nadu players and tournaments.',
  },
  tournaments: {
    title: 'Badminton Tournaments',
    description:
      'Tamil Nadu badminton tournaments listed by Power Smash, upcoming and past. Organizers can list a tournament for free.',
  },
  notFound: {
    title: 'Page not found',
    description: 'That page does not exist. Here are the most useful places to go next.',
  },
  serverError: {
    title: 'Something went wrong',
    description: 'The site had a problem. Try again in a minute, or message us on WhatsApp.',
  },
} as const;
