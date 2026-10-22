// Video submissions (spec 7.12, spec 14 "Submissions", D-019): the owner reviews a link somebody sent. PURE rules.
//
// Status machine: new > approved > uploaded | rejected (new may also go straight to rejected). Nothing is fetched, embedded or published
// from here: the link is stored text, shown as text. `uploaded` records the owner's OWN YouTube upload by its 11-character id.
// The review status lives in the lead's `payload.review` (the leads table has its own, different, status column that the status machine
// of src/lib/inbox keeps in step: approved = contacted, uploaded = completed, rejected = lost).
import { CONSENT } from '../../content/consent';
import type { LeadStatus } from '../inbox/status';
import { canTransition } from '../inbox/status';

export const SUBMISSION_STATUSES = ['new', 'approved', 'uploaded', 'rejected'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

const NEXT: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  new: ['approved', 'rejected'],
  approved: ['uploaded', 'rejected'],
  uploaded: [],
  rejected: [],
};
export const nextSubmissionStatuses = (from: SubmissionStatus): readonly SubmissionStatus[] => NEXT[from];

export const isSubmissionStatus = (v: unknown): v is SubmissionStatus => typeof v === 'string' && (SUBMISSION_STATUSES as readonly string[]).includes(v);

/** A YouTube video id is exactly 11 characters: letters, digits, `-` and `_`. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const REJECT_REASON_MIN = 3;
export const REJECT_REASON_MAX = 500;

export type ReviewAction = 'approve' | 'reject' | 'mark_uploaded';
export interface ReviewInput {
  action: ReviewAction;
  reason?: string | null;
  youtubeId?: string | null;
}

export type ReviewValidation =
  | { ok: true; to: SubmissionStatus; reason: string | null; youtubeId: string | null }
  | { ok: false; errors: Record<string, string> };

export function validateReview(current: SubmissionStatus, input: ReviewInput): ReviewValidation {
  const to: SubmissionStatus = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'uploaded';
  if (!NEXT[current].includes(to)) {
    return {
      ok: false,
      errors: {
        status:
          current === 'uploaded' || current === 'rejected'
            ? 'This submission is finished. It cannot be changed.'
            : input.action === 'mark_uploaded'
              ? 'Approve it first, then mark it uploaded.'
              : 'It is already approved.',
      },
    };
  }
  if (to === 'rejected') {
    const reason = (input.reason ?? '').replace(/\s+/g, ' ').trim();
    if (reason.length < REJECT_REASON_MIN) return { ok: false, errors: { reason: 'Say why you are rejecting it (a few words).' } };
    if (reason.length > REJECT_REASON_MAX) return { ok: false, errors: { reason: `Keep the reason under ${REJECT_REASON_MAX} characters.` } };
    return { ok: true, to, reason, youtubeId: null };
  }
  if (to === 'uploaded') {
    const id = (input.youtubeId ?? '').trim();
    if (!YOUTUBE_ID.test(id)) {
      return { ok: false, errors: { youtubeId: /[/.:?=]/.test(id) ? 'Type only the 11 characters of the video id, not the whole address (the part after v= or youtu.be/).' : 'A YouTube video id is exactly 11 letters, digits, - or _.' } };
    }
    return { ok: true, to, reason: null, youtubeId: id };
  }
  return { ok: true, to, reason: null, youtubeId: null };
}

/** The lead status that goes with a submission status; applied only when the lead status machine allows the move. */
export const leadStatusFor = (to: SubmissionStatus): LeadStatus | null => (to === 'approved' ? 'contacted' : to === 'uploaded' ? 'completed' : to === 'rejected' ? 'lost' : null);

export function leadMove(from: LeadStatus, to: SubmissionStatus): LeadStatus | null {
  const target = leadStatusFor(to);
  return target !== null && target !== from && canTransition(from, target) ? target : null;
}

// ----------------------------------------------------------------------------- view model

export interface SubmissionConsent {
  id: string;
  /** The version the submitter saw, stored with the submission. */
  version: string;
  given: boolean;
  /** Plain label for the owner. */
  label: string;
  /** The version this site build holds now; differs when the wording changed since. */
  currentVersion: string | null;
}

export interface VideoSubmission {
  /** The lead id. */
  id: string;
  refCode: string;
  createdAt: string;
  submitterName: string;
  role: string | null;
  /** Stored text only: never fetched, never rendered as HTML. */
  videoUrl: string;
  tournamentName: string | null;
  matchDate: string | null;
  category: string | null;
  round: string | null;
  players: string | null;
  notes: string | null;
  footageSource: string | null;
  organizerName: string | null;
  filmingPermission: string | null;
  minorsVisible: string | null;
  consents: SubmissionConsent[];
  status: SubmissionStatus;
  youtubeId: string | null;
  rejectReason: string | null;
}

export const CONSENT_LABEL: Record<string, string> = {
  [CONSENT.adultConfirmation.id]: 'The sender confirms they are an adult',
  [CONSENT.videoRights.id]: 'The sender confirms they have the rights to the video',
  [CONSENT.videoLicence.id]: 'The sender agrees to the licence to show the video',
  [CONSENT.videoRemoval.id]: 'The sender understands the removal terms',
};

/** The four required video-submission consent ids, in display order. */
export const SUBMISSION_CONSENT_IDS = [CONSENT.adultConfirmation.id, CONSENT.videoRights.id, CONSENT.videoLicence.id, CONSENT.videoRemoval.id] as const;

const currentVersionOf = (id: string): string | null => {
  for (const n of Object.values(CONSENT)) if (n.id === id) return n.version;
  return null;
};

export function consentView(entries: readonly { id: string; version: string; given: boolean }[]): SubmissionConsent[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return SUBMISSION_CONSENT_IDS.map((id) => {
    const e = byId.get(id);
    return { id, version: e?.version ?? 'not stored', given: e?.given === true, label: CONSENT_LABEL[id] ?? id, currentVersion: currentVersionOf(id) };
  });
}

type Row = Record<string, unknown>;
const text = (v: unknown, max = 600): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);

/** Builds the view model from a `leads` row (type video_submission), its payload and its consent events; null for an unusable row. */
export function submissionFromLead(lead: Row, consents: readonly { id: string; version: string; given: boolean }[]): VideoSubmission | null {
  const id = text(lead.id);
  const ref = text(lead.ref_code);
  const created = text(lead.created_at);
  const payload = (lead.payload && typeof lead.payload === 'object' ? lead.payload : {}) as Row;
  const url = text(payload.videoUrl, 2048);
  if (!id || !ref || !created || !url || lead.type !== 'video_submission') return null;
  const review = (payload.review && typeof payload.review === 'object' ? payload.review : {}) as Row;
  const status = isSubmissionStatus(review.status) ? review.status : 'new';
  const fromPayload = ['adultConfirmation', 'videoRights', 'videoLicence', 'videoRemoval']
    .map((k) => payload[k] as { id?: unknown; version?: unknown; given?: unknown } | undefined)
    .filter((c): c is { id: string; version: string; given: boolean } => !!c && typeof c.id === 'string' && typeof c.version === 'string' && typeof c.given === 'boolean');
  return {
    id,
    refCode: ref,
    createdAt: created,
    submitterName: text(lead.name, 120) ?? '',
    role: text(payload.role, 40),
    videoUrl: url,
    tournamentName: text(payload.tournamentName),
    matchDate: text(payload.matchDate, 10),
    category: text(payload.category, 40),
    round: text(payload.round, 40),
    players: text(payload.players),
    notes: text(payload.notes, 2000),
    footageSource: text(payload.footageSource, 40),
    organizerName: text(payload.organizerName, 120),
    filmingPermission: text(payload.filmingPermission, 20),
    minorsVisible: text(payload.minorsVisible, 20),
    consents: consentView(consents.length > 0 ? consents : fromPayload),
    status,
    youtubeId: text(review.youtubeId, 11),
    rejectReason: text(review.reason, REJECT_REASON_MAX),
  };
}

/** A link is made clickable only when it is a plain https address; everything else stays text. */
export function safeHttpsHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.toString() : null;
  } catch {
    return null;
  }
}
