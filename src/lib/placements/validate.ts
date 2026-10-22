// Validation of a placement the admin saves (spec 8.3, D-031). PURE. The admin form calls it; the database repeats the structural
// rules as constraints (supabase/migrations/0007_placements.sql). Messages are plain English for the owner.
import { isIsoDate } from '../dates';
import { hostOf } from './hosts';
import { SLOTS, isSlotKey, PLACEMENT_LABELS } from './slots';
import { findOverlaps } from './schedule';
import type { Placement, PlacementStatus } from './schedule';
import type { PlacementLabel, SlotKey } from './slots';

export interface PlacementInput {
  id?: string;
  sponsorId: string;
  slot: string;
  scopeKey?: string | null;
  creativeDesktopPath?: string | null;
  creativeMobilePath?: string | null;
  alt: string;
  headline?: string | null;
  /** The sponsor's landing page. https only; the host must be one the owner registered for the sponsor. */
  targetUrl: string;
  /** The sponsor's registered website: when given, the target host must equal its host or be a subdomain of it (D-031). */
  sponsorWebsite?: string | null;
  goSlug: string;
  startDate: string;
  endDate: string;
  priority?: number;
  label: string;
  status?: string;
}

export type PlacementField = 'sponsorId' | 'slot' | 'scopeKey' | 'creative' | 'alt' | 'headline' | 'targetUrl' | 'goSlug' | 'startDate' | 'endDate' | 'priority' | 'label' | 'status';

export type PlacementValidation =
  | { ok: true; value: Omit<Placement, 'id'> & { id?: string }; targetUrl: string; warnings: string[] }
  | { ok: false; errors: Partial<Record<PlacementField, string>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GO_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SCOPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A Storage key: letters, digits, `/ _ . -`, no `..`, no leading slash, no scheme. */
export const STORAGE_KEY = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9/_.-]{1,200}$/;
export const MAX_PRIORITY = 100;
export const STATUSES: readonly PlacementStatus[] = ['draft', 'active', 'paused', 'ended'];

/** The target must be https, with no login in it, on a real host name. Returns the normalised URL or null. */
export function cleanTargetUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || !u.hostname.includes('.')) return null;
  if (/^\d+(?:\.\d+){3}$/.test(u.hostname)) return null;
  return u.toString();
}

export function validatePlacement(input: PlacementInput, existing: readonly Placement[] = []): PlacementValidation {
  const errors: Partial<Record<PlacementField, string>> = {};
  const warnings: string[] = [];

  if (typeof input.sponsorId !== 'string' || !UUID.test(input.sponsorId)) errors.sponsorId = 'Choose the sponsor.';

  let slot: SlotKey | null = null;
  if (!isSlotKey(input.slot)) errors.slot = 'Choose a slot.';
  else if (!SLOTS[input.slot].availableInM3) errors.slot = 'That slot is not available yet.';
  else slot = input.slot;

  const scope = input.scopeKey ?? null;
  if (slot) {
    const def = SLOTS[slot];
    if (def.scoped === 'required' && scope === null) errors.scopeKey = 'Choose the tournament this is for.';
    if (def.scoped === 'none' && scope !== null) errors.scopeKey = 'This slot is not per tournament.';
    if (scope !== null && !SCOPE.test(scope)) errors.scopeKey = 'The tournament is not valid.';
  }

  const desktop = input.creativeDesktopPath?.trim() || null;
  const mobile = input.creativeMobilePath?.trim() || null;
  if (!desktop && !mobile) errors.creative = 'Add at least one image (desktop or mobile).';
  else if ((desktop && !STORAGE_KEY.test(desktop)) || (mobile && !STORAGE_KEY.test(mobile))) errors.creative = 'The image file is not valid. Upload it again.';
  else if (!desktop || !mobile) warnings.push('Only one image is set: the other screen size uses it too, so check how it looks.');

  const alt = (input.alt ?? '').trim();
  if (alt.length < 3) errors.alt = 'Describe the image in a few words (for people who cannot see it).';
  else if (alt.length > 200) errors.alt = 'Keep the image description under 200 characters.';

  const headline = input.headline == null ? null : input.headline.trim();
  if (headline !== null && headline.length > 80) errors.headline = 'Keep the headline under 80 characters.';

  const target = typeof input.targetUrl === 'string' ? cleanTargetUrl(input.targetUrl) : null;
  if (!target) errors.targetUrl = 'The link must start with https:// and be a real website address.';
  else if (input.sponsorWebsite !== undefined) {
    const reg = input.sponsorWebsite ? hostOf(input.sponsorWebsite) : null;
    const th = hostOf(target);
    if (!reg || !th || !(th === reg || th.endsWith(`.${reg}`))) errors.targetUrl = "The link must be on the sponsor's own website. Set the sponsor's website first.";
  }

  if (typeof input.goSlug !== 'string' || !GO_SLUG.test(input.goSlug)) errors.goSlug = 'Use lower-case letters, digits and hyphens only (up to 63 characters).';

  if (!isIsoDate(input.startDate)) errors.startDate = 'Choose a start date.';
  if (!isIsoDate(input.endDate)) errors.endDate = 'Choose an end date.';
  if (!errors.startDate && !errors.endDate && input.endDate < input.startDate) errors.endDate = 'The end date cannot be before the start date.';

  const priority = input.priority ?? 0;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > MAX_PRIORITY) errors.priority = `Priority is a whole number from 0 to ${MAX_PRIORITY}.`;

  if (!(PLACEMENT_LABELS as readonly string[]).includes(input.label)) errors.label = 'Choose "Sponsored" or "Partner".';

  const status = input.status ?? 'draft';
  if (!(STATUSES as readonly string[]).includes(status)) errors.status = 'The status is not valid.';

  // A go slug is unique across placements (it becomes the link).
  if (!errors.goSlug && existing.some((p) => p.goSlug === input.goSlug && p.id !== input.id)) errors.goSlug = 'That link name is already used. Choose another.';

  if (Object.keys(errors).length > 0 || !slot || !target) return { ok: false, errors };

  const value: Omit<Placement, 'id'> & { id?: string } = {
    ...(input.id ? { id: input.id } : {}),
    sponsorId: input.sponsorId,
    slot,
    scopeKey: scope,
    creativeDesktopPath: desktop,
    creativeMobilePath: mobile,
    alt,
    headline: headline === '' ? null : headline,
    goSlug: input.goSlug,
    startDate: input.startDate,
    endDate: input.endDate,
    priority,
    label: input.label as PlacementLabel,
    status: status as PlacementStatus,
  };

  // Overlap check against the others in the same slot and scope (an equal-priority overlap in a one-item slot is an error: the owner
  // must pick a priority so the outcome is not left to the order of the start dates).
  const candidate: Placement = { id: input.id ?? '00000000-0000-0000-0000-000000000000', ...value };
  const others = existing.filter((p) => p.id !== input.id);
  const overlaps = findOverlaps([...others, candidate]).filter((o) => o.a === candidate.id || o.b === candidate.id);
  if (overlaps.some((o) => o.kind === 'tie')) {
    return { ok: false, errors: { priority: 'Another placement in this slot runs on the same days with the same priority. Give one a higher priority or change the dates.' } };
  }
  if (overlaps.length > 0) warnings.push('This overlaps another placement in the same slot: the one with the higher priority is shown.');

  return { ok: true, value, targetUrl: target, warnings };
}
