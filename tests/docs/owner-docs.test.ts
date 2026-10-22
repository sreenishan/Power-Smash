// M4 docs test (BUILD_PLAN DoD 11): OWNER_GUIDE.md and RUNBOOK.md exist with their required headings, every image link resolves,
// the screenshot list matches scripts/guide-shots.mjs, and no real phone number, email address or secret appears in either file
// or in the screenshot script. Fictional data only (CLAUDE.md "Tests use fictional data").
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUIDE = join(ROOT, 'docs', 'OWNER_GUIDE.md');
const RUNBOOK = join(ROOT, 'docs', 'RUNBOOK.md');
const SHOTS = join(ROOT, 'scripts', 'guide-shots.mjs');
const read = (p: string) => readFileSync(p, 'utf8');

const headings = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((l) => /^#{1,3} /.test(l))
    .map((l) => l.replace(/^#+\s+/, '').trim().toLowerCase());

const GUIDE_HEADINGS = [
  'what the site is',
  'what exists today and what is switched off',
  'your phone at a glance',
  'your routine',
  'answer an enquiry through whatsapp',
  'record a payment',
  'list a tournament',
  'print a qr poster',
  'approve a submitted video or tournament',
  'a removal or parent request',
  'title convention v2 for new uploads',
  'label paid promotions',
  'what you must never do',
  'when something looks wrong',
  'screenshot index',
];

const RUNBOOK_HEADINGS = [
  'sync failure',
  'payment issue',
  'takedown and emergency hide',
  'breach and cert-in',
  'mfa reset',
  'key rotation, per secret',
  'backup and restore drill',
  'kyc and renewal dates',
  'the uptime drill',
  'redirects and the 410 gap',
  'cron parked',
  'retention and purge jobs',
  'rollback',
  'feature switches: how to flip each one safely',
  'launch checklists',
  'g1: money pages go live',
  'g2: public archive go-live',
  'g3: phase 1 complete',
];

function imageLinks(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) out.push(m[1]);
  return out;
}

describe('docs/OWNER_GUIDE.md', () => {
  it('exists and has every required heading', () => {
    expect(existsSync(GUIDE)).toBe(true);
    const h = headings(read(GUIDE));
    for (const want of GUIDE_HEADINGS) expect(h.some((x) => x.startsWith(want)), `missing heading: ${want}`).toBe(true);
  });

  it('every image link resolves to a non-empty png in docs/guide', () => {
    const links = imageLinks(GUIDE);
    expect(links.length).toBeGreaterThanOrEqual(15);
    for (const link of links) {
      expect(link.startsWith('guide/'), link).toBe(true);
      const p = resolve(dirname(GUIDE), link);
      expect(existsSync(p), `missing image ${link}`).toBe(true);
      expect(statSync(p).size, `empty image ${link}`).toBeGreaterThan(1000);
      const head = readFileSync(p).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // a real PNG
    }
  });

  it('the screenshot index lists exactly the pictures that scripts/guide-shots.mjs makes, and the guide uses only those', () => {
    const script = [...read(SHOTS).matchAll(/file:\s*'([a-z0-9-]+)'/g)].map((m) => `${m[1]}.png`);
    expect(script.length).toBeGreaterThan(10);
    const text = read(GUIDE);
    const index = text.slice(text.toLowerCase().indexOf('## screenshot index'));
    const listed = [...index.matchAll(/`([a-z0-9-]+\.png)`/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...script].sort());
    const used = new Set(imageLinks(GUIDE).map((l) => l.replace(/^guide\//, '')));
    for (const f of used) expect(script, `${f} is used but not generated`).toContain(f);
  });

  it('marks what is not live yet and cites the key decisions', () => {
    const text = read(GUIDE);
    expect(text).toMatch(/NOT LIVE YET/);
    for (const d of ['D-014', 'D-017', 'D-012']) expect(text).toContain(d);
    expect(text).toMatch(/ASCI/);
    expect(text).toMatch(/DoCA/);
    expect(text).toMatch(/Includes paid promotion/);
  });
});

describe('docs/RUNBOOK.md', () => {
  it('exists and has every required heading', () => {
    expect(existsSync(RUNBOOK)).toBe(true);
    const h = headings(read(RUNBOOK));
    for (const want of RUNBOOK_HEADINGS) expect(h.some((x) => x.includes(want)), `missing heading: ${want}`).toBe(true);
  });

  it('states the takedown targets and the dated duties', () => {
    const text = read(RUNBOOK);
    for (const needle of ['24 hours', '48 hours', '3 hours', '6 hours', '13 May 2027', '1 January 2027', 'January 2027', '180 days']) {
      expect(text, needle).toContain(needle);
    }
  });

  it('covers every status.ts feature flag and every documented switch', () => {
    const text = read(RUNBOOK);
    const status = read(join(ROOT, 'src', 'content', 'legal', 'status.ts'));
    const start = status.indexOf('export const features');
    const block = status.slice(start, status.indexOf('/** Every flag name', start));
    const flags = [...block.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(flags.length).toBeGreaterThan(10);
    for (const f of flags) expect(text, `flag ${f} not in the runbook`).toContain(`\`${f}\``);
    for (const sw of ['EMAIL_ENABLED', 'TELEGRAM_ALERT_PHONE_LINK', 'CRON_ENABLED', 'TURNSTILE_ALLOW_TEST_KEYS', 'SYNC_ENABLED', 'BACKUP_ENABLED', 'DEPLOY_ENABLED', 'ADMIN_EDITORS_ENABLED']) {
      expect(text, sw).toContain(sw);
    }
  });

  it('every file path named in backticks exists', () => {
    for (const file of [GUIDE, RUNBOOK]) {
      for (const m of read(file).matchAll(/`((?:docs|scripts|src|supabase|tests)\/[A-Za-z0-9_./-]+\.(?:md|mjs|ts|sql|yml))`/g)) {
        expect(existsSync(join(ROOT, m[1])), `${file} names ${m[1]} which does not exist`).toBe(true);
      }
    }
  });
});

describe('no real contact data or secret in the docs or the screenshot script', () => {
  const files = [GUIDE, RUNBOOK, SHOTS];
  const FAKE_PHONES = new Set(['910000000000']);
  // Secret shapes are assembled at run time so the repository scanner does not flag this test file.
  const secretShapes: RegExp[] = [
    new RegExp(['sb', 'secret', '[A-Za-z0-9_-]{8,}'].join('_')),
    new RegExp(['eyJ', '[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}'].join('')),
    new RegExp(['AGE', 'SECRET', 'KEY', '1[A-Z0-9]{20,}'].join('-')),
    /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, // a Telegram bot token
    /\bre_[A-Za-z0-9]{20,}\b/, // a Resend key
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];

  for (const file of files) {
    const name = file.slice(ROOT.length + 1);
    it(`${name}: no phone number except the fictional one`, () => {
      const text = read(file);
      for (const m of text.matchAll(/(?<![\d.])(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)|(?<!\d)91\d{10}(?!\d)/g)) {
        const digits = m[0].replace(/\D/g, '');
        expect(FAKE_PHONES.has(digits), `${name} holds a phone-like number: ${m[0]}`).toBe(true);
      }
    });
    it(`${name}: no email address except role addresses on the project domain`, () => {
      const text = read(file);
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
        expect(/^(hello|grievance)@powersmash\.in$/i.test(m[0]), `${name} holds an email: ${m[0]}`).toBe(true);
      }
    });
    it(`${name}: no secret-shaped value`, () => {
      const text = read(file);
      for (const re of secretShapes) expect(re.test(text), `${name} matches ${re}`).toBe(false);
    });
    it(`${name}: no real WhatsApp link`, () => {
      for (const m of read(file).matchAll(/wa\.me\/(\d+)/g)) expect(FAKE_PHONES.has(m[1]), `${name}: wa.me/${m[1]}`).toBe(true);
    });
  }
});
