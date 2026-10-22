// Build-time glue for the four form pages (Astro frontmatter only; never imported by a React island, so no site facts or
// build variables end up in the island bundle beyond the few values the page passes as props).
import { env } from '../../config/env';
import { CONSENT, type ConsentText } from '../../content/consent';
import { products } from '../../content/products';
import { site } from '../../content/site';
import { sponsorPackages } from '../../content/sponsor-packages';
import { ROUTES } from '../urls';
import { resolveTurnstileMode, type TurnstileMode } from './turnstile';
import type { FormDef, Option } from './types';

/** Value of an optional owner-supplied text field on `site` (null when the field does not exist yet or is blank). */
export function optionalSiteText(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** `{ value: slug, label: name }` options for a select, from products or sponsor packages. */
export function packageOptions(list: readonly { slug: string; name: string }[]): Option[] {
  return list.map((p) => ({ value: p.slug, label: p.name }));
}

/**
 * The allow-list for `/contact?topic=<key>` (R-TOPIC): every product key (coverage packages, add-ons, player products, promotion)
 * and every sponsor package key, with its name. A key that is not in this list pre-fills nothing, and text from the address bar
 * is never copied into the form.
 */
export function topicOptions(): Option[] {
  return [...packageOptions(products), ...packageOptions(sponsorPackages)];
}

/**
 * A form definition as the page hands it to the island: plain JSON (no `undefined` values, no functions), because Astro writes
 * island props into the page as JSON. The definitions run at build time only, so their text is not part of the page's JavaScript.
 */
export function plainForm(form: FormDef): FormDef {
  return JSON.parse(JSON.stringify(form)) as FormDef;
}

/** tel: link from a phone number the owner wrote in any format. null when there are no usable digits. */
export function telHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `tel:${raw.startsWith('+') ? '+' : ''}${digits}`;
}

export interface FormPageConfig {
  /** CONSENT.leadNotice: shown above the Send button and stored (id + version) with every submission. */
  leadNotice: ConsentText;
  /** CONSENT.requestNotice: the notice on /request (profile and content-removal requests). */
  requestNotice: ConsentText;
  /** CONSENT.tournamentPublicContact.text: the label of the separate tick box on /tournaments/submit. */
  publicContactText: string;
  turnstileMode: TurnstileMode;
  turnstileSiteKey: string | null;
  whatsappNumber: string | null;
  /** e.g. "24 hours" (site.replyTimePromise, owner-supplied). null = promise nothing. */
  replyPromise: string | null;
  /** Public path of an owner-supplied media kit PDF (site.mediaKitPdfPath). null = no download shown. */
  mediaKitPath: string | null;
  /** Opening hours text for /contact (site.contactHours). null = hidden. */
  contactHours: string | null;
  /** The "Privacy Policy" link in the notice above the Send button (one URL helper, R-LINKS). */
  privacyHref: string;
  coveragePackages: Option[];
  coverageAddOns: Option[];
  sponsorPackages: Option[];
}

export function formPageConfig(): FormPageConfig {
  return {
    leadNotice: CONSENT.leadNotice,
    requestNotice: CONSENT.requestNotice,
    publicContactText: CONSENT.tournamentPublicContact.text,
    turnstileMode: resolveTurnstileMode({ siteKey: env.turnstileSiteKey, dev: import.meta.env.DEV }),
    turnstileSiteKey: env.turnstileSiteKey,
    whatsappNumber: site.whatsappNumber,
    replyPromise: optionalSiteText(site, 'replyTimePromise'),
    mediaKitPath: optionalSiteText(site, 'mediaKitPdfPath'),
    contactHours: optionalSiteText(site, 'contactHours'),
    privacyHref: ROUTES.privacy,
    coveragePackages: packageOptions(products.filter((p) => p.group === 'organizers')),
    coverageAddOns: packageOptions(products.filter((p) => p.group === 'addons')),
    sponsorPackages: packageOptions(sponsorPackages),
  };
}
