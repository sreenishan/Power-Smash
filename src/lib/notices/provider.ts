// Where the notice banner gets its notices, read ONCE per build (static pages; a change shows after the next site update, which the
// admin says). Three cases, fail closed:
//  - the STRICT release build (PS_STRICT=1): only when features.siteNotices is on AND PS_NOTICES_SOURCE is exactly "supabase" (then
//    api.public_site_notices with the PUBLISHABLE key); otherwise NO notices. A release build never shows the sample.
//  - other builds with PS_NOTICES_SOURCE exactly "supabase": the same view, but ALSO only while features.siteNotices is on (a preview
//    is a publication: real owner notices never show before the flag allows them).
//  - other builds otherwise: the FICTIONAL sample only when PS_NOTICES_SAMPLE is exactly "1" (so the developer can see the banner),
//    else none (other pages and their tests are unchanged by default).
// A read failure in the release build fails the build (the caller does not catch it); a notice is never invented.
import { isAcceptableSupabaseUrl } from '../supabase/rest';
import { readAllRows } from '../competition/public/supabase-provider';
import { activeNotices, PUBLIC_SITE_NOTICE_COLUMNS, type PublicSiteNotice } from './site-notices';
import { siteNoticesFlag } from './switches';

export type NoticesEnv = Readonly<Record<string, string | undefined>>;

/** FICTIONAL sample notices (invented text, an internal link and no contact data). */
export const SEED_SITE_NOTICES: readonly PublicSiteNotice[] = [
  {
    id: 'sample-notice-1',
    title: 'Sample notice: the Sample City Open draw is out',
    body: 'This is sample text for the developer build. Real notices come from the admin.',
    link_path: '/competitions/',
    link_url: null,
    link_label: 'See the competitions',
    starts_at: null,
    ends_at: null,
    updated_at: '2026-10-31T00:00:00.000Z',
  },
];

export interface NoticeSourceDecision {
  source: 'none' | 'seed' | 'supabase';
}

export function noticeSource(env: NoticesEnv, flags: { siteNotices: boolean } = { siteNotices: siteNoticesFlag() }): NoticeSourceDecision {
  const supabase = env.PS_NOTICES_SOURCE === 'supabase';
  if (env.PS_STRICT === '1') return { source: flags.siteNotices === true && supabase ? 'supabase' : 'none' };
  if (supabase) return { source: flags.siteNotices === true ? 'supabase' : 'none' };
  return { source: env.PS_NOTICES_SAMPLE === '1' ? 'seed' : 'none' };
}

export async function loadSiteNotices(
  env: NoticesEnv = readEnv(),
  o: { fetch?: typeof fetch; now?: () => Date; flags?: { siteNotices: boolean } } = {},
): Promise<PublicSiteNotice[]> {
  const { source } = noticeSource(env, o.flags);
  const now = (o.now ?? (() => new Date()))();
  if (source === 'none') return [];
  if (source === 'seed') return activeNotices(SEED_SITE_NOTICES, now);
  const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!url || !key || !isAcceptableSupabaseUrl(url)) throw new Error('notices_supabase_settings_missing');
  const rows = await readAllRows<PublicSiteNotice>({ url, publishableKey: key, fetch: o.fetch ?? fetch }, 'public_site_notices', PUBLIC_SITE_NOTICE_COLUMNS, 'id.asc');
  return activeNotices(rows, now);
}

let cached: Promise<PublicSiteNotice[]> | null = null;
/** One read per build (every page includes the banner). */
export function siteNoticesOnce(): Promise<PublicSiteNotice[]> {
  cached ??= loadSiteNotices();
  return cached;
}

function readEnv(): NoticesEnv {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
