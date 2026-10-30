// In-site notices (src/lib/notices/site-notices.ts, provider.ts), the WhatsApp Channel link (channel.ts), the banner and the
// stay-updated components (source checks), and the email texts. The TS rules are compared with the 0023 SQL. Fictional data only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { whatsappChannelLink } from '../../src/lib/notices/channel';
import { buildConfirmationEmail, renderSubscriberAnnouncement } from '../../src/lib/notices/emails';
import { loadSiteNotices, noticeSource, SEED_SITE_NOTICES } from '../../src/lib/notices/provider';
import {
  activeNotices,
  noticeHref,
  noticeLinkOk,
  noticePathOk,
  noticeProblems,
  PUBLIC_SITE_NOTICE_COLUMNS,
  SITE_NOTICE_LINK_PATTERNS,
  SITE_NOTICE_PATH_SQL,
  type NoticeInput,
  type PublicSiteNotice,
} from '../../src/lib/notices/site-notices';
import { emailNotificationsFlag, siteNoticesFlag } from '../../src/lib/notices/switches';

const sql = readFileSync('supabase/migrations/0023_notifications.sql', 'utf8').replace(/\r\n/g, '\n');
const NOW = new Date('2026-10-31T06:00:00.000Z');
const input = (over: Partial<NoticeInput> = {}): NoticeInput => ({ title: 'Sample notice', body: null, linkPath: null, linkUrl: null, linkLabel: null, audience: 'public', startsAt: null, endsAt: null, ...over });
const row = (over: Partial<PublicSiteNotice> = {}): PublicSiteNotice => ({ id: 'n1', title: 'Sample notice', body: null, link_path: null, link_url: null, link_label: null, starts_at: null, ends_at: null, updated_at: '2026-10-30T00:00:00.000Z', ...over });

describe('the rules equal the SQL', () => {
  it('uses the same link and page patterns as app.site_notice_link_ok and app.site_notice_path_ok', () => {
    for (const p of SITE_NOTICE_LINK_PATTERNS) expect(sql).toContain(`p_url ~ '${p}'`);
    expect(sql).toContain(`p_path ~ '${SITE_NOTICE_PATH_SQL}'`);
  });

  it('the public column list equals api.public_site_notices', () => {
    const view = /create view api\.public_site_notices[\s\S]*?from public\.site_notices n/.exec(sql)?.[0] ?? '';
    const cols = [...view.matchAll(/^\s+n\.([a-z_]+),?$/gm)].map((m) => m[1]);
    expect(cols).toEqual([...PUBLIC_SITE_NOTICE_COLUMNS]);
  });

  it('pages and links: the same cases as 0023_assertions.sql', () => {
    for (const ok of ['/', '/competitions/']) expect(noticePathOk(ok)).toBe(true);
    for (const bad of ['/api/notify/', '//evil.test/', '/competitions', 'https://example.com/']) expect(noticePathOk(bad)).toBe(false);
    for (const ok of ['https://www.youtube.com/@PowerSmash', 'https://whatsapp.com/channel/0029SampleChannel0000', 'https://www.instagram.com/sample_account/']) expect(noticeLinkOk(ok)).toBe(true);
    for (const ok of ['https://www.youtube.com/@SampleChannel/videos', 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'https://youtube.com/playlist?list=PLsample00000', 'https://www.youtube.com/shorts/BBBBBBBBBBB']) {
      expect(noticeLinkOk(ok), ok).toBe(true);
    }
    // YouTube's own redirectors would bounce a visitor to any site
    for (const bad of [
      'https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.test',
      'https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DAAAAAAAAAAA',
      'https://www.youtube.com/watch?v=AAAAAAAAAAA&redirect=x',
      'https://www.youtube.com/x',
    ]) {
      expect(noticeLinkOk(bad), bad).toBe(false);
    }
    for (const bad of ['https://example.com/', 'http://www.youtube.com/x', 'https://wa.me/910000000000', 'https://whatsapp.com/send?phone=910000000000', 'https://www.youtube.com.evil.test/']) {
      expect(noticeLinkOk(bad)).toBe(false);
    }
  });
});

describe('noticeProblems (the admin form, before the round trip)', () => {
  it('accepts a clean notice', () => expect(noticeProblems(input({ body: 'Sample text.', linkPath: '/competitions/', linkLabel: 'See them' }))).toEqual({}));
  it.each([
    ['title', input({ title: 'x' })],
    ['title', input({ title: 'Call 91 00000 00000' })],
    ['body', input({ body: 'Write to fake@example.test' })],
    ['link', input({ linkPath: '/a/', linkUrl: 'https://www.youtube.com/x', linkLabel: 'See' })],
    ['linkPath', input({ linkPath: '/api/x/', linkLabel: 'See' })],
    ['linkUrl', input({ linkUrl: 'https://example.com/', linkLabel: 'See' })],
    ['linkLabel', input({ linkPath: '/competitions/' })],
    ['linkLabel', input({ linkLabel: 'Words without a link' })],
    ['endsAt', input({ startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' })],
  ])('names the field %s', (field, i) => expect(Object.keys(noticeProblems(i))).toContain(field));
});

describe('what the banner shows', () => {
  it('only open windows, only clean rows, newest first, at most three', () => {
    const rows = [
      row({ id: 'a', updated_at: '2026-10-29T00:00:00.000Z' }),
      row({ id: 'b', updated_at: '2026-10-30T00:00:00.000Z' }),
      row({ id: 'future', starts_at: '2026-11-01T00:00:00.000Z' }),
      row({ id: 'ended', ends_at: '2026-10-31T05:00:00.000Z' }),
      row({ id: 'dirty', title: 'Call 910000000000' }),
      row({ id: 'c', updated_at: '2026-10-28T00:00:00.000Z' }),
      row({ id: 'd', updated_at: '2026-10-27T00:00:00.000Z' }),
    ];
    expect(activeNotices(rows, NOW).map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('links: internal pages through path(), outside links only from the allow-list', () => {
    expect(noticeHref({ link_path: '/competitions/', link_url: null })).toEqual({ href: '/competitions/', external: false });
    expect(noticeHref({ link_path: null, link_url: 'https://www.youtube.com/@PowerSmash' })).toEqual({ href: 'https://www.youtube.com/@PowerSmash', external: true });
    expect(noticeHref({ link_path: null, link_url: 'https://evil.example/' })).toBeNull();
    expect(noticeHref({ link_path: null, link_url: null })).toBeNull();
  });
});

describe('where notices come from (fail closed)', () => {
  it('a release build shows nothing unless the switch is on AND the database is the source; never the sample', () => {
    expect(noticeSource({ PS_STRICT: '1' }, { siteNotices: true })).toEqual({ source: 'none' });
    expect(noticeSource({ PS_STRICT: '1', PS_NOTICES_SOURCE: 'supabase' }, { siteNotices: false })).toEqual({ source: 'none' });
    expect(noticeSource({ PS_STRICT: '1', PS_NOTICES_SAMPLE: '1' }, { siteNotices: true })).toEqual({ source: 'none' });
    expect(noticeSource({ PS_STRICT: '1', PS_NOTICES_SOURCE: 'supabase' }, { siteNotices: true })).toEqual({ source: 'supabase' });
  });

  it('other builds read real notices only while features.siteNotices is on (a preview is a publication)', async () => {
    expect(noticeSource({ PS_NOTICES_SOURCE: 'supabase' }, { siteNotices: false })).toEqual({ source: 'none' });
    expect(noticeSource({ PS_NOTICES_SOURCE: 'supabase' }, { siteNotices: true })).toEqual({ source: 'supabase' });
    let fetched = 0;
    const f = (async () => {
      fetched += 1;
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    const env = { PS_NOTICES_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'https://fakeproject.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKE' };
    expect(await loadSiteNotices(env, { fetch: f, now: () => NOW, flags: { siteNotices: false } })).toEqual([]);
    expect(fetched).toBe(0);
  });

  it('other builds: the sample only when asked, else nothing', async () => {
    expect(noticeSource({}, { siteNotices: false })).toEqual({ source: 'none' });
    expect(await loadSiteNotices({}, { now: () => NOW, flags: { siteNotices: false } })).toEqual([]);
    const sample = await loadSiteNotices({ PS_NOTICES_SAMPLE: '1' }, { now: () => NOW, flags: { siteNotices: false } });
    expect(sample.map((n) => n.id)).toEqual(SEED_SITE_NOTICES.map((n) => n.id));
    expect(sample[0]?.title).toMatch(/^Sample notice/);
  });

  it('reads api.public_site_notices with the publishable key and explicit columns', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify([row({ id: 'db1', title: 'Database notice' })]), { status: 200 });
    }) as typeof fetch;
    const env = { PS_NOTICES_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'https://fakeproject.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: ['sb', 'publishable', 'FAKE'].join('_') };
    const got = await loadSiteNotices(env, { fetch: f, now: () => NOW, flags: { siteNotices: true } });
    expect(got.map((n) => n.id)).toEqual(['db1']);
    expect(calls[0]?.url).toContain('/rest/v1/public_site_notices?select=');
    expect(decodeURIComponent(calls[0]?.url ?? '')).toContain(PUBLIC_SITE_NOTICE_COLUMNS.join(','));
    expect(calls[0]?.headers['accept-profile']).toBe('api');
    await expect(loadSiteNotices({ PS_NOTICES_SOURCE: 'supabase' }, { flags: { siteNotices: true } })).rejects.toThrow(/settings_missing/);
  });

  it('the page switches read as off until the integrator adds them, and only exactly true counts', () => {
    expect(siteNoticesFlag({})).toBe(false);
    expect(emailNotificationsFlag({})).toBe(false);
    expect(siteNoticesFlag({ siteNotices: 'true' })).toBe(false);
    expect(siteNoticesFlag({ siteNotices: true })).toBe(true);
    expect(emailNotificationsFlag({ emailNotifications: true })).toBe(true);
  });
});

describe('WhatsApp Channel', () => {
  it('only a real Channel link becomes a button; a chat link or a number never does', () => {
    expect(whatsappChannelLink('https://whatsapp.com/channel/0029SampleChannel0000')).toBe('https://whatsapp.com/channel/0029SampleChannel0000');
    expect(whatsappChannelLink(' https://www.whatsapp.com/channel/0029SampleChannel0000/ ')).toBe('https://whatsapp.com/channel/0029SampleChannel0000');
    for (const bad of [null, undefined, '', 'https://wa.me/910000000000', 'https://api.whatsapp.com/send?phone=910000000000', 'http://whatsapp.com/channel/0029SampleChannel0000', 'https://whatsapp.com/channel/short']) {
      expect(whatsappChannelLink(bad)).toBeNull();
    }
  });
});

describe('email texts', () => {
  it('the confirmation email holds only the link and says what happens otherwise; no reply-time promise', () => {
    const m = buildConfirmationEmail({ confirmUrl: 'https://fake-site.example/api/notify/confirm?t=x' });
    expect(m.subject).toBe('Confirm your email for Power Smash updates');
    expect(m.text).toContain('https://fake-site.example/api/notify/confirm?t=x');
    expect(m.text).toContain('If you did not ask for this, do nothing');
    expect(m.text).not.toMatch(/24 hours|reply within/i);
  });

  it('an announcement refuses contact data and stays plain text', () => {
    const ok = renderSubscriberAnnouncement({ title: 'Sample news', body: 'Line one\r\n\r\n\r\n\r\nLine two' });
    expect(ok).toEqual({ ok: true, subject: 'Sample news', body: 'Hi there,\n\nLine one\n\nLine two\n\n- Power Smash' });
    const bad = renderSubscriberAnnouncement({ title: 'x', body: 'Call 910000000000' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['body', 'title']);
  });
});

describe('components (source checks)', () => {
  // code only: the comment lines may name what the code must never do
  const code = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l))
      .join('\n');
  const banner = code('src/components/site/notices/SiteNoticeBanner.astro');
  const stay = code('src/components/site/notices/StayUpdated.astro');
  const form = code('src/components/site/notices/SubscribeForm.tsx');
  it('never use set:html or dangerouslySetInnerHTML, never a hand-written wa.me link, never an owner marker', () => {
    for (const src of [banner, stay, form]) {
      expect(src).not.toMatch(/set:html|dangerouslySetInnerHTML/);
      expect(src).not.toMatch(/wa\.me/);
      expect(src).not.toContain(['TODO', '(owner)'].join(''));
    }
  });
  it('the banner links through noticeHref (path() inside); the channel button only through whatsappChannelLink', () => {
    expect(banner).toContain('noticeHref(n)');
    expect(stay).toContain('whatsappChannelLink(');
    expect(stay).toContain('siteNoticesFlag()');
    expect(stay).toContain('emailNotificationsFlag()');
  });
  it('the form asks for no name and no phone number, and has two separate unticked boxes', () => {
    expect(form).not.toMatch(/type="tel"|autoComplete="name"|phone/i);
    expect(form).toContain("useState(false);\n  const [adult, setAdult] = useState(false);");
  });
});
