import { describe, expect, it } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import {
  FIELD_ERROR_CODES,
  LEAD_ERROR_CODES,
  LEAD_KINDS,
  LEAD_LIMITS,
  REF_CODE_PATTERN,
  validateLeadRequest,
  type CoverageLeadRequest,
  type TournamentSubmissionLeadRequest,
} from '../../src/lib/contracts/lead';
import { coverageBody, NOW, validUuid } from './helpers';

// The start-date window (R-DATE) depends on the clock: every check here uses the fixed test clock.
const validate = (body: unknown) => validateLeadRequest(body, { now: NOW });

const common = {
  idempotencyKey: validUuid(7),
  token: 'XXXX.DUMMY.TOKEN.XXXX',
  consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version },
  name: 'Ravi Kumar',
  phone: '9876543210',
};

const bodies = {
  coverage: { ...common, kind: 'coverage', eventName: 'Madurai Open' },
  sponsorship: { ...common, kind: 'sponsorship', company: 'Acme Sports Pvt Ltd' },
  general: { ...common, kind: 'general', message: 'Do you cover school tournaments?' },
  player_product: { ...common, kind: 'player_product', productKey: 'hd-match-file' },
  tournament_submission: { ...common, kind: 'tournament_submission', tournamentName: 'Salem Summer Cup', startDate: '2026-12-20' },
  // M3 kinds: every required choice and every required consent box
  video_submission: {
    ...common,
    kind: 'video_submission',
    role: 'player',
    videoUrl: 'https://drive.google.com/file/d/sample/view',
    footageSource: 'self',
    minorsVisible: 'no',
    adultConfirmation: { id: CONSENT.adultConfirmation.id, version: CONSENT.adultConfirmation.version, given: true },
    videoRights: { id: CONSENT.videoRights.id, version: CONSENT.videoRights.version, given: true },
    videoLicence: { id: CONSENT.videoLicence.id, version: CONSENT.videoLicence.version, given: true },
    videoRemoval: { id: CONSENT.videoRemoval.id, version: CONSENT.videoRemoval.version, given: true },
  },
  alerts_signup: {
    ...common,
    kind: 'alerts_signup',
    email: 'ravi@example.com',
    alertsConsent: { id: CONSENT.alertsSignup.id, version: CONSENT.alertsSignup.version, given: true },
    adultConfirmation: { id: CONSENT.adultConfirmation.id, version: CONSENT.adultConfirmation.version, given: true },
  },
  // Request kinds: the request notice, a type, a link or description and who is asking
  profile_request: {
    ...common,
    kind: 'profile_request',
    consent: { id: CONSENT.requestNotice.id, version: CONSENT.requestNotice.version },
    requestType: 'hide_profile',
    what: 'https://example.org/players/sample-player/',
    relationship: 'parent_guardian',
  },
  content_removal: {
    ...common,
    kind: 'content_removal',
    consent: { id: CONSENT.requestNotice.id, version: CONSENT.requestNotice.version },
    requestType: 'remove_content',
    what: 'The second video of the sample open final',
    relationship: 'rights_holder',
  },
} as const;

const errorsOf = (body: unknown) => {
  const r = validate(body);
  return r.ok ? null : r.fieldErrors;
};

describe('contract constants', () => {
  it('exports the kinds and stable error codes the brief lists', () => {
    expect([...LEAD_KINDS]).toEqual(['coverage', 'sponsorship', 'general', 'player_product', 'tournament_submission', 'video_submission', 'alerts_signup', 'profile_request', 'content_removal']);
    expect([...LEAD_ERROR_CODES]).toEqual(['validation', 'turnstile', 'rate_limited', 'duplicate', 'degraded', 'server']);
    expect(FIELD_ERROR_CODES).toContain('invalid_phone');
  });
  it('reference pattern excludes ambiguous letters', () => {
    expect(REF_CODE_PATTERN.test('PS-2026-7K3QDM')).toBe(true);
    for (const bad of ['PS-2026-7K3QDI', 'PS-2026-7K3QDL', 'PS-2026-7K3QDO', 'PS-2026-7K3QDU', 'PS-2026-0012', 'ps-2026-7K3QDM']) {
      expect(REF_CODE_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe('each kind: minimal valid body passes', () => {
  for (const kind of LEAD_KINDS) {
    it(kind, () => {
      const r = validate(bodies[kind]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.kind).toBe(kind);
        expect(r.data.name).toBe('Ravi Kumar');
        expect(r.data.whatsappOk).toBe(false);
        expect(r.data.lang).toBe('en');
      }
    });
  }

  it('an unknown or missing kind is rejected', () => {
    expect(errorsOf({ ...common, kind: 'surprise' })).toEqual({ kind: 'invalid' });
    expect(errorsOf({ ...common })).toEqual({ kind: 'invalid' });
    expect(errorsOf(null)).toEqual({ _: 'invalid' });
    expect(errorsOf([1])).toEqual({ _: 'invalid' });
    expect(errorsOf('x')).toEqual({ _: 'invalid' });
  });
});

describe('each kind: required fields', () => {
  it('coverage needs eventName, name, phone, consent, key and token', () => {
    const e = errorsOf({ kind: 'coverage' }) ?? {};
    expect(Object.keys(e).sort()).toEqual(['consent', 'eventName', 'idempotencyKey', 'name', 'phone', 'token']);
    expect(e.eventName).toBe('required');
    expect(e.phone).toBe('required');
  });
  it('sponsorship needs a company', () => {
    expect(errorsOf({ ...bodies.sponsorship, company: '' })).toEqual({ company: 'required' });
  });
  it('general needs a message and a phone or an email', () => {
    expect(errorsOf({ ...bodies.general, message: '' })).toEqual({ message: 'required' });
    expect(errorsOf({ ...bodies.general, phone: undefined })).toEqual({ phone: 'contact_required' });
    expect(validate({ ...bodies.general, phone: undefined, email: 'Fan@Example.Test' }).ok).toBe(true);
  });
  it('player_product needs a product key', () => {
    expect(errorsOf({ ...bodies.player_product, productKey: undefined })).toEqual({ productKey: 'required' });
    expect(errorsOf({ ...bodies.player_product, productKey: 'Not A Slug!' })).toEqual({ productKey: 'invalid' });
  });
  it('tournament_submission needs a name and a start date', () => {
    expect(errorsOf({ ...bodies.tournament_submission, tournamentName: '', startDate: undefined })).toEqual({ tournamentName: 'required', startDate: 'required' });
  });
});

describe('normalisation', () => {
  it('phone becomes digits with the country code', () => {
    const phones: Array<[string, string]> = [
      ['98765 43210', '919876543210'],
      ['098765-43210', '919876543210'],
      ['+91 98765 43210', '919876543210'],
      ['91 9876543210', '919876543210'],
      ['0091 9876543210', '919876543210'],
      ['(98765) 43210', '919876543210'],
      ['௯௮௭௬௫௪௩௨௧௦', '919876543210'], // Tamil digits
      ['+44 7700 900123', '447700900123'],
    ];
    for (const [input, expected] of phones) {
      const r = validate({ ...bodies.coverage, phone: input });
      expect(r.ok, input).toBe(true);
      if (r.ok) expect(r.data.phone).toBe(expected);
    }
  });

  it('rejects implausible phones', () => {
    for (const bad of ['12345', 'abcdefghij', '98765 4321', '5876543210', '+91 12345 67890', '9876543210123456', '98765-43210; DROP', '']) {
      expect(errorsOf({ ...bodies.coverage, phone: bad })?.phone, bad).toMatch(/invalid_phone|required/);
    }
  });

  it('email is lower-cased, ASCII, optional', () => {
    const r = validate({ ...bodies.coverage, email: '  Ravi.K@Example.TEST ' });
    expect(r.ok && r.data.email).toBe('ravi.k@example.test');
    expect(validate({ ...bodies.coverage, email: '' }).ok).toBe(true);
    for (const bad of ['no-at-sign', 'a@b', 'a b@example.test', 'a@exa mple.test', '<x>@example.test', 'ravi@exämple.test', 'a@@example.test', 'ravi@example.test, other@example.test']) {
      expect(errorsOf({ ...bodies.coverage, email: bad })?.email, bad).toBe('invalid_email');
    }
  });

  it('text is trimmed, NFC-normalised and inner spaces collapsed', () => {
    const r = validate({ ...bodies.coverage, name: '  Ravi   Kumar  ', eventName: 'Café Open' });
    expect(r.ok && r.data.name).toBe('Ravi Kumar');
    expect(r.ok && (r.data as CoverageLeadRequest).eventName).toBe('Café Open');
  });

  it('Tamil names and event names are accepted', () => {
    const r = validate({ ...bodies.coverage, name: 'ரவி குமார்', eventName: 'சென்னை மாவட்ட பேட்மிண்டன் போட்டி 2026' });
    expect(r.ok).toBe(true);
  });

  it('blank optional fields become absent; blank required fields are `required`', () => {
    const r = validate({ ...bodies.coverage, organization: '   ', venue: '', notes: '\n\n' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.organization).toBeUndefined();
      expect((r.data as CoverageLeadRequest).venue).toBeUndefined();
    }
    expect(errorsOf({ ...bodies.coverage, name: '   ' })).toEqual({ name: 'required' });
  });

  it('numbers may arrive as digit strings; ranges are enforced', () => {
    const r = validate({ ...bodies.coverage, courts: '4', expectedEntries: 120, matchDays: '2' });
    expect(r.ok && (r.data as CoverageLeadRequest).courts).toBe(4);
    expect(errorsOf({ ...bodies.coverage, courts: 0 })).toEqual({ courts: 'invalid' });
    expect(errorsOf({ ...bodies.coverage, courts: 65 })).toEqual({ courts: 'invalid' });
    expect(errorsOf({ ...bodies.coverage, expectedEntries: 'many' })).toEqual({ expectedEntries: 'invalid' });
    expect(errorsOf({ ...bodies.coverage, matchDays: 1.5 })).toEqual({ matchDays: 'invalid' });
  });

  it('dates must be real calendar dates and end cannot precede start', () => {
    expect(errorsOf({ ...bodies.coverage, startDate: '2026-02-30' })).toEqual({ startDate: 'invalid_date' });
    expect(errorsOf({ ...bodies.coverage, startDate: '05/12/2026' })).toEqual({ startDate: 'invalid_date' });
    expect(errorsOf({ ...bodies.coverage, startDate: '2026-12-05', endDate: '2026-12-04' })).toEqual({ endDate: 'invalid_date' });
    expect(validate({ ...bodies.coverage, startDate: '2026-12-05', endDate: '2026-12-07' }).ok).toBe(true);
    expect(errorsOf({ ...bodies.sponsorship, startMonth: '2026-13' })).toEqual({ startMonth: 'invalid_date' });
    expect(validate({ ...bodies.sponsorship, startMonth: '2027-01' }).ok).toBe(true);
  });

  it('lists are deduplicated, slugs lower-cased, items checked', () => {
    const r = validate({ ...bodies.coverage, categories: ['U13 Boys Singles', 'U13 Boys Singles', 'U15 Girls Doubles'], addOns: ['Extra-Court', 'extra-court'], serviceKeys: ['live_stream'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as CoverageLeadRequest;
      expect(d.categories).toEqual(['U13 Boys Singles', 'U15 Girls Doubles']);
      expect(d.addOns).toEqual(['extra-court']);
    }
    expect(errorsOf({ ...bodies.coverage, addOns: ['has space'] })).toEqual({ addOns: 'invalid' });
    expect(errorsOf({ ...bodies.coverage, categories: Array.from({ length: LEAD_LIMITS.listItems.max + 1 }, (_, i) => `c${i}`) })).toEqual({ categories: 'too_long' });
  });
});

describe('injection and hygiene matrix', () => {
  it('CR, LF and tab in single-line fields are rejected (header injection)', () => {
    for (const evil of ['Ravi\r\nBcc: evil@example.test', 'Ravi\nKumar', 'Ravi\rKumar', 'Ravi\tKumar']) {
      expect(errorsOf({ ...bodies.coverage, name: evil })?.name, JSON.stringify(evil)).toBe('control_chars');
      expect(errorsOf({ ...bodies.coverage, eventName: evil })?.eventName).toBe('control_chars');
      expect(errorsOf({ ...bodies.coverage, organization: evil })?.organization).toBe('control_chars');
    }
    expect(errorsOf({ ...bodies.coverage, email: 'a@example.test\r\nBcc: x@example.test' })?.email).toBe('invalid_email');
  });

  it('control, zero-width, bidi and separator characters are rejected everywhere', () => {
    const bad = ['\u0000', '\u0007', '\u001B', '\u007F', '\u0085', '​', '‎', '‮', ' ', ' ', '⁦', '﻿', '­'];
    for (const ch of bad) {
      expect(errorsOf({ ...bodies.coverage, name: `Ra${ch}vi` })?.name, `U+${ch.charCodeAt(0).toString(16)}`).toBe('control_chars');
      expect(errorsOf({ ...bodies.coverage, notes: `see${ch}this` })?.notes, `notes U+${ch.charCodeAt(0).toString(16)}`).toBe('control_chars');
    }
  });

  it('lone surrogates (which break jsonb) are rejected', () => {
    expect(errorsOf({ ...bodies.coverage, name: 'Ra\uD800vi' })?.name).toBe('control_chars');
  });

  it('multi-line fields keep LF, normalise CRLF, drop tabs, reject lone CR', () => {
    const r = validate({ ...bodies.coverage, notes: 'Line one\r\nLine two\n\n\n\nLine\tthree' });
    expect(r.ok && (r.data as CoverageLeadRequest).notes).toBe('Line one\nLine two\n\nLine three');
    expect(errorsOf({ ...bodies.coverage, notes: 'a\rb' })?.notes).toBe('control_chars');
  });

  it('formula text: single-line fields refuse a leading = + - @; notes keep it verbatim (the CSV export escapes)', () => {
    for (const f of ['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)']) {
      expect(errorsOf({ ...bodies.coverage, name: f })?.name, f).toMatch(/formula_not_allowed|url_not_allowed/);
      expect(errorsOf({ ...bodies.coverage, eventName: f })?.eventName, f).toMatch(/formula_not_allowed|url_not_allowed/);
    }
    const r = validate({ ...bodies.coverage, notes: '=HYPERLINK("x","y")' });
    expect(r.ok && (r.data as CoverageLeadRequest).notes).toBe('=HYPERLINK("x","y")');
  });

  it('links, emails and handles are rejected in name-like fields', () => {
    for (const v of ['http://evil.example', 'https://evil.example/x', 'www.evil.com', 'evil.com', 'Visit evil.in now', 'Ravi @ravi_k', 'ravi@example.test', 't.me/spam', 'wa.me/919999900000', 'bit.ly/abc', 'javascript://x']) {
      expect(errorsOf({ ...bodies.coverage, name: v })?.name, v).toBe('url_not_allowed');
      expect(errorsOf({ ...bodies.coverage, organization: v })?.organization, v).toBe('url_not_allowed');
      expect(errorsOf({ ...bodies.coverage, venue: v })?.venue, v).toBe('url_not_allowed');
    }
    // ordinary text with a dot is fine
    expect(validate({ ...bodies.coverage, name: 'Dr.Kumar S.', organization: 'St. Joseph Academy, Trichy' }).ok).toBe(true);
  });

  it('notes may carry one or two links but not a spam list', () => {
    expect(validate({ ...bodies.coverage, notes: 'Draw sheet: https://drive.example.test/x' }).ok).toBe(true);
    expect(errorsOf({ ...bodies.coverage, notes: 'aa.com bb.com cc.com' })?.notes).toBe('url_not_allowed');
  });

  it('markup characters are rejected in single-line fields', () => {
    expect(errorsOf({ ...bodies.coverage, name: 'Ravi <script>' })?.name).toBe('html_not_allowed');
    expect(errorsOf({ ...bodies.coverage, eventName: 'Cup <b>' })?.eventName).toBe('html_not_allowed');
  });

  it('a phone number pasted into a text field is rejected', () => {
    expect(errorsOf({ ...bodies.coverage, name: 'Ravi 9876543210' })?.name).toBe('too_many_digits');
    expect(validate({ ...bodies.coverage, eventName: 'Chennai Open 2026-27 U19' }).ok).toBe(true);
  });

  it('over-long values are rejected, not truncated', () => {
    expect(errorsOf({ ...bodies.coverage, name: 'A'.repeat(LEAD_LIMITS.name.max + 1) })?.name).toBe('too_long');
    expect(errorsOf({ ...bodies.coverage, eventName: 'B'.repeat(LEAD_LIMITS.shortText.max + 1) })?.eventName).toBe('too_long');
    expect(errorsOf({ ...bodies.coverage, notes: 'n'.repeat(LEAD_LIMITS.longText.max + 1) })?.notes).toBe('too_long');
    expect(errorsOf({ ...bodies.coverage, name: 'A'.repeat(100_000) })?.name).toBe('too_long');
    expect(errorsOf({ ...bodies.coverage, name: 'R' })?.name).toBe('too_short');
    // the limit is in code points, so a full-length Tamil name still fits
    expect(validate({ ...bodies.coverage, name: 'ர'.repeat(LEAD_LIMITS.name.max) }).ok).toBe(true);
  });

  it('wrong types are `invalid` or `required`, never a crash', () => {
    const e = errorsOf({ ...bodies.coverage, name: 42, eventName: { a: 1 }, courts: {}, liveStream: 'yes', categories: 'x', consent: 'yes' }) ?? {};
    expect(e.name).toBe('invalid');
    expect(e.eventName).toBe('invalid');
    expect(e.liveStream).toBe('invalid');
    expect(e.categories).toBe('invalid');
    expect(e.consent).toBe('invalid');
    expect(errorsOf({ ...bodies.coverage, __proto__: { admin: true } })).toBeNull();
  });
});

describe('unknown keys are stripped', () => {
  it('strips unknown keys on every kind, including prototype-ish ones', () => {
    for (const kind of LEAD_KINDS) {
      // `role` is a real field of the video form (a bad value there is an error), so the stripped-key probe uses another name for it.
      const probe = kind === 'video_submission' ? { rank: 'admin' } : { role: 'admin' };
      const raw = JSON.parse(JSON.stringify({ ...bodies[kind], ...probe, price: 1, status: 'won', value_paise: 99, __proto__: { x: 1 }, constructor: 'evil' }));
      const r = validate(raw);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const d = r.data as unknown as Record<string, unknown>;
        for (const k of ['role', 'rank', 'price', 'status', 'value_paise', 'constructor'].filter((name) => !(kind === 'video_submission' && name === 'role'))) expect(Object.prototype.hasOwnProperty.call(d, k), `${kind}:${k}`).toBe(false);
      }
    }
  });
});

describe('source (page path and UTM) is lenient and bounded', () => {
  it('keeps a clean path and known UTM keys, drops the rest', () => {
    const r = validate({
      ...bodies.coverage,
      source: { path: '/book?utm_source=x#frag', utm: { source: 'qr_poster', medium: 'print', campaign: 'madurai-open', foo: 'bar', term: 'x'.repeat(65) } },
    });
    expect(r.ok && r.data.source).toEqual({ path: '/book', utm: { source: 'qr_poster', medium: 'print', campaign: 'madurai-open' } });
  });
  it('a bad source never rejects the lead', () => {
    for (const source of ['nonsense', 42, { path: 'no-leading-slash' }, { path: '/a/../b' }, { path: '/x'.repeat(500) }, { utm: { source: '<script>' } }, { path: 5 }]) {
      const r = validate({ ...bodies.coverage, source });
      expect(r.ok, JSON.stringify(source)).toBe(true);
      if (r.ok) expect(r.data.source).toBeUndefined();
    }
  });
});

describe('consent, token, key, honeypot', () => {
  it('requires the lead-notice id and a plausible version', () => {
    expect(errorsOf({ ...bodies.coverage, consent: { id: 'something-else', version: 'v1' } })).toEqual({ 'consent.id': 'invalid' });
    expect(errorsOf({ ...bodies.coverage, consent: { id: CONSENT.leadNotice.id, version: 'has spaces!' } })).toEqual({ 'consent.version': 'invalid' });
    expect(errorsOf({ ...bodies.coverage, consent: undefined })).toEqual({ consent: 'required' });
  });
  it('idempotencyKey must be a uuid', () => {
    expect(errorsOf({ ...bodies.coverage, idempotencyKey: 'not-a-uuid' })).toEqual({ idempotencyKey: 'invalid' });
    expect(errorsOf({ ...bodies.coverage, idempotencyKey: undefined })).toEqual({ idempotencyKey: 'required' });
  });
  it('token: missing is `required`, wrong characters or too long are `invalid`', () => {
    expect(errorsOf({ ...bodies.coverage, token: undefined })).toEqual({ token: 'required' });
    expect(errorsOf({ ...bodies.coverage, token: '' })).toEqual({ token: 'required' });
    expect(errorsOf({ ...bodies.coverage, token: 'bad token!' })).toEqual({ token: 'invalid' });
    expect(errorsOf({ ...bodies.coverage, token: 'a'.repeat(LEAD_LIMITS.turnstileToken.max + 1) })).toEqual({ token: 'invalid' });
    expect(validate({ ...bodies.coverage, token: 'a'.repeat(LEAD_LIMITS.turnstileToken.max) }).ok).toBe(true);
  });
  it('the honeypot field passes validation (the handler decides what to do with it)', () => {
    const r = validate({ ...bodies.coverage, website: 'http://spam.example' });
    expect(r.ok && r.data.website).toBe('http://spam.example');
  });
});

describe('kind specifics', () => {
  it('coverage: filmingPermission is yes/no/unsure; budget and organizer are text', () => {
    expect(validate(coverageBody({ filmingPermission: 'unsure', organizerName: 'TN District Badminton Association', budgetRange: '10k-25k', liveStream: true })).ok).toBe(true);
    expect(errorsOf(coverageBody({ filmingPermission: 'maybe' }))).toEqual({ filmingPermission: 'invalid' });
  });
  it('sponsorship: companyUrl must be https with a real host', () => {
    expect(validate({ ...bodies.sponsorship, companyUrl: 'https://acme.example.com/about' }).ok).toBe(true);
    for (const bad of ['http://acme.example.com', 'ftp://acme.example.com', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://user:pw@acme.example.com', 'https://acme.example.com:8443/', 'https://intranet/x', 'https://a.local/x', 'javascript:alert(1)', 'https://acme.example.com/<x>', 'https://acme example.com']) {
      expect(errorsOf({ ...bodies.sponsorship, companyUrl: bad })?.companyUrl, bad).toBe('invalid_url');
    }
  });
  it('player_product: matchRefs are YouTube ids, playerSlug a slug, max five', () => {
    expect(validate({ ...bodies.player_product, matchRefs: ['dQw4w9WgXcQ'], playerSlug: 'some-player-slug' }).ok).toBe(true);
    expect(errorsOf({ ...bodies.player_product, matchRefs: ['short'] })).toEqual({ matchRefs: 'invalid' });
    expect(errorsOf({ ...bodies.player_product, matchRefs: Array(6).fill('dQw4w9WgXcQ') })).toEqual({ matchRefs: 'too_long' });
    expect(errorsOf({ ...bodies.player_product, playerSlug: 'Some Player' })).toEqual({ playerSlug: 'invalid' });
  });
  it('tournament_submission: poster is an https link only, public contact consent is a separate value', () => {
    const base = bodies.tournament_submission;
    const ok = validate({
      ...base,
      posterUrl: 'https://cdn.example.com/poster.jpg',
      registrationLink: 'https://forms.example.com/reg',
      publicContactConsent: { id: CONSENT.tournamentPublicContact.id, version: CONSENT.tournamentPublicContact.version, given: true },
      coverageInterest: true,
      listingType: 'featured',
      entryFee: 'Rs 500 per player',
      categories: ['U13', 'U15'],
      ageGroups: ['Under 13'],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const d = ok.data as TournamentSubmissionLeadRequest;
      expect(d.publicContactConsent?.given).toBe(true);
      expect(d.coverageInterest).toBe(true);
      expect(d.listingType).toBe('featured');
    }
    const def = validate(base);
    expect(def.ok && (def.data as TournamentSubmissionLeadRequest).coverageInterest).toBe(false);
    expect(def.ok && (def.data as TournamentSubmissionLeadRequest).listingType).toBe('free');
    expect(def.ok && (def.data as TournamentSubmissionLeadRequest).publicContactConsent).toBeUndefined();
    expect(errorsOf({ ...base, posterUrl: 'http://cdn.example.com/p.jpg' })).toEqual({ posterUrl: 'invalid_url' });
    expect(errorsOf({ ...base, publicContactConsent: { id: 'lead-notice', version: 'v1', given: true } })).toEqual({ 'publicContactConsent.id': 'invalid' });
    expect(errorsOf({ ...base, publicContactConsent: { id: CONSENT.tournamentPublicContact.id, version: 'v1', given: 'yes' } })).toEqual({ 'publicContactConsent.given': 'invalid' });
    expect(errorsOf({ ...base, listingType: 'paid' })).toEqual({ listingType: 'invalid' });
  });
});
