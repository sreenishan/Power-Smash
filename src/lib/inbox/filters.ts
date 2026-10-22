// Inbox filters, sort and board grouping. PURE.
import { followUpState } from './followup';
import type { FollowUpState } from './followup';
import type { InboxLead, LeadType } from './lead';
import { LEAD_STATUSES, PIPELINE, STATUS_LABELS, nextStatuses } from './status';
import type { LeadStatus } from './status';

export interface InboxFilter {
  statuses?: readonly LeadStatus[];
  types?: readonly LeadType[];
  /** Matches the reference, name, organisation and source page (case-insensitive); digits also match the phone. */
  text?: string;
  /** Only leads in this follow-up state (open leads only). */
  followUp?: FollowUpState | 'due';
  /** Created on or after this IST date. */
  createdFrom?: string;
  /** Created on or before this IST date. */
  createdTo?: string;
  /** Only leads with a deal value set. */
  hasValue?: boolean;
}

export type SortKey = 'newest' | 'oldest' | 'follow_up' | 'value';

/** The IST calendar date of an ISO instant. */
export const istDateOfInstant = (iso: string): string => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function matchesFilter(lead: InboxLead, f: InboxFilter, today: string): boolean {
  if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(lead.status)) return false;
  if (f.types && f.types.length > 0 && !f.types.includes(lead.type)) return false;
  if (f.text && f.text.trim() !== '') {
    const q = norm(f.text);
    const hay = norm([lead.refCode, lead.name, lead.organization ?? '', lead.sourcePath ?? ''].join(' '));
    const digits = q.replace(/\D/g, '');
    const phoneHit = digits.length >= 4 && lead.phone !== null && lead.phone.includes(digits);
    if (!hay.includes(q) && !phoneHit) return false;
  }
  if (f.followUp) {
    const s = followUpState(lead, today);
    if (f.followUp === 'due' ? !(s === 'overdue' || s === 'due_today') : s !== f.followUp) return false;
  }
  if (f.createdFrom || f.createdTo) {
    const d = istDateOfInstant(lead.createdAt);
    if (f.createdFrom && d < f.createdFrom) return false;
    if (f.createdTo && d > f.createdTo) return false;
  }
  if (f.hasValue === true && lead.valuePaise === null) return false;
  return true;
}

export function sortLeads(leads: readonly InboxLead[], key: SortKey): InboxLead[] {
  const byCreated = (a: InboxLead, b: InboxLead): number => a.createdAt.localeCompare(b.createdAt) || a.refCode.localeCompare(b.refCode);
  const copy = [...leads];
  switch (key) {
    case 'oldest':
      return copy.sort(byCreated);
    case 'follow_up':
      // dated follow-ups first (soonest first), then undated, newest first inside each group
      return copy.sort((a, b) => {
        if (a.followUpOn && b.followUpOn) return a.followUpOn.localeCompare(b.followUpOn) || byCreated(b, a);
        if (a.followUpOn) return -1;
        if (b.followUpOn) return 1;
        return byCreated(b, a);
      });
    case 'value':
      return copy.sort((a, b) => (b.valuePaise ?? -1) - (a.valuePaise ?? -1) || byCreated(b, a));
    default:
      return copy.sort((a, b) => byCreated(b, a));
  }
}

export function filterLeads(leads: readonly InboxLead[], f: InboxFilter, today: string, sort: SortKey = 'newest'): InboxLead[] {
  return sortLeads(
    leads.filter((l) => matchesFilter(l, f, today)),
    sort,
  );
}

// ---- board (kanban columns with move-to buttons; no drag and drop in Phase 1, D-035) ----------------------------------

export interface BoardColumn {
  status: LeadStatus;
  label: string;
  leads: InboxLead[];
  count: number;
  /** Sum of the deal values that ARE set (integer paise). Leads with no value add nothing; no value is estimated. */
  valuePaise: number;
  /** How many leads in the column have no value set. */
  withoutValue: number;
}

/** Columns in board order: the pipeline, then Lost. Each column's leads keep the order of the input. */
export function groupByColumn(leads: readonly InboxLead[]): BoardColumn[] {
  const order: LeadStatus[] = [...PIPELINE, 'lost'];
  return order.map((status) => {
    const inColumn = leads.filter((l) => l.status === status);
    const known = inColumn.filter((l) => l.valuePaise !== null);
    return {
      status,
      label: STATUS_LABELS[status],
      leads: inColumn,
      count: inColumn.length,
      valuePaise: known.reduce((s, l) => s + (l.valuePaise as number), 0),
      withoutValue: inColumn.length - known.length,
    };
  });
}

/** The "Move to" buttons for a card: the statuses the machine allows, labelled. */
export function moveButtons(status: LeadStatus): Array<{ to: LeadStatus; label: string; needsReason: boolean }> {
  return nextStatuses(status).map((to) => ({ to, label: `Move to ${STATUS_LABELS[to]}`, needsReason: to === 'lost' }));
}

/** Count per status for the table's filter chips. */
export function countByStatus(leads: readonly InboxLead[]): Record<LeadStatus, number> {
  const out = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const l of leads) out[l.status] += 1;
  return out;
}
