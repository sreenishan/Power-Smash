// "Placements expiring within 14 days" for the admin dashboard (spec 14). Pure. Server and admin only (it uses the date module).
import { daysBetween, isIsoDate } from '../dates';
import type { Placement } from './schedule';

export const EXPIRY_WINDOW_DAYS = 14;

export interface ExpiringPlacement {
  id: string;
  slot: Placement['slot'];
  scopeKey: string | null;
  endDate: string;
  /** Whole days from today to the end date: 0 = the last day is today. */
  daysLeft: number;
}

/**
 * Active placements whose last day falls from today through `windowDays` days ahead (inclusive), soonest first. A placement that
 * has not started yet is not "expiring"; one already past its end date is not listed (it is over).
 * Placements that a LATER placement of the same slot and scope follows seamlessly are still listed: the dashboard shows the fact,
 * the owner decides.
 */
export function expiringWithin(placements: readonly Placement[], today: string, windowDays: number = EXPIRY_WINDOW_DAYS): ExpiringPlacement[] {
  if (!isIsoDate(today)) throw new RangeError('expiringWithin needs an ISO calendar date');
  const out: ExpiringPlacement[] = [];
  for (const p of placements) {
    if (p.status !== 'active' || !isIsoDate(p.endDate) || !isIsoDate(p.startDate)) continue;
    if (p.startDate > today) continue;
    const daysLeft = daysBetween(today, p.endDate);
    if (daysLeft < 0 || daysLeft > windowDays) continue;
    out.push({ id: p.id, slot: p.slot, scopeKey: p.scopeKey, endDate: p.endDate, daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || (a.id < b.id ? -1 : 1));
}
