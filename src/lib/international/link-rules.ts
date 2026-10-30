// International events listed with links only (D-112): the ONE rule module for the official link and the event fields, shared by the
// admin form (browser), the admin service (server), the public page model and, by mirror, migration 0022 (app.international_link_problem,
// app.international_host_problem). No zod here, so the browser bundle stays small. A change here is a change in the SQL too:
// tests/international/parity.test.ts compares the lists.
//
// The official link:
//  - http or https only, written as a full address; no user name or password in it, no port, no # part (it is dropped);
//  - its website (host) must be on the allow-list: the three defaults below, plus hosts the owner adds in the admin. "www." in front of
//    an allowed host is accepted too; any other sub-domain must be added by the owner itself;
//  - punycode (xn--) and non-Latin hosts are refused (lookalike letters), so are IP addresses and link shorteners (they hide where the
//    link goes);
//  - tracking parameters (utm_ and the like) are removed before the link is stored; nothing else in the address is changed.
// Nothing is ever fetched from the linked site: Power Smash copies no results, draws, rankings, logos or player data (D-112).

/** The websites every official link may point to (D-112). The owner can add more hosts in the admin; these cannot be removed. */
export const DEFAULT_ALLOWED_HOSTS = ['bwfbadminton.com', 'tournamentsoftware.com', 'bwf.tournamentsoftware.com'] as const;

/** Link shorteners: they hide where a link goes, so the owner cannot add them as a host. */
export const BLOCKED_HOSTS = ['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 's.id', 'lnkd.in'] as const;

/** Query parameters that only track a visitor. Removed from every link (exact names, case-insensitive; plus any name starting utm_). */
export const TRACKING_PARAMS = ['fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', '_ga', '_gl'] as const;
export const TRACKING_PREFIX = 'utm_';

export const MAX_EXTRA_HOSTS = 20;
export const MAX_LINK_LENGTH = 500;

export const FIELD_LIMITS = {
  name: { min: 3, max: 160 },
  levelText: { min: 2, max: 80 },
  city: { min: 1, max: 60 },
  country: { min: 2, max: 60 },
} as const;

/** The longest an event may last (days from the start date to the end date). */
export const MAX_EVENT_DAYS = 60;
export const MIN_DATE = '2000-01-01';
export const MAX_DATE = '2100-12-31';

export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith(TRACKING_PREFIX) || (TRACKING_PARAMS as readonly string[]).includes(n);
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_SHAPE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/**
 * Why a host the owner wants to add is refused (plain English), or null when it is fine. The host must be in its plain form:
 * lowercase, Latin letters, digits, hyphens and dots, at least one dot, a top-level part of letters only. Use cleanHost() first.
 */
export function hostProblem(host: string): string | null {
  if (host.length < 4 || host.length > 253) return 'Write a website name such as example.org (4 to 253 characters).';
  if (host.startsWith('www.')) return 'Leave out "www." at the start: it is accepted automatically.';
  if (host.includes('xn--')) return 'Website names in other alphabets (punycode, xn--) are not accepted, because they can imitate a real name.';
  if (!HOST_SHAPE.test(host)) return 'Write only the website name, such as example.org: letters a to z, digits, hyphens and dots, without https:// or a slash.';
  if (!/\.[a-z]{2,63}$/.test(host)) return 'A website name ends with letters, such as .com or .org (an IP address is not accepted).';
  if ((BLOCKED_HOSTS as readonly string[]).includes(host)) return 'Link shorteners are not accepted: they hide where the link goes. Use the official site itself.';
  return null;
}

/** A host as the owner typed it, in its plain form: trimmed, lowercase, without a scheme, a path or a leading "www.". */
export function cleanHost(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.replace(/[/?#].*$/, '');
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

/** The full allow-list: the defaults plus the owner's hosts. */
export function allowedHosts(extraHosts: readonly string[] = []): string[] {
  return [...new Set<string>([...DEFAULT_ALLOWED_HOSTS, ...extraHosts])];
}

/** The owner's list of extra hosts, cleaned, or the plain-English reason it is refused. Defaults and repeats are dropped quietly. */
export function cleanExtraHosts(input: readonly string[]): { ok: true; hosts: string[] } | { ok: false; problem: string } {
  const out: string[] = [];
  for (const raw of input) {
    if (raw.trim() === '') continue;
    const h = cleanHost(raw);
    const p = hostProblem(h);
    if (p) return { ok: false, problem: `${raw.trim().slice(0, 80)}: ${p}` };
    if ((DEFAULT_ALLOWED_HOSTS as readonly string[]).includes(h) || out.includes(h)) continue;
    out.push(h);
  }
  if (out.length > MAX_EXTRA_HOSTS) return { ok: false, problem: `Add at most ${MAX_EXTRA_HOSTS} websites.` };
  return { ok: true, hosts: out.sort() };
}

/** The host of a stored (canonical) link, without a leading "www.", or null. */
export function linkHost(url: string): string | null {
  const m = /^https?:\/\/([^/?#]+)\//.exec(url);
  if (!m) return null;
  const h = m[1] as string;
  return h.startsWith('www.') ? h.slice(4) : h;
}

// What the SQL accepts as a stored link (app.international_link_problem): the canonical form new URL() writes, without a # part.
const CANONICAL = /^(https?):\/\/([^/?#]+)(\/[^#]*)$/;

/**
 * Why a link in its STORED form is refused, or null. Mirrors app.international_link_problem in migration 0022 exactly (same order,
 * same sentences). `hosts` null = check the shape only (the public page model, which does not know the owner's extra hosts; the api
 * view applies the allow-list itself).
 */
export function storedLinkProblem(url: string, hosts: readonly string[] | null): string | null {
  if (url.length === 0) return 'the official link is missing';
  if (url.length > MAX_LINK_LENGTH) return `the official link must be ${MAX_LINK_LENGTH} characters or fewer`;
  if (/[\s\p{Cc}\\<>"`]/u.test(url)) return 'the official link holds a character that is not allowed (a space, a backslash, < > " or `)';
  const m = CANONICAL.exec(url);
  if (!m) return 'the official link must be a full address starting with https:// (or http://), without a # part';
  const authority = m[2] as string;
  if (authority.includes('@')) return 'the official link must not hold a user name or password';
  if (authority.includes(':')) return 'the official link must not name a port';
  if (authority !== authority.toLowerCase()) return 'the website name of the official link must be in small letters';
  const host = authority.startsWith('www.') ? authority.slice(4) : authority;
  if (host.includes('xn--') || hostShapeProblem(host)) return 'the website name of the official link is not valid';
  if (hosts !== null && !hosts.includes(host)) return `the official link must be on an allowed website (${hosts.join(', ')})`;
  const query = (m[3] as string).includes('?') ? (m[3] as string).slice((m[3] as string).indexOf('?') + 1) : '';
  for (const pair of query.split('&')) {
    const name = pair.split('=')[0] ?? '';
    if (name !== '' && isTrackingParam(name)) return 'the official link must not hold tracking parts (utm_ and similar)';
  }
  return null;
}

function hostShapeProblem(host: string): boolean {
  return host.length < 4 || host.length > 253 || !HOST_SHAPE.test(host) || !/\.[a-z]{2,63}$/.test(host);
}


export type LinkResult = { ok: true; url: string; host: string; removedTracking: boolean } | { ok: false; problem: string };

/**
 * The owner's link as typed, made ready to store: checked against the allow-list, tracking parameters and the # part removed.
 * The refusal is a plain-English sentence for the form.
 */
export function normaliseOfficialLink(input: string, extraHosts: readonly string[] = []): LinkResult {
  const hosts = allowedHosts(extraHosts);
  const raw = input.trim();
  if (raw === '') return { ok: false, problem: 'Paste the link to the official page of the event.' };
  if (raw.length > MAX_LINK_LENGTH) return { ok: false, problem: `The link is too long (at most ${MAX_LINK_LENGTH} characters).` };
  if (/[\s\p{Cc}\\]/u.test(raw)) return { ok: false, problem: 'The link must not contain spaces or a backslash. Copy it again from the address bar.' };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, problem: 'The link must start with https:// (copy the whole address from the address bar).' };
  if (!/^https?:\/\/[^/]/i.test(raw)) return { ok: false, problem: 'The link must start with https:// followed by the website name.' };
  // the authority as typed (new URL() would quietly drop a default port and turn non-Latin letters into punycode)
  const authority = raw.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] ?? '';
  if (authority.includes('@')) return { ok: false, problem: 'The link must not contain a user name or password (an @ before the website name).' };
  if (authority.includes(':')) return { ok: false, problem: 'The link must not name a port (a : and a number after the website name).' };
  if (/[^\x21-\x7e]/.test(authority) || authority.toLowerCase().includes('xn--')) {
    return { ok: false, problem: 'Website names with letters from other alphabets are not accepted, because they can imitate a real name.' };
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, problem: 'This is not a complete web address. Copy it again from the address bar.' };
  }
  let host = u.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  if (!hosts.includes(bare)) {
    return { ok: false, problem: `The link must be on ${listText(hosts)}. "${bare.slice(0, 80)}" is not on the list; you can add a website under "Allowed websites".` };
  }
  let removedTracking = false;
  for (const name of [...u.searchParams.keys()]) {
    if (isTrackingParam(name)) {
      u.searchParams.delete(name);
      removedTracking = true;
    }
  }
  u.hash = '';
  u.hostname = host;
  const url = u.toString();
  const problem = storedLinkProblem(url, hosts);
  if (problem) return { ok: false, problem: sentence(problem) };
  return { ok: true, url, host: bare, removedTracking };
}

/** "a, b or c". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const sentence = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Days from one YYYY-MM-DD date to another (calendar days, no time zone involved). */
export function dayDiff(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export interface InternationalEventInput {
  name: string;
  levelText: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  officialUrl: string;
  published: boolean;
}

export interface CleanInternationalEvent {
  name: string;
  levelText: string | null;
  startDate: string;
  endDate: string;
  city: string | null;
  country: string;
  officialUrl: string;
  published: boolean;
}

const squash = (s: string): string => s.trim().replace(/\s+/g, ' ');

function textProblem(value: string, label: string, limits: { min: number; max: number }): string | null {
  if (value.length < limits.min || value.length > limits.max) return `${label} must be ${limits.min} to ${limits.max} characters.`;
  if (/[\p{Cc}<>]/u.test(value)) return `${label} must not contain < or >.`;
  return null;
}

/**
 * The event form, checked and cleaned. Field errors are plain English, keyed by the form field. Used by the admin screen (before
 * sending) and the admin service (before the RPC, which checks the same again).
 */
export function checkInternationalEvent(
  input: InternationalEventInput,
  extraHosts: readonly string[] = [],
): { ok: true; value: CleanInternationalEvent; removedTracking: boolean } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = squash(input.name);
  const levelText = squash(input.levelText);
  const city = squash(input.city);
  const country = squash(input.country);
  const n = textProblem(name, 'The name', FIELD_LIMITS.name);
  if (n) errors.name = n;
  if (levelText !== '') {
    const l = textProblem(levelText, 'The level', FIELD_LIMITS.levelText);
    if (l) errors.levelText = l;
  }
  if (city !== '') {
    const c = textProblem(city, 'The city', FIELD_LIMITS.city);
    if (c) errors.city = c;
  }
  const co = textProblem(country, 'The country', FIELD_LIMITS.country);
  if (co) errors.country = country === '' ? 'Write the country.' : co;
  const start = input.startDate.trim();
  const end = input.endDate.trim();
  if (!isRealDate(start) || start < MIN_DATE || start > MAX_DATE) errors.startDate = 'Choose the first day of the event.';
  if (!isRealDate(end) || end < MIN_DATE || end > MAX_DATE) errors.endDate = 'Choose the last day of the event.';
  if (!errors.startDate && !errors.endDate) {
    if (end < start) errors.endDate = 'The last day cannot be before the first day.';
    else if (dayDiff(start, end) > MAX_EVENT_DAYS) errors.endDate = `An event can last at most ${MAX_EVENT_DAYS} days.`;
  }
  const link = normaliseOfficialLink(input.officialUrl, extraHosts);
  if (!link.ok) errors.officialUrl = link.problem;
  if (Object.keys(errors).length > 0 || !link.ok) return { ok: false, errors };
  return {
    ok: true,
    value: { name, levelText: levelText || null, startDate: start, endDate: end, city: city || null, country, officialUrl: link.url, published: input.published === true },
    removedTracking: link.removedTracking,
  };
}
