// The two M3 lead kinds (video_submission, alerts_signup): contract, payload, consent evidence, texts. Fictional data only.
import { describe, expect, it } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { VIDEO_SHARE_HOSTS, videoHostKind } from '../../src/lib/contracts/lead-constants';
import { buildPayload } from '../../src/lib/forms/payload';
import { allFieldDefs, checkForm, mapFieldErrors } from '../../src/lib/forms/validate';
import { nextSteps, replyLine } from '../../src/lib/forms/confirmation-text';
import { KIND_LABEL, askText, confirmationText } from '../../src/lib/forms/whatsapp-prefill';
import { consentEntriesOf, consentRows } from '../../src/lib/leads/store';
import { buildAlertText, KIND_LABELS } from '../../src/lib/notify/telegram';
import { NOW, META, forms, fullValues, pinClock } from './helpers';

pinClock();

const payload = (kind: string, over: Record<string, unknown> = {}) => buildPayload(forms[kind]!, { ...fullValues[kind]!, ...over } as never, META);
const validate = (body: unknown) => validateLeadRequest(body, { now: NOW });
const BOXES = ['adultConfirmation', 'videoRights', 'videoLicence', 'videoRemoval'] as const;

describe('send your video: the form', () => {
  const form = forms.video_submission!;
  it('has three steps; four required unticked boxes with the exact consent texts; no upload field', () => {
    expect(form.steps.map((s) => s.id)).toEqual(['video', 'match', 'rights']);
    const boxes = allFieldDefs(form).filter((f) => f.type === 'checkbox');
    expect(boxes.map((b) => b.name)).toEqual([...BOXES]);
    for (const box of boxes) {
      expect(box.requiredTick).toBe(true);
      expect(form.initial[box.name]).toBe(false);
      expect(box.label).toBe(CONSENT[box.name as (typeof BOXES)[number]].text);
    }
    expect(allFieldDefs(form).some((f) => (f.type as string) === 'file')).toBe(false);
  });
});

describe('send your video: payload and contract', () => {
  it('a complete form is accepted; consent ids and versions are in the request', () => {
    const body = payload('video_submission');
    for (const key of BOXES) expect(body[key]).toEqual({ id: CONSENT[key].id, version: CONSENT[key].version, given: true });
    const r = validate(body);
    expect(r.ok).toBe(true);
    if (r.ok && r.data.kind === 'video_submission') {
      expect(r.data.role).toBe('parent_guardian');
      expect(r.data.videoUrl).toBe('https://drive.google.com/file/d/sample-id/view');
      expect(r.data.minorsVisible).toBe('unsure');
    }
  });

  it('each unticked box: consent_required on its own field, on both sides', () => {
    for (const name of BOXES) {
      const r = validate(payload('video_submission', { [name]: false }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors).toEqual({ [`${name}.given`]: 'consent_required' });
      expect(checkForm(forms.video_submission!, { ...fullValues.video_submission!, [name]: false }, NOW)[name]).toBe('consent_required');
      const mapped = mapFieldErrors(forms.video_submission!, { [`${name}.given`]: 'consent_required' });
      expect(Object.keys(mapped.fields)).toEqual([name]);
    }
  });

  it('a missing consent object, a wrong id and a forged tick are refused', () => {
    const body = payload('video_submission');
    const { videoLicence: _gone, ...without } = body;
    expect(validate(without).ok).toBe(false);
    expect(validate({ ...body, videoRights: { id: 'something-else', version: 'x', given: true } }).ok).toBe(false);
    expect(validate({ ...body, videoRemoval: true }).ok).toBe(false);
  });

  it('the link must be https', () => {
    for (const bad of ['http://drive.google.com/x', 'javascript:alert(1)', 'data:text/html,hi', 'file:///c:/x', 'ftp://example.test/x', 'https://user:pw@example.test/x', 'https://127.0.0.1/x', 'https://localhost/x', 'drive.google.com/x', '']) {
      const r = validate(payload('video_submission', { videoUrl: bad }));
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.fieldErrors.videoUrl, bad).toBe(bad === '' ? 'required' : 'invalid_url');
    }
    for (const ok of ['https://drive.google.com/file/d/abc/view', 'https://youtu.be/abcdefghijk', 'https://club-videos.example.org/v/1']) {
      expect(validate(payload('video_submission', { videoUrl: ok })).ok, ok).toBe(true);
    }
  });

  it('host classifier', () => {
    for (const host of VIDEO_SHARE_HOSTS) expect(videoHostKind(`https://${host}/x`)).toBe('known');
    expect(videoHostKind('https://www.youtube.com/watch?v=abcdefghijk')).toBe('known');
    expect(videoHostKind('https://drive.google.com.evil.test/')).toBe('other');
    expect(videoHostKind('garbage')).toBe('other');
  });

  it('choices must be allowed values; phone is required; optional fields may be blank; past match dates are fine', () => {
    for (const [field, bad] of [['role', 'admin'], ['footageSource', 'stolen'], ['minorsVisible', 'maybe'], ['filmingPermission', 'perhaps']] as const) {
      expect(validate(payload('video_submission', { [field]: bad })).ok, field).toBe(false);
    }
    const blanks = { tournamentName: '', matchDate: '', category: '', round: '', players: '', notes: '', organizerName: '', filmingPermission: '', email: '', contactPreference: '' };
    expect(validate(payload('video_submission', blanks)).ok).toBe(true);
    expect(validate(payload('video_submission', { phone: '' })).ok).toBe(false);
    expect(validate(payload('video_submission', { matchDate: '2019-05-01' })).ok).toBe(true);
    expect(validate(payload('video_submission', { matchDate: '2019-02-30' })).ok).toBe(false);
  });

  it('free text cannot carry a link, markup or a phone number', () => {
    for (const field of ['players', 'tournamentName', 'category', 'round']) {
      for (const bad of ['see https://x.example.test', '<b>x</b>', 'call 9876543210 now']) {
        expect(validate(payload('video_submission', { [field]: bad })).ok, `${field}: ${bad}`).toBe(false);
      }
    }
  });

  it('consent evidence: the notice plus four boxes, with SHA-256 of each text', async () => {
    const r = validate(payload('video_submission'));
    if (!r.ok) throw new Error('expected valid');
    const entries = consentEntriesOf(r.data);
    expect(entries.map((e) => e.id)).toEqual([CONSENT.leadNotice.id, ...BOXES.map((k) => CONSENT[k].id)]);
    expect(entries.every((e) => e.given)).toBe(true);
    const { events } = await consentRows('lead-1', entries);
    expect(events).toHaveLength(5);
    expect(events.every((e) => typeof e.notice_sha256 === 'string')).toBe(true);
  });
});

describe('alerts sign-up', () => {
  const form = forms.alerts_signup!;
  it('one step; name and email; NO phone field; unticked boxes with the exact texts', () => {
    expect(form.steps).toHaveLength(1);
    const names = allFieldDefs(form).map((f) => f.name);
    expect(names).toEqual(['name', 'email', 'district', 'interests', 'alertsConsent', 'adultConfirmation']);
    expect(allFieldDefs(form).find((f) => f.name === 'email')?.optional).toBe(false);
    expect(allFieldDefs(form).find((f) => f.name === 'alertsConsent')!.label).toBe(CONSENT.alertsSignup.text);
    expect(form.initial.alertsConsent).toBe(false);
    expect(form.initial.adultConfirmation).toBe(false);
  });

  it('a complete sign-up is accepted', () => {
    const r = validate(payload('alerts_signup'));
    expect(r.ok).toBe(true);
    if (r.ok && r.data.kind === 'alerts_signup') expect(r.data.interests).toEqual(['tournaments', 'new-videos']);
  });

  it('email required; a phone sent anyway is dropped', () => {
    const r1 = validate(payload('alerts_signup', { email: '' }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors).toEqual({ email: 'required' });
    const r2 = validate({ ...payload('alerts_signup'), phone: '9876543210' });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect((r2.data as { phone?: unknown }).phone).toBeUndefined();
  });

  it('unticked boxes are consent_required; interests are allow-listed', () => {
    for (const name of ['alertsConsent', 'adultConfirmation']) {
      const r = validate(payload('alerts_signup', { [name]: false }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors).toEqual({ [`${name}.given`]: 'consent_required' });
    }
    expect(validate(payload('alerts_signup', { interests: [] })).ok).toBe(true);
    expect(validate(payload('alerts_signup', { interests: ['tournaments', 'spam'] })).ok).toBe(false);
  });

  it('consent evidence and truthful confirmation', () => {
    const r = validate(payload('alerts_signup'));
    if (!r.ok) throw new Error('expected valid');
    expect(consentEntriesOf(r.data).map((e) => e.id)).toEqual([CONSENT.leadNotice.id, CONSENT.alertsSignup.id, CONSENT.adultConfirmation.id]);
    const lines = nextSteps('alerts_signup').join(' ');
    expect(lines).toMatch(/not switched on/i);
    expect(lines).toMatch(/double opt-in/i);
    expect(lines).not.toMatch(/we (will )?(reply|call)|within|hours|check your inbox/i);
    expect(replyLine('24 hours', 'alerts_signup')).not.toMatch(/24 hours|reply/i);
    expect(replyLine(null, 'video_submission')).toBe('We will get back to you as soon as we can.');
  });
});

describe('shared text tables', () => {
  it('labels exist; owner alerts hold no phone, email or link', () => {
    for (const kind of ['video_submission', 'alerts_signup'] as const) {
      expect(KIND_LABELS[kind]).toBeTruthy();
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(askText(kind)).toMatch(/^Hi Power Smash/);
      expect(confirmationText(kind, 'PS-2026-ABCDEF')).toContain('PS-2026-ABCDEF');
      const alert = buildAlertText({ ref: 'PS-2026-ABCDEF', kind, name: 'Test Person', phone: '919876543210' });
      expect(alert).not.toMatch(/919876543210|wa\.me|@|https?:/);
    }
    expect(buildAlertText({ ref: 'PS-2026-ABCDEF', kind: 'alerts_signup', name: 'Test Person', sourcePath: '/alerts/' })).toContain('Page: /alerts/');
  });
});
