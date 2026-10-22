// Lead status machine (spec 8.1, D-025): new > contacted > quoted > won > completed, or lost (with a reason). PURE.
//
// The statuses are the ones the database accepts (0001 `leads_status_check`). Rules:
//  - Moving FORWARD may skip a stage (a lead can be won after the first call, without a written quote).
//  - Moving BACK one stage is allowed so a slip of the thumb can be undone ("undo wherever possible", spec 14), but never out of
//    `completed` (a finished job) and never to a stage that was not the previous one.
//  - `lost` can be set from any open stage and needs a reason; a lost lead can be REOPENED to `new`.
//  - `completed` is final.
export const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'completed', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** The board's open columns in order, then the two ends. */
export const PIPELINE: readonly LeadStatus[] = ['new', 'contacted', 'quoted', 'won', 'completed'];

export const STATUS_LABELS: Readonly<Record<LeadStatus, string>> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  won: 'Won',
  completed: 'Completed',
  lost: 'Lost',
};

export const isLeadStatus = (value: unknown): value is LeadStatus => typeof value === 'string' && (LEAD_STATUSES as readonly string[]).includes(value);

/** Closed leads are never "due" for a follow-up. */
export const isOpen = (status: LeadStatus): boolean => status !== 'completed' && status !== 'lost';

/** Suggested lost reasons for a tap-to-fill chip row; the owner may type their own. Plain wording, not statistics. */
export const LOST_REASON_PRESETS: readonly string[] = ['Price', 'No reply', 'Went with someone else', 'Not a fit', 'Dates did not work', 'Duplicate enquiry'];
export const LOST_REASON_MIN = 3;
export const LOST_REASON_MAX = 500;

const index = (s: LeadStatus): number => PIPELINE.indexOf(s);

/** The statuses a lead may move to from `from`. */
export function nextStatuses(from: LeadStatus): LeadStatus[] {
  if (from === 'completed') return [];
  if (from === 'lost') return ['new'];
  const i = index(from);
  const forward = PIPELINE.slice(i + 1);
  const back = i > 0 ? [PIPELINE[i - 1] as LeadStatus] : [];
  return [...forward, ...back, 'lost'];
}

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return nextStatuses(from).includes(to);
}

export type TransitionResult = { ok: true; status: LeadStatus; lostReason: string | null } | { ok: false; error: string };

/**
 * Validate a move. Going to `lost` needs a reason (trimmed, 3 to 500 characters); any other move clears the stored reason
 * (so a reopened lead does not keep an old "lost" reason).
 */
export function validateTransition(from: unknown, to: unknown, lostReason?: string | null): TransitionResult {
  if (!isLeadStatus(from) || !isLeadStatus(to)) return { ok: false, error: 'That status is not valid.' };
  if (from === to) return { ok: false, error: 'The enquiry is already at that stage.' };
  if (!canTransition(from, to)) return { ok: false, error: `An enquiry cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.` };
  if (to === 'lost') {
    const reason = (lostReason ?? '').replace(/\s+/g, ' ').trim();
    if (reason.length < LOST_REASON_MIN) return { ok: false, error: 'Say why it was lost (a few words).' };
    if (reason.length > LOST_REASON_MAX) return { ok: false, error: `Keep the reason under ${LOST_REASON_MAX} characters.` };
    return { ok: true, status: to, lostReason: reason };
  }
  return { ok: true, status: to, lostReason: null };
}
