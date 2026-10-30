// The public side: which registration pages a build makes (junior events never), the gate (strict build needs both switches), the
// Supabase provider (publishable key, explicit columns, mocked fetch), the alert text, the notice pin and the form's answer handling.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCompetitionSite } from '../../src/lib/competition/public/model';
import { competitionSeedProvider } from '../../src/lib/competition/public/seed';
import { registrationInBuild, registrationsFlag } from '../../src/lib/registration/in-build';
import { buildRegistrationPages, registrationPath } from '../../src/lib/registration/public/model';
import { createRegistrationSupabaseProvider, SEED_REGISTRATION_DATA, selectRegistrationProvider } from '../../src/lib/registration/public/provider';
import { buildRegistrationAlertText, eventLabel, firstInitial } from '../../src/lib/registration/alert';
import { REGISTRATION_CONSENT } from '../../src/lib/registration/consent';
import { readRegistrationAnswer } from '../../src/lib/registration/form-logic';

async function seedSite() {
  return buildCompetitionSite(await competitionSeedProvider.load(), { source: 'seed' });
}

describe('registration pages', () => {
  it('one page per open, non-junior event; the junior event is left out even when the data lists it', async () => {
    const pages = buildRegistrationPages(await seedSite(), SEED_REGISTRATION_DATA);
    expect(pages.map((p) => [p.category, p.playersNeeded, p.feeText])).toEqual([
      ['MS', 1, '₹500'],
      ['XD', 2, null],
    ]);
    expect(pages.map((p) => p.path)).toEqual(['/register/sample-city-open-2026/ms/', '/register/sample-city-open-2026/xd-open/']);
    expect(pages.every((p) => p.path.endsWith('/'))).toBe(true);
  });

  it('payment texts appear only for an event with a fee; the UPI id only with its payee', async () => {
    const site = await seedSite();
    const [ms, xd] = buildRegistrationPages(site, SEED_REGISTRATION_DATA);
    expect(ms?.payment).toEqual({ instructions: SEED_REGISTRATION_DATA.payment?.payment_instructions, upiId: 'sample-payee@okdemo', payeeName: 'Sample Payee' });
    expect(xd?.payment).toBeNull();
    const noPair = buildRegistrationPages(site, { ...SEED_REGISTRATION_DATA, payment: { payment_instructions: null, upi_id: 'x@ok', payee_name: null } });
    expect(noPair[0]?.payment).toBeNull();
  });

  it('registration switched off (no payment row): no pages at all', async () => {
    expect(buildRegistrationPages(await seedSite(), { events: SEED_REGISTRATION_DATA.events, payment: null })).toEqual([]);
  });

  it('addresses go through path()', () => {
    expect(registrationPath('sample-x', 'ms-u17')).toBe('/register/sample-x/ms-u17/');
  });
});

describe('the gate', () => {
  it('the strict build needs features.competitionPages AND features.registrations; other builds carry the pages', () => {
    expect(registrationInBuild({ PS_STRICT: '1' }, { competitionPages: false, registrations: true })).toBe(false);
    expect(registrationInBuild({ PS_STRICT: '1' }, { competitionPages: true, registrations: false })).toBe(false);
    expect(registrationInBuild({ PS_STRICT: '1' }, { competitionPages: true })).toBe(false);
    expect(registrationInBuild({ PS_STRICT: '1' }, { competitionPages: true, registrations: true })).toBe(true);
    expect(registrationInBuild({}, { competitionPages: false })).toBe(true);
  });
  it('a missing or non-true flag counts as off', () => {
    expect(registrationsFlag({})).toBe(false);
    expect(registrationsFlag({ registrations: 'true' })).toBe(false);
    expect(registrationsFlag({ registrations: true })).toBe(true);
  });
});

describe('the Supabase provider', () => {
  it('reads the two api views with the publishable key and explicit columns, and cleans the values', async () => {
    const urls: string[] = [];
    const keys: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      keys.push(String((init?.headers as Record<string, string>).apikey));
      const rows = url.includes('public_registration_events')
        ? [{ event_id: 'ev-1', entry_fee_paise: 25_000 }, { event_id: 'ev-2', entry_fee_paise: 12.5 }]
        : [{ payment_instructions: 'Sample pay text here.', upi_id: 'sample@okdemo', payee_name: 'Sample Payee' }];
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as typeof fetch;
    const p = createRegistrationSupabaseProvider({ url: 'https://fakeproject.supabase.co', publishableKey: 'sb_publishable_FAKE', fetch: fetchMock });
    const raw = await p.load();
    expect(raw.events).toEqual([{ event_id: 'ev-1', entry_fee_paise: 25_000 }, { event_id: 'ev-2', entry_fee_paise: null }]);
    expect(raw.payment?.upi_id).toBe('sample@okdemo');
    expect(urls.every((u) => !u.includes('select=*'))).toBe(true);
    expect(urls.some((u) => u.includes(encodeURIComponent('event_id,entry_fee_paise')))).toBe(true);
    expect(keys.every((k) => k === 'sb_publishable_FAKE')).toBe(true);
  });
  it('the seed unless PS_COMPETITION_SOURCE is exactly "supabase" with a URL and key', () => {
    expect(selectRegistrationProvider({}).id).toBe('seed');
    expect(selectRegistrationProvider({ PS_COMPETITION_SOURCE: 'supabase' }).id).toBe('seed');
    expect(selectRegistrationProvider({ PS_COMPETITION_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'https://x.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }).id).toBe('supabase');
  });
});

describe('the owner alert text', () => {
  it('kind, reference, initial, event and pointer only', () => {
    const t = buildRegistrationAlertText({ ref: 'PSR-2026-ABCDEF', player1Name: 'Fake Reg Alpha', category: 'MS', ageGroup: 'U19', feePaise: 50_000, hasPaymentReference: true });
    expect(t.split('\n')).toEqual([
      'New registration PSR-2026-ABCDEF',
      'Event: MS U19',
      'Player initial: F',
      'Fee: payment reference given, check it',
      'Open the admin: More, then Registrations (reference PSR-2026-ABCDEF)',
    ]);
    expect(firstInitial('  ஃபேக் வீரர்')).not.toBe('?');
    expect(firstInitial('123')).toBe('?');
    expect(eventLabel('XD', 'sub_junior')).toBe('XD sub junior');
    expect(eventLabel('<b>', null)).toBe('event');
  });
});

describe('the notice', () => {
  it('is pinned: change the text, bump the version (and this hash)', () => {
    const hash = createHash('sha256').update(REGISTRATION_CONSENT.text).digest('hex').slice(0, 16);
    expect({ id: REGISTRATION_CONSENT.id, version: REGISTRATION_CONSENT.version, hash }).toEqual({ id: 'registration-notice', version: '2026-10-31-draft2', hash: '71d2b6b15bacbb66' });
    // only adults register (no parental-consent flow is approved, D-123); no organiser sharing or organiser check is promised
    expect(REGISTRATION_CONSENT.text).toContain('every player I register is 18 or over');
    expect(REGISTRATION_CONSENT.text).not.toMatch(/under 18|parent|guardian|organiser|organizer/i);
    expect(REGISTRATION_CONSENT.text).toContain('Privacy Policy');
    expect(REGISTRATION_CONSENT.text).not.toMatch(/₹|\bfee of\b|\bhours?\b/i);
    expect(REGISTRATION_CONSENT.text.length).toBeGreaterThanOrEqual(20);
    expect(REGISTRATION_CONSENT.text.length).toBeLessThanOrEqual(4000);
  });
});

describe('the form reads the answer', () => {
  it('success, field errors, problems with a new key only for a duplicate', () => {
    expect(readRegistrationAnswer(201, { ok: true, ref: 'PSR-2026-ABCDEF', feePaise: null, waLink: 'https://wa.me/910000000000' })).toEqual({ kind: 'done', ref: 'PSR-2026-ABCDEF', feePaise: null, waLink: 'https://wa.me/910000000000' });
    const f = readRegistrationAnswer(422, { ok: false, code: 'validation', message: 'x', fieldErrors: { phone: 'invalid_phone' }, correlationId: 'c-1' });
    expect(f.kind === 'fields' && f.fieldErrors.phone).toMatch(/mobile number/);
    const d = readRegistrationAnswer(409, { ok: false, code: 'duplicate', message: 'x', correlationId: 'c-2' });
    expect(d.kind === 'problem' && d.newKey).toBe(true);
    const full = readRegistrationAnswer(409, { ok: false, code: 'full', message: 'x', correlationId: 'c-3' });
    expect(full.kind === 'problem' && full.message).toMatch(/no places left/);
    expect(readRegistrationAnswer(502, '<html>').kind).toBe('problem');
  });
});

describe('the page source (src/pages/register/[tournament]/[event].astro and the components)', () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const PAGE = read('src/pages/register/[tournament]/[event].astro');
  const FORM = read('src/components/registration/RegistrationForm.tsx');
  const PAY = read('src/components/registration/PaymentDetails.astro');

  it('noindex always, the sample notice, a canonical path, pages only from loadRegistrationSite', () => {
    expect(PAGE).toMatch(/\n\s+noindex\n/);
    expect(PAGE).toContain('<CompetitionSampleNotice source={source} />');
    expect(PAGE).toContain('canonicalPath={p.path}');
    expect(PAGE).toContain('const site = await loadRegistrationSite();');
  });

  it('no raw HTML, no typed owner marker, no hand-written internal link, no player link', () => {
    for (const src of [PAGE, FORM, PAY]) {
      expect(src).not.toMatch(/set:html|dangerouslySetInnerHTML/);
      expect(src).not.toContain('TODO' + '(owner)');
      expect(src).not.toMatch(/href="\/|href=\{`\//);
      expect(src).not.toMatch(/\/players\//);
    }
  });

  it('never a card, UPI credential, password or age field, and no payment button', () => {
    for (const src of [PAGE, FORM, PAY]) {
      expect(src).not.toMatch(/cc-number|cc-csc|cc-exp|type="password"|type=\{?'password'|upi:\/\/|name="(?:age|dob|pin)"/i);
    }
    expect(FORM).not.toMatch(/ageGroup|dateOfBirth/);
  });
});
