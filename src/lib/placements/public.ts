// The PUBLIC schedule served by `/api/placements` (D-031) and the `/go` links derived from placements. PURE.
//
// The payload holds only what a visitor's browser needs to show a creative: ids, slot, scope, image URLs, alt text, label,
// the `/go/<slug>` href and the date range. It NEVER holds the sponsor's contact fields, notes, target URL or status of anything
// that is not live. The browser picks the creative for today's date with `resolveSlot` (schedule.ts), so there is no rebuild lag.
import type { GoLinks } from '../infra/go';
import { hostOf } from './hosts';
import { SLOTS } from './slots';
import { isLive } from './schedule';
import type { Placement } from './schedule';
import type { PlacementLabel, SlotKey } from './slots';

export interface PublicPlacement {
  id: string;
  slot: SlotKey;
  scope: string | null;
  desktop: string | null;
  mobile: string | null;
  alt: string;
  headline: string | null;
  label: PlacementLabel;
  /** `/go/<slug>`: the tracked redirect. The sponsor's own URL is never in the payload. */
  href: string;
  start: string;
  end: string;
  priority: number;
}

export interface PublicSchedule {
  /** Payload version, bumped on a breaking change to the shape. */
  v: 1;
  /** The IST date the schedule was built for. */
  today: string;
  placements: PublicPlacement[];
}

export interface PublicScheduleOptions {
  /** Base URL of the public creative bucket, no trailing slash (for example the Supabase Storage public path). */
  creativeBase: string;
  /** Upcoming placements within this many days are included, so a creative can switch at midnight IST without a new fetch. Default 1. */
  horizonDays?: number;
}

const addDays = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Join a base URL and a Storage key without doubling or losing a slash; keys are already restricted to safe characters. */
export const creativeUrl = (base: string, key: string): string => `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;

export function buildPublicSchedule(placements: readonly Placement[], today: string, options: PublicScheduleOptions): PublicSchedule {
  const horizon = addDays(today, Math.max(0, Math.min(7, options.horizonDays ?? 1)));
  const out: PublicPlacement[] = [];
  for (const p of placements) {
    if (p.status !== 'active' || p.endDate < today || p.startDate > horizon) continue;
    if (!p.creativeDesktopPath && !p.creativeMobilePath) continue;
    out.push({
      id: p.id,
      slot: p.slot,
      scope: p.scopeKey,
      desktop: p.creativeDesktopPath ? creativeUrl(options.creativeBase, p.creativeDesktopPath) : null,
      mobile: p.creativeMobilePath ? creativeUrl(options.creativeBase, p.creativeMobilePath) : null,
      alt: p.alt,
      headline: p.headline,
      label: p.label,
      href: `/go/${p.goSlug}`,
      start: p.startDate,
      end: p.endDate,
      priority: p.priority,
    });
  }
  out.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.id < b.id ? -1 : 1));
  return { v: 1, today, placements: out };
}

/** Rebuild `Placement` objects from the public payload (the browser script needs the same resolver input). */
export function placementsFromPublic(schedule: PublicSchedule): Placement[] {
  return schedule.placements.map((p) => ({
    id: p.id,
    sponsorId: '',
    slot: p.slot,
    scopeKey: p.scope,
    creativeDesktopPath: p.desktop,
    creativeMobilePath: p.mobile,
    alt: p.alt,
    headline: p.headline,
    goSlug: p.href.replace(/^\/go\//, ''),
    startDate: p.start,
    endDate: p.end,
    priority: p.priority,
    label: p.label,
    status: 'active',
  }));
}

/** Slots that have at least one live placement today (for the admin calendar and a quick "is anything running" answer). */
export function liveSlots(placements: readonly Placement[], today: string): SlotKey[] {
  const keys = new Set<SlotKey>();
  for (const p of placements) if (isLive(p, today)) keys.add(p.slot);
  return [...keys].sort((a, b) => Object.keys(SLOTS).indexOf(a) - Object.keys(SLOTS).indexOf(b));
}

// ---- /go links from placements (D-031: slugs resolve from the database; the contract is src/lib/infra/go.ts) ----------------

export interface SponsorForGo {
  id: string;
  /** The sponsor's registered website; its host (and subdomains) become allowed redirect hosts. */
  website: string | null;
}

export interface PlacementGoData {
  links: GoLinks;
  allowedHosts: string[];
}

/**
 * Turn the live and upcoming placements into the `GoLinks` map and the allowed-host list that `handleGo` takes.
 *  - `targetId` is the PLACEMENT id (a uuid), so `outbound_clicks.target_id` joins to the placement.
 *  - `label` is `sponsored` or `partner`, from the placement label.
 *  - `expires` is the end date (the go handler reads a date-only value as "through the end of that day in India").
 *  - A placement whose target host is not the sponsor's registered host (or a subdomain) is left out: the redirect never leads to a
 *    host the owner did not register (D-031).
 *  - Paused, draft and ended placements are left out: their slug answers 404.
 */
export function placementsToGoData(placements: readonly Placement[], targets: Readonly<Record<string, string>>, sponsors: readonly SponsorForGo[]): PlacementGoData {
  const links: Record<string, GoLinks[string]> = {};
  const hosts = new Set<string>();
  const sponsorHost = new Map<string, string>();
  for (const s of sponsors) {
    const h = s.website ? hostOf(s.website) : null;
    if (h) sponsorHost.set(s.id, h);
  }
  for (const p of placements) {
    if (p.status !== 'active') continue;
    const target = targets[p.id];
    const registered = sponsorHost.get(p.sponsorId);
    const targetHost = target ? hostOf(target) : null;
    if (!target || !registered || !targetHost) continue;
    if (!(targetHost === registered || targetHost.endsWith(`.${registered}`))) continue;
    links[p.goSlug] = { target, label: p.label === 'Partner' ? 'partner' : 'sponsored', expires: p.endDate, targetId: p.id };
    hosts.add(registered);
  }
  return { links, allowedHosts: [...hosts].sort() };
}
