// Claims versus reality (review finding C-11). The legal pages state a few facts about what the site does. Each guard below reads
// the SOURCE of the site and fails when the code and a flag in src/content/legal/status.ts disagree, so a feature cannot ship
// while the policy still describes the site without it (or the other way round).
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goLinks } from '../../src/content/go-links';
import { buildAlertText } from '../../src/lib/notify/telegram';
import { analyticsTokenIsValid, features } from '../../src/content/legal/status';
import { ROOT, readRepoFile } from './helpers';

const SRC = join(ROOT, 'src');
const EXT = /\.(ts|tsx|astro|js|mjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

/** Source lines of code, without comment-only lines (starting with //, a block-comment opener or a star). Good enough to look for API names. */
function codeLines(file: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((text, i) => {
      const t = text.trim();
      if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')) return;
      out.push({ line: i + 1, text });
    });
  return out;
}

const FILES = walk(SRC);
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
const outsideLegal = (f: string) => !rel(f).startsWith('src/content/legal/') && !rel(f).startsWith('src/components/legal/');

function hits(re: RegExp, filter: (f: string) => boolean = outsideLegal): string[] {
  const found: string[] = [];
  for (const f of FILES.filter(filter)) for (const l of codeLines(f)) if (re.test(l.text)) found.push(`${rel(f)}:${l.line}`);
  return found;
}

describe('the guards themselves bite', () => {
  it('codeLines skips comment-only lines and keeps code, so a planted storage call is found and a mention in a comment is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ps-reality-'));
    try {
      const file = join(dir, 'planted.ts');
      writeFileSync(file, ['// localStorage is not used', 'const a = 1;', "localStorage.setItem('x', 'y');", '/* sessionStorage */'].join(String.fromCharCode(10)));
      const found = codeLines(file).filter((l) => /localStorage|sessionStorage/.test(l.text));
      expect(found).toEqual([{ line: 3, text: "localStorage.setItem('x', 'y');" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the YouTube and storage patterns match the real thing', () => {
    expect(/document\.cookie|localStorage|sessionStorage|indexedDB/.test('document.cookie = "a=b"')).toBe(true);
    expect(/<iframe|youtube-nocookie|i\.ytimg\.com|img\.youtube\.com/i.test('<iframe src="https://www.youtube-nocookie.com/embed/x">')).toBe(true);
    expect(/googleapis\.com\/youtube|youtube\/v3/i.test('https://www.googleapis.com/youtube/v3/videos')).toBe(true);
  });
});

describe('the Privacy Policy says our own pages store nothing in the browser', () => {
  it('no source file uses cookies, localStorage, sessionStorage or IndexedDB (add a policy sentence first if one must)', () => {
    expect(hits(/document\.cookie|localStorage|sessionStorage|indexedDB/)).toEqual([]);
  });
});

// M3 /live: the click-to-load player. These files hold the embed code, but src/pages/live.astro renders the player ONLY when
// features.youtubeEmbeds is true (tests/site/live.test.ts checks that the gate is in the page), so with the switch off no
// iframe, embed address or thumbnail reaches a visitor.
const GATED_EMBED_FILES = new Set(['src/content/live.ts', 'src/lib/live-facade.ts', 'src/pages/live.astro']);

describe('the YouTube statements follow the code', () => {
  it('no source file calls the YouTube Data API while features.youtubeApiData is false', () => {
    // M2a wrote the YouTube client and sync (src/lib/youtube, src/lib/sync, scripts/sync-*): code that EXISTS but is not wired into
    // any page, endpoint or the Worker entry. So the guard now checks the real property: nothing that ships (pages, components,
    // layouts, middleware, API routes, other libs) imports the client or the sync, so no call can happen before the flag is on.
    const parked = (f: string): boolean => rel(f).startsWith('src/lib/youtube/') || rel(f).startsWith('src/lib/sync/') || /^scripts\/sync-/.test(rel(f));
    const calls = hits(/googleapis\.com\/youtube|youtube\/v3|key=.*youtube|YOUTUBE_API_KEY/i, (f) => outsideLegal(f) && !parked(f) && !rel(f).startsWith('src/lib/parser/'));
    const wired = hits(/(?:from|import)\s*\(?\s*['"][^'"]*lib\/(?:youtube|sync)(?:\/|['"])/, (f) => outsideLegal(f) && !parked(f));
    if (features.youtubeApiData) return; // the flag is on: the YouTube API Services statement is on the page
    expect(calls, 'the site calls the YouTube API but the Privacy Policy does not say so (set features.youtubeApiData)').toEqual([]);
    expect(wired, 'shipped code imports the YouTube client or the sync while features.youtubeApiData is false').toEqual([]);
  });

  it('no page embeds a YouTube player or loads thumbnails while features.youtubeEmbeds is false', () => {
    // src/lib/infra/headers.ts only ALLOWS those hosts in the CSP (D-029); that is not a use.
    const uses = hits(/<iframe|youtube-nocookie|i\.ytimg\.com|img\.youtube\.com/i, (f) => outsideLegal(f) && rel(f) !== 'src/lib/infra/headers.ts' && !GATED_EMBED_FILES.has(rel(f)));
    if (features.youtubeEmbeds) return;
    expect(uses, 'a page embeds YouTube or its thumbnails but the Privacy Policy does not say so (set features.youtubeEmbeds)').toEqual([]);
  });
});

describe('the archive statements follow the pages', () => {
  it('archive pages may exist while features.archivePages is false ONLY if each prints the seed/approval notice that makes the strict release build refuse', () => {
    // M2c builds the archive against fictional seed data. Existing files are fine for development; what must hold is that no
    // strict (release) build can ship them before the owner and lawyer approve (features.archivePages) and real data is connected.
    // Every archive HTML page therefore renders <ArchiveSeedNotice> (directly, or through the shared MatchListPage component),
    // which prints a <Todo> in the strict build while the source is the seed or the flag is off (docs/m2/archive-notes.md).
    const pages = FILES.map(rel).filter((f) => /^src\/pages\/(players|matches|match|player)(\/|\.|$)/.test(f) && f.endsWith('.astro'));
    if (features.archivePages) return;
    // /matches/gone/ is the neutral "this page was removed" page that removed or protected old addresses redirect to (redirects.ts):
    // it names nobody, shows no data, is noindex and is exactly what must exist for takedowns, so it needs no seed notice.
    const NEUTRAL_PAGES = new Set(['src/pages/matches/gone.astro']);
    const unguarded = pages.filter((f) => {
      if (NEUTRAL_PAGES.has(f)) return false;
      const src = readRepoFile(f);
      return !/ArchiveSeedNotice|MatchListPage/.test(src);
    });
    expect(unguarded, 'an archive page does not print the seed/approval notice, so a strict build could publish it early').toEqual([]);
    expect(readRepoFile('src/lib/archive/select.ts')).toMatch(/ArchiveSeedNotice|archivePages/);
  });
});

describe('sponsor statements follow the links', () => {
  it('a sponsored or partner link in go-links.ts requires features.sponsorLinkTracking', () => {
    const tracked = Object.values(goLinks).some((l) => l.label === 'sponsored' || l.label === 'partner');
    if (tracked) expect(features.sponsorLinkTracking, 'a sponsor link goes through /go: switch features.sponsorLinkTracking on').toBe(true);
  });

  it('the partners strip links straight to the sponsor, so the "counts the click" sentence stays out until it goes through /go', () => {
    const strip = readRepoFile('src/components/site/SponsorStrip.astro');
    const throughGo = /href=\{[^}]*\/go\//.test(strip);
    if (!throughGo) expect(features.sponsorLinkTracking).toBe(false);
  });
});

describe('the Privacy Policy sentence about owner alerts is true of the code (R-TELEGRAM-PHONE, S-5, C-4)', () => {
  const lead = {
    ref: 'PS-2026-AAAAAA',
    kind: 'coverage' as const,
    name: 'Example Person',
    phone: '910000000000',
    district: 'Exampleville',
    sourcePath: '/book',
  };

  it('by default an alert holds no phone number, no link to the phone, no district and no email', () => {
    for (const degraded of [false, true]) {
      const text = buildAlertText(lead, { degraded });
      expect(text).not.toContain('910000000000');
      expect(text).not.toMatch(/wa\.me|whatsapp\.com|@|district|exampleville/i);
      expect(features.telegramPhoneLink, 'the policy text is only true for the default').toBe(false);
    }
  });

  it('only with the explicit option does the alert carry the reply link (the case the flag describes)', () => {
    const text = buildAlertText(lead, { includePhoneLink: true });
    expect(text).toContain('910000000000');
    expect(text).toMatch(/wa\.me/);
  });
});

describe('page-view statistics follow the analytics token', () => {
  it('features.cloudflareWebAnalytics equals "this build has a valid token"', () => {
    expect(features.cloudflareWebAnalytics).toBe(analyticsTokenIsValid(import.meta.env?.PUBLIC_CF_ANALYTICS_TOKEN));
  });

  it('the beacon component and the policy flag use the same token rule', () => {
    const beacon = readRepoFile('src/components/site/Analytics.astro');
    expect(beacon).toContain('/^[A-Za-z0-9]{16,64}$/');
    const status = readRepoFile('src/content/legal/status.ts');
    expect(status).toContain('/^[A-Za-z0-9]{16,64}$/');
  });
});

describe('the policy page and its tests do not hand-write what only the owner may say', () => {
  it('no legal content file contains TODO(owner) typed by hand', () => {
    for (const f of walk(join(SRC, 'content', 'legal'))) {
      for (const l of codeLines(f)) expect(l.text, `${rel(f)}:${l.line}`).not.toContain('TODO(owner)');
    }
  });
});
