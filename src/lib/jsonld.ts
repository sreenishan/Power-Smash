// Safe JSON-LD serialiser and schema builders (D-029: "escape less-than, greater-than, ampersand, U+2028, U+2029").
// The ONLY place structured data is turned into a string. Components render it through src/components/site/JsonLd.astro.
// Only fields that are actually supplied are emitted: no invented values, nothing private.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

/** JSON for a <script type="application/ld+json"> body. The result can never close the script tag or break out of it. */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
}

/** Drop undefined, null and empty-string values (recursively) so a schema never carries an empty field. */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)).filter((v) => v !== undefined && v !== null && v !== '') as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = compact(v);
      if (c === undefined || c === null || c === '') continue;
      if (Array.isArray(c) && c.length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

export interface OrganizationInput {
  name: string;
  /** Absolute site origin, e.g. https://example.in/ */
  url: string;
  legalName?: string | null;
  /** Public profile URLs (YouTube, Instagram, Facebook). */
  sameAs: readonly (string | null | undefined)[];
  /** Absolute URL of a raster logo, only once one exists (the M0 logos are SVG). */
  logoUrl?: string | null;
}

export function organizationJsonLd(input: OrganizationInput): Record<string, Json | undefined> {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    legalName: input.legalName ?? undefined,
    url: input.url,
    logo: input.logoUrl ?? undefined,
    sameAs: input.sameAs.filter((u): u is string => typeof u === 'string' && u !== ''),
  });
}

export interface BreadcrumbItem {
  name: string;
  /** Absolute URL. */
  url: string;
}

export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): Record<string, Json | undefined> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface SportsEventInput {
  name: string;
  /** ISO date (YYYY-MM-DD, Asia/Kolkata calendar date). */
  startDate: string;
  endDate?: string | null;
  url: string;
  venue?: string | null;
  city?: string | null;
  organizerName?: string | null;
  status?: 'scheduled' | 'cancelled' | 'postponed' | null;
  description?: string | null;
}

const EVENT_STATUS: Record<NonNullable<SportsEventInput['status']>, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
};

/** SportsEvent for an UPCOMING tournament (spec 7.7). Contact details of organizers are never part of it. */
export function sportsEventJsonLd(input: SportsEventInput): Record<string, Json | undefined> {
  const hasPlace = Boolean(input.venue || input.city);
  return compact({
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: input.name,
    sport: 'Badminton',
    startDate: input.startDate,
    endDate: input.endDate ?? undefined,
    eventStatus: EVENT_STATUS[input.status ?? 'scheduled'],
    url: input.url,
    description: input.description ?? undefined,
    location: hasPlace
      ? {
          '@type': 'Place',
          name: input.venue ?? input.city ?? undefined,
          address: input.city ? { '@type': 'PostalAddress', addressLocality: input.city, addressCountry: 'IN' } : undefined,
        }
      : undefined,
    organizer: input.organizerName ? { '@type': 'Organization', name: input.organizerName } : undefined,
  });
}
