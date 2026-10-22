// The placement schedule resolver (spec 8.3, D-031). PURE: no I/O, no clock (the caller passes today's IST date), no imports besides
// the slot catalogue, so the same code runs in the Worker, in the admin calendar and in the ~1 KB browser script.
//
// Dates are IST calendar dates `YYYY-MM-DD` (D-030). A placement is live from its start date through its END date inclusive
// (the last day runs to midnight India time). Plain string comparison is safe for validated ISO dates.
import { SLOTS, isSlotKey } from './slots';
import type { PlacementLabel, SlotKey } from './slots';

export type PlacementStatus = 'draft' | 'active' | 'paused' | 'ended';

export interface Placement {
  id: string;
  sponsorId: string;
  slot: SlotKey;
  /** Tournament slug for a per-tournament placement; null = applies to every page of the slot. */
  scopeKey: string | null;
  /** Storage keys of the creatives (public bucket); at least one is set on an active placement. */
  creativeDesktopPath: string | null;
  creativeMobilePath: string | null;
  alt: string;
  headline: string | null;
  goSlug: string;
  startDate: string;
  endDate: string;
  /** Higher wins. Whole number. */
  priority: number;
  label: PlacementLabel;
  status: PlacementStatus;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The IST calendar date of an instant, without Intl (the browser script uses it too). */
export function istDateOf(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Live on `date`: switched on, and the date lies inside the range (both ends inclusive). */
export function isLive(p: Pick<Placement, 'status' | 'startDate' | 'endDate'>, date: string): boolean {
  return p.status === 'active' && ISO.test(date) && p.startDate <= date && date <= p.endDate;
}

/** Order: a one-tournament placement beats a global one, then higher priority, then the earlier start, then the id (stable). */
export function compareForSlot(a: Placement, b: Placement): number {
  const scoped = Number(b.scopeKey !== null) - Number(a.scopeKey !== null);
  if (scoped !== 0) return scoped;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ResolveQuery {
  slot: SlotKey;
  date: string;
  /** The tournament slug of the page, when the page is a tournament page. */
  scopeKey?: string | null;
}

/**
 * The placements to show in one slot on one date, best first, at most the slot's `maxItems`.
 * A per-tournament placement only applies to its own tournament; a global one applies everywhere in the slot.
 * A per-tournament slot (`scoped: 'required'`) shows nothing without a matching scope.
 */
export function resolveSlot(placements: readonly Placement[], query: ResolveQuery): Placement[] {
  if (!isSlotKey(query.slot)) return [];
  const def = SLOTS[query.slot];
  const scope = query.scopeKey ?? null;
  const out = placements
    .filter((p) => p.slot === query.slot && isLive(p, query.date))
    .filter((p) => (p.scopeKey === null ? def.scoped !== 'required' : p.scopeKey === scope))
    .sort(compareForSlot);
  return out.slice(0, def.maxItems);
}

/** The single best placement (banners and titles). */
export const resolveOne = (placements: readonly Placement[], query: ResolveQuery): Placement | null => resolveSlot(placements, query)[0] ?? null;

// ---- overlap detection (admin calendar) -------------------------------------------------------------------------------

export interface Overlap {
  slot: SlotKey;
  scopeKey: string | null;
  a: string;
  b: string;
  from: string;
  to: string;
  /** `tie`: same priority, so the earlier start silently wins: the owner should decide. `priority`: resolved by priority. */
  kind: 'tie' | 'priority';
}

/** Statuses that occupy the calendar: a draft will go live, a paused or ended one does not. */
const occupies = (p: Placement): boolean => p.status === 'active' || p.status === 'draft';

/**
 * Overlapping date ranges in the same slot and the same scope, for slots that show ONE item (banners, titles). A strip shows several
 * partners, so only an overbooked strip (more concurrent placements than `maxItems`) is reported, as a `priority` overlap.
 */
export function findOverlaps(placements: readonly Placement[]): Overlap[] {
  const out: Overlap[] = [];
  const list = placements.filter(occupies);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i] as Placement;
      const b = list[j] as Placement;
      if (a.slot !== b.slot || a.scopeKey !== b.scopeKey) continue;
      const from = a.startDate > b.startDate ? a.startDate : b.startDate;
      const to = a.endDate < b.endDate ? a.endDate : b.endDate;
      if (from > to) continue;
      const def = SLOTS[a.slot];
      if (def.maxItems > 1) {
        const concurrent = list.filter((p) => p.slot === a.slot && p.scopeKey === a.scopeKey && p.startDate <= to && p.endDate >= from).length;
        if (concurrent <= def.maxItems) continue;
      }
      out.push({ slot: a.slot, scopeKey: a.scopeKey, a: a.id, b: b.id, from, to, kind: a.priority === b.priority ? 'tie' : 'priority' });
    }
  }
  return out.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.a < y.a ? -1 : 1));
}

/** Overlaps that need a decision: a new placement may not tie an existing one in a one-item slot. */
export const hasTie = (placements: readonly Placement[]): boolean => findOverlaps(placements).some((o) => o.kind === 'tie');
