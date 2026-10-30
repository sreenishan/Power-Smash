// The registration pages' model: one page per event that (a) is on a public competition page, (b) the registration data says takes
// registrations now, and (c) is NOT junior (fail closed, D-109: a junior event never shows a registration form, whatever the data says).
// Pure: no clock, no network. Addresses only through path() (R-LINKS); money only through formatInr (integer paise, D-020).
import { formatInr } from '../../money';
import { path } from '../../urls';
import type { CompetitionSite } from '../../competition/public/model';
import { playersForCategory } from '../constants';
import type { RawRegistrationData } from './provider';

export interface RegistrationPayment {
  instructions: string | null;
  /** Shown only together with the payee name (the database keeps them as a pair). */
  upiId: string | null;
  payeeName: string | null;
}

export interface RegistrationPage {
  eventId: string;
  tournamentSlug: string;
  tournamentName: string;
  eventCode: string;
  eventTitle: string;
  category: string;
  playersNeeded: 1 | 2;
  /** Integer paise, or null when the owner set no fee (nothing about a fee is shown). */
  feePaise: number | null;
  /** "₹500" when a fee is set, else null. */
  feeText: string | null;
  /** The payment texts, only for an event with a fee and only when the owner set them. */
  payment: RegistrationPayment | null;
  path: string;
  eventPath: string;
  tournamentPath: string;
  startDate: string | null;
  endDate: string | null;
}

/** /register/<tournament>/<event>/ (a sibling of the /competitions/ family, see src/pages/register/[tournament]/[event].astro) */
export const registrationPath = (tournamentSlug: string, eventCode: string): string => path(`/register/${tournamentSlug}/${eventCode}/`);

/** The output folder of the registration pages, relative to .vercel/output/static (for an optional prune step). */
export const REGISTRATION_OUTPUT_PATHS = ['register'] as const;

export function buildRegistrationPages(site: CompetitionSite, raw: RawRegistrationData): RegistrationPage[] {
  // registration is switched off (no payment row means the view returned nothing): no pages at all
  if (raw.payment === null) return [];
  const fees = new Map(raw.events.map((e) => [e.event_id, e.entry_fee_paise]));
  const pages: RegistrationPage[] = [];
  for (const t of site.tournaments) {
    for (const e of t.events) {
      if (!fees.has(e.id) || e.junior) continue;
      const feePaise = fees.get(e.id) ?? null;
      const p = raw.payment;
      const pair = p.upi_id && p.payee_name ? { upiId: p.upi_id, payeeName: p.payee_name } : { upiId: null, payeeName: null };
      const payment = feePaise !== null && (p.payment_instructions || pair.upiId) ? { instructions: p.payment_instructions, ...pair } : null;
      pages.push({
        eventId: e.id,
        tournamentSlug: t.slug,
        tournamentName: t.name,
        eventCode: e.code,
        eventTitle: e.title,
        category: e.category,
        playersNeeded: playersForCategory(e.category),
        feePaise,
        feeText: feePaise === null ? null : formatInr(feePaise, { trimZeroPaise: true }),
        payment,
        path: registrationPath(t.slug, e.code),
        eventPath: e.path,
        tournamentPath: t.path,
        startDate: t.startDate,
        endDate: t.endDate,
      });
    }
  }
  return pages;
}
