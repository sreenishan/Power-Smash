// The /international/ page model (D-112): owner-entered international events, split into upcoming (including running now) and recent,
// with India (IST) dates. Pure: "today" is injected.
//
// Fail closed on top of the view: a row is dropped when a date is not a real calendar date, the end is before the start, a required
// text is empty, or the link is not in the stored form the database accepts (storedLinkProblem with hosts = null: http(s), no user
// name, no port, no # part, no tracking parameter, a plain Latin host). The allow-list itself is applied by the api view (the build
// does not know the owner's extra hosts), so a link whose host the owner removed never reaches the build. THE VIEW'S HOST FILTER IS
// THE ONLY ALLOW-LIST GATE for the page (accepted, D-122): a render-time list would need the owner's extra hosts in a new public view;
// supabase/checks/0022_assertions.sql proves the view drops a removed website at once.
import { daysBetween, formatDateRange, isIsoDate, isOngoing } from '../../dates';
import { linkHost, storedLinkProblem } from '../link-rules';
import type { InternationalSource, PublicInternationalEventRow } from './provider';

/** How long a finished event stays under "Recent" (days after its last day). */
export const RECENT_DAYS = 90;

export interface InternationalItem {
  id: string;
  name: string;
  level: string | null;
  /** "12–17 November 2026" (IST calendar dates). */
  when: string;
  startDate: string;
  endDate: string;
  /** "Sample City, Demo Country", or the country alone. */
  place: string;
  url: string;
  /** The website the link opens, without "www.", for the external-link label. */
  host: string;
  ongoing: boolean;
}

export interface InternationalPage {
  source: InternationalSource;
  upcoming: InternationalItem[];
  recent: InternationalItem[];
  /** Rows left out because they failed a rule above (never shown). */
  dropped: number;
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function toItem(r: PublicInternationalEventRow, today: string): InternationalItem | null {
  const name = clean(r.name);
  const country = clean(r.country);
  if (!name || !country || typeof r.id !== 'string') return null;
  if (!isIsoDate(r.start_date) || !isIsoDate(r.end_date) || r.end_date < r.start_date) return null;
  if (typeof r.official_url !== 'string' || storedLinkProblem(r.official_url, null) !== null) return null;
  const host = linkHost(r.official_url);
  if (!host) return null;
  const city = clean(r.city);
  return {
    id: r.id,
    name,
    level: clean(r.level_text),
    when: formatDateRange(r.start_date, r.end_date),
    startDate: r.start_date,
    endDate: r.end_date,
    place: city ? `${city}, ${country}` : country,
    url: r.official_url,
    host,
    ongoing: isOngoing(r.start_date, r.end_date, today),
  };
}

export function buildInternationalPage(rows: readonly PublicInternationalEventRow[], opts: { source: InternationalSource; today: string; recentDays?: number }): InternationalPage {
  const recentDays = opts.recentDays ?? RECENT_DAYS;
  const upcoming: InternationalItem[] = [];
  const recent: InternationalItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of rows) {
    const item = r && typeof r === 'object' ? toItem(r, opts.today) : null;
    if (!item || seen.has(item.id)) {
      dropped += 1;
      continue;
    }
    seen.add(item.id);
    if (item.endDate >= opts.today) upcoming.push(item);
    else if (daysBetween(item.endDate, opts.today) <= recentDays) recent.push(item);
  }
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  recent.sort((a, b) => b.endDate.localeCompare(a.endDate) || a.name.localeCompare(b.name));
  return { source: opts.source, upcoming, recent, dropped };
}

/** The page of a build without the international page (no rows). */
export function emptyInternationalPage(): InternationalPage {
  return { source: 'supabase', upcoming: [], recent: [], dropped: 0 };
}
