// Pure helpers of the International events screen (D-112): the empty form, a form from a stored event, the in-browser check (the same
// shared rules the server applies, src/lib/international/link-rules.ts), the host list as typed, and the owner-facing sentences.
import { formatDateRange } from '../../../lib/dates';
import { checkInternationalEvent, cleanExtraHosts } from '../../../lib/international/link-rules';
import type { InternationalEventDto, InternationalSaveInput } from '../../../lib/admin/international/types';

export interface EventForm {
  id: string | null;
  expectedRevision: number | null;
  name: string;
  levelText: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  officialUrl: string;
  published: boolean;
  reason: string;
}

export const EMPTY_EVENT_FORM: EventForm = {
  id: null, expectedRevision: null, name: '', levelText: '', startDate: '', endDate: '', city: '', country: '', officialUrl: '', published: false, reason: '',
};

export function formFromEvent(e: InternationalEventDto): EventForm {
  return {
    id: e.id, expectedRevision: e.revision, name: e.name, levelText: e.levelText ?? '', startDate: e.startDate, endDate: e.endDate, city: e.city ?? '',
    country: e.country, officialUrl: e.officialUrl, published: e.published, reason: '',
  };
}

/** The field errors the browser can find before sending (plain English), including the reason. Empty = fine to send. */
export function formProblems(f: EventForm, extraHosts: readonly string[]): Record<string, string> {
  const checked = checkInternationalEvent(f, extraHosts);
  const errors = checked.ok ? {} : { ...checked.errors };
  const reason = f.reason.trim();
  if (reason.length < 3 || reason.length > 500) errors.reason = 'Write a short reason (3 to 500 characters). It is kept in the record of changes.';
  return errors;
}

export function toSaveInput(f: EventForm): InternationalSaveInput {
  return { ...f, reason: f.reason.trim() };
}

/** The hosts box: one website per line (or separated by commas or spaces). */
export function hostsFromText(text: string): string[] {
  return text.split(/[\s,;]+/).map((h) => h.trim()).filter((h) => h !== '');
}

export function hostsProblem(text: string): string | null {
  const r = cleanExtraHosts(hostsFromText(text));
  return r.ok ? null : r.problem;
}

export function eventWhen(e: Pick<InternationalEventDto, 'startDate' | 'endDate'>): string {
  return formatDateRange(e.startDate, e.endDate);
}

export function eventPlace(e: Pick<InternationalEventDto, 'city' | 'country'>): string {
  return e.city ? `${e.city}, ${e.country}` : e.country;
}

/** What the owner is told about an event's state on the website. */
export function stateText(e: Pick<InternationalEventDto, 'published' | 'onAllowList'>, pageSwitchOn: boolean): string {
  if (!e.published) return 'Hidden: not on the website.';
  if (!e.onAllowList) return 'Shown, but its link is no longer on an allowed website, so the website leaves it out. Edit the link or add the website again.';
  return pageSwitchOn ? 'Shown on the International events page.' : 'Shown on the International events page once that page is switched on.';
}

export function savedText(r: { created: boolean; fields: string[]; removedTracking: boolean }): string {
  const base = r.created ? 'Event added.' : r.fields.length === 0 ? 'Nothing changed.' : 'Event saved.';
  return r.removedTracking ? `${base} Tracking parts (such as utm_) were removed from the link.` : base;
}

export function hostsSavedText(r: { fields: string[]; eventsOffList: number }): string {
  const base = r.fields.length === 0 ? 'Nothing changed.' : 'Allowed websites saved.';
  if (r.eventsOffList === 0) return base;
  return `${base} ${r.eventsOffList === 1 ? '1 shown event links' : `${r.eventsOffList} shown events link`} to a website that is no longer allowed and will be left out of the website until the link is changed.`;
}
