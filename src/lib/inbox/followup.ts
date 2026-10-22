// Follow-up logic in India time (spec 8.1, D-030). PURE: the caller passes today's IST date (`todayIst()` from src/lib/dates.ts).
//
// A follow-up date is an IST calendar date. An OPEN lead (not completed, not lost) is:
//   overdue    its date is before today
//   due_today  its date is today
//   upcoming   its date is after today
//   none       no date set, or the lead is closed
import { daysBetween, isIsoDate } from '../dates';
import type { InboxLead } from './lead';
import { isOpen } from './status';

export type FollowUpState = 'overdue' | 'due_today' | 'upcoming' | 'none';

export function followUpState(lead: Pick<InboxLead, 'status' | 'followUpOn'>, today: string): FollowUpState {
  if (!isOpen(lead.status) || !lead.followUpOn || !isIsoDate(lead.followUpOn)) return 'none';
  if (lead.followUpOn < today) return 'overdue';
  return lead.followUpOn === today ? 'due_today' : 'upcoming';
}

/** Whole days until the follow-up (negative = days overdue), or null when there is nothing to follow up. */
export function followUpDays(lead: Pick<InboxLead, 'status' | 'followUpOn'>, today: string): number | null {
  return followUpState(lead, today) === 'none' ? null : daysBetween(today, lead.followUpOn as string);
}

/** Leads whose follow-up is due today or overdue, most overdue first (the morning digest and the dashboard card). */
export function dueLeads<T extends Pick<InboxLead, 'status' | 'followUpOn' | 'refCode'>>(leads: readonly T[], today: string): T[] {
  return leads
    .filter((l) => {
      const s = followUpState(l, today);
      return s === 'overdue' || s === 'due_today';
    })
    .sort((a, b) => (a.followUpOn as string).localeCompare(b.followUpOn as string) || a.refCode.localeCompare(b.refCode));
}

/** How far ahead a follow-up date may be set. */
export const FOLLOW_UP_MAX_DAYS = 366;

export type FollowUpValidation = { ok: true; date: string | null } | { ok: false; error: string };

/** Validate a follow-up date the owner picked. An empty value clears the date. A date in the past is refused (use today or later). */
export function validateFollowUpDate(value: unknown, today: string): FollowUpValidation {
  if (value === null || value === undefined || value === '') return { ok: true, date: null };
  if (!isIsoDate(value)) return { ok: false, error: 'Choose a valid date.' };
  if (value < today) return { ok: false, error: 'Choose today or a later date.' };
  if (daysBetween(today, value) > FOLLOW_UP_MAX_DAYS) return { ok: false, error: 'Choose a date within the next year.' };
  return { ok: true, date: value };
}
