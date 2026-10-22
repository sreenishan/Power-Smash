// The request form (/request): profile requests and content-removal requests (spec 7.5 footer, 15.3, 15.6, D-012, D-015, D-019).
// ONE form, a type selector, two lead kinds, the request notice, no personal data in events or the WhatsApp fallback. Fictional data only.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONSENT } from '../../src/content/consent';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { CONTENT_REMOVAL_TYPE, LEAD_KINDS, PROFILE_REQUEST_TYPES, REQUEST_RELATIONSHIPS, REQUEST_TYPES } from '../../src/lib/contracts/lead-constants';
import { buildEventBody } from '../../src/lib/forms/events';
import { PARENT_VERIFICATION_NOTE, RELATIONSHIP_OPTIONS, REQUEST_TYPE_OPTIONS } from '../../src/lib/forms/defs/request';
import { nextSteps, replyLine } from '../../src/lib/forms/confirmation-text';
import { buildPayload, kindOf } from '../../src/lib/forms/payload';
import { allFieldDefs, checkForm, mapFieldErrors } from '../../src/lib/forms/validate';
import { fallbackSummary } from '../../src/lib/forms/summary';
import { KIND_LABEL, askText, fallbackText } from '../../src/lib/forms/whatsapp-prefill';
import { consentEntriesOf, consentRows, payloadOf } from '../../src/lib/leads/store';
import { KIND_LABELS } from '../../src/lib/notify/telegram';
import { FICTIONAL, META, NOW, forms, fullValues, pinClock } from './helpers';

pinClock();

const ROOT = resolve(__dirname, '../..');
const form = forms.request!;
const payload = (over: Record<string, unknown> = {}) => buildPayload(form, { ...fullValues.request!, ...over } as never, META);
const validate = (body: unknown) => validateLeadRequest(body, { now: NOW });

describe('the form', () => {
  it('has one step with the things the intake needs, and no email box', () => {
    expect(form.steps).toHaveLength(1);
    expect(allFieldDefs(form).map((f) => f.name)).toEqual(['requestType', 'what', 'relationship', 'name', 'phone', 'details']);
  });

  it('the type selector offers claim, correct, hide and remove', () => {
    expect(REQUEST_TYPE_OPTIONS.map((o) => o.value)).toEqual(['claim_profile', 'correct_details', 'hide_profile', 'remove_content']);
    expect(REQUEST_TYPE_OPTIONS.map((o) => o.value)).toEqual([...REQUEST_TYPES]);
  });

  it('the relationship box offers self, parent or guardian, coach, rights holder, other', () => {
    expect(RELATIONSHIP_OPTIONS.map((o) => o.value)).toEqual(['self', 'parent_guardian', 'coach', 'rights_holder', 'other']);
    expect(RELATIONSHIP_OPTIONS.map((o) => o.value)).toEqual([...REQUEST_RELATIONSHIPS]);
  });

  it('starts empty and uses the request notice, not the lead notice', () => {
    for (const v of Object.values(form.initial)) expect(v).toBe('');
    expect(form.noticeKey).toBe('requestNotice');
  });

  it('says plainly that the parent or guardian check by a one-time code is a later step, and that nothing is removed by this form alone', () => {
    const relationship = allFieldDefs(form).find((f) => f.name === 'relationship')!;
    expect(relationship.hint).toBe(PARENT_VERIFICATION_NOTE);
    expect(PARENT_VERIFICATION_NOTE).toMatch(/parent or guardian/);
    expect(PARENT_VERIFICATION_NOTE).toMatch(/one-time code/);
    expect(PARENT_VERIFICATION_NOTE).toMatch(/own phone/);
    expect(PARENT_VERIFICATION_NOTE).toMatch(/not switched on yet/);
    expect(PARENT_VERIFICATION_NOTE).toMatch(/does not hide or remove anything by itself/);
    const page = readFileSync(join(ROOT, 'src/pages/request.astro'), 'utf8');
    expect(page).toContain('PARENT_VERIFICATION_NOTE');
  });

  it('promises no timing: the page and the thank-you screen name a time only when the owner supplied one', () => {
    const page = readFileSync(join(ROOT, 'src/pages/request.astro'), 'utf8');
    expect(page).toMatch(/cfg\.replyPromise \?/);
    expect(page).toContain('We do not promise a time');
    expect(page).not.toMatch(/within \d|24 hours|48 hours|\d+ days/i);
    for (const kind of ['profile_request', 'content_removal'] as const) {
      expect(nextSteps(kind).join(' ')).not.toMatch(/within|hours|days|minutes|\d/);
      expect(replyLine(null, kind)).toBe('We will get back to you as soon as we can.');
      expect(replyLine('2 working days', kind)).toBe('We reply within 2 working days.');
    }
  });

  it('the thank-you steps repeat the later-verification statement for both kinds', () => {
    for (const kind of ['profile_request', 'content_removal'] as const) {
      const text = nextSteps(kind).join(' ');
      expect(text).toMatch(/parent or guardian/);
      expect(text).toMatch(/one-time code sent to your own phone/);
      expect(text).toMatch(/not switched on yet/);
    }
  });
});

describe('which kind is sent', () => {
  it('"remove a video or other content" is a content_removal; claim, correct and hide are profile_request', () => {
    expect(kindOf(form, { ...fullValues.request!, requestType: 'remove_content' })).toBe('content_removal');
    for (const t of PROFILE_REQUEST_TYPES) expect(kindOf(form, { ...fullValues.request!, requestType: t })).toBe('profile_request');
    expect(kindOf(form, { ...fullValues.request!, requestType: '' })).toBe('profile_request');
    expect(['profile_request', 'content_removal'].every((k) => (LEAD_KINDS as readonly string[]).includes(k))).toBe(true);
  });

  it('forms without a selector keep their own kind', () => {
    expect(kindOf(forms.general!, fullValues.general!)).toBe('general');
    expect(kindOf(forms.coverage!, fullValues.coverage!)).toBe('coverage');
  });
});

describe('payload and contract', () => {
  it('every request type is accepted with the right kind, the request notice id and version, and the text as typed', () => {
    for (const requestType of REQUEST_TYPES) {
      for (const relationship of REQUEST_RELATIONSHIPS) {
        const body = payload({ requestType, relationship });
        expect(body.kind).toBe(requestType === CONTENT_REMOVAL_TYPE ? 'content_removal' : 'profile_request');
        expect(body.consent).toEqual({ id: CONSENT.requestNotice.id, version: CONSENT.requestNotice.version });
        const r = validate(body);
        expect(r.ok, `${requestType}/${relationship}: ${JSON.stringify(r)}`).toBe(true);
        if (r.ok && (r.data.kind === 'profile_request' || r.data.kind === 'content_removal')) {
          expect(r.data.requestType).toBe(requestType);
          expect(r.data.relationship).toBe(relationship);
          expect(r.data.what).toBe('https://example.org/players/sample-player/');
        }
      }
    }
  });

  it('the lead notice id is refused on these kinds and the request notice id is refused on the others', () => {
    const wrong = { ...payload(), consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version } };
    const r = validate(wrong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors['consent.id']).toBe('invalid');
    const general = buildPayload(forms.general!, fullValues.general! as never, META);
    expect(validate({ ...general, consent: { id: CONSENT.requestNotice.id, version: CONSENT.requestNotice.version } }).ok).toBe(false);
  });

  it('a type that does not belong to the kind is refused, and so is an unknown type', () => {
    expect(validate({ ...payload(), requestType: 'remove_content' }).ok).toBe(false);
    expect(validate({ ...payload({ requestType: 'remove_content' }), requestType: 'hide_profile' }).ok).toBe(false);
    expect(validate({ ...payload(), requestType: 'delete_everything' }).ok).toBe(false);
  });

  it('type, what, relationship, name and phone are each required on both sides', () => {
    for (const name of ['requestType', 'what', 'relationship', 'name', 'phone']) {
      const values = { ...fullValues.request!, [name]: '' };
      expect(checkForm(form, values, NOW)[name], `${name} client`).toBe('required');
      const r = validate(buildPayload(form, values as never, META));
      expect(r.ok, `${name} server`).toBe(false);
      if (!r.ok && name !== 'requestType') expect(r.fieldErrors[name], name).toBe('required');
    }
  });

  it('details is optional; a phone with pasted invisible marks is accepted', () => {
    expect(checkForm(form, { ...fullValues.request!, details: '' }, NOW)).toEqual({});
    expect(validate(payload({ details: '', phone: '+91 98765 43210' })).ok).toBe(true);
  });

  it('the link or description is text only: a link, a long description and a phone-like number are accepted; markup and control characters are not', () => {
    for (const what of ['https://www.youtube.com/watch?v=sampleId0001', 'The second video of the sample open final', 'x'.repeat(300), 'see 9876543210']) {
      expect(validate(payload({ what })).ok, what).toBe(true);
      expect(checkForm(form, { ...fullValues.request!, what }, NOW).what ?? null, what).toBeNull();
    }
    for (const what of ['x'.repeat(301), 'a<b>c', 'tab\there', 'zero​width']) {
      expect(validate(payload({ what })).ok, JSON.stringify(what)).toBe(false);
      expect(checkForm(form, { ...fullValues.request!, what }, NOW).what, JSON.stringify(what)).toBeDefined();
    }
  });

  it('the stored payload keeps the text as given (nothing is fetched or rewritten)', () => {
    const body = validate(payload());
    expect(body.ok).toBe(true);
    if (body.ok) expect(payloadOf(body.data)).toMatchObject({ what: 'https://example.org/players/sample-player/', relationship: 'parent_guardian', requestType: 'hide_profile' });
  });

  it('server field errors map onto the form boxes', () => {
    const mapped = mapFieldErrors(form, { what: 'required', relationship: 'invalid', 'consent.id': 'invalid' });
    expect(Object.keys(mapped.fields).sort()).toEqual(['relationship', 'what']);
    expect(mapped.unmapped).toEqual(['consent.id:invalid']);
  });
});

describe('consent evidence', () => {
  it('the request notice (id and version) is what is stored, for both kinds; nothing else is ticked', async () => {
    for (const requestType of ['hide_profile', 'remove_content']) {
      const r = validate(payload({ requestType }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const entries = consentEntriesOf(r.data);
      expect(entries).toEqual([{ id: 'request-notice', version: CONSENT.requestNotice.version, given: true }]);
      const rows = await consentRows('lead-1', entries);
      expect(rows.notices).toHaveLength(1);
      expect(rows.notices[0]).toMatchObject({ id: 'request-notice', text: CONSENT.requestNotice.text });
      expect(rows.events[0]).toMatchObject({ notice_id: 'request-notice', notice_version: CONSENT.requestNotice.version, given: true });
    }
  });
});

describe('privacy: no personal data in events, the WhatsApp fallback or the alert', () => {
  const secrets = [FICTIONAL.name, FICTIONAL.phone, '9876543210', 'sample-player', 'example.org', 'Please hide this profile'];

  it('the fallback WhatsApp text carries only the request type: no name, phone, link or details', () => {
    expect(form.messageField).toBeUndefined();
    expect(allFieldDefs(form).filter((f) => f.summary).map((f) => f.name)).toEqual(['requestType']);
    const text = fallbackText('profile_request', fallbackSummary(form, fullValues.request!));
    expect(text).toContain('Hide a profile');
    expect(text).toContain(KIND_LABEL.profile_request);
    for (const s of secrets) expect(text, s).not.toContain(s);
    expect(askText('profile_request')).toMatch(/^Hi Power Smash/);
    expect(askText('content_removal')).toBe(askText('profile_request'));
  });

  it('events carry only fixed labels: the kind that was sent, never a value', () => {
    for (const kind of ['profile_request', 'content_removal'] as const) {
      const body = JSON.stringify([buildEventBody('form_start', '/request/', { form: kind }), buildEventBody('form_submit', '/request/', { form: kind })]);
      for (const s of secrets) expect(body).not.toContain(s);
      expect(body).toContain(kind);
    }
  });

  it('both kinds have a human label for the owner alert, the inbox and the WhatsApp text', () => {
    expect(KIND_LABELS.profile_request).toBe('Profile request');
    expect(KIND_LABELS.content_removal).toBe('Content removal request');
    expect(KIND_LABEL.content_removal).toBe('content removal request');
  });
});

describe('the page', () => {
  const page = readFileSync(join(ROOT, 'src/pages/request.astro'), 'utf8');

  it('uses the one island, the request notice, the shared form section (WhatsApp button, noscript) and the one URL helper', () => {
    expect(page).toMatch(/<LeadForm\s+client:visible/);
    expect(page).toContain('leadNotice={cfg.requestNotice}');
    expect(page).toContain('<FormSection');
    expect(page).toContain('M3_ROUTES.request');
    expect(page).not.toMatch(/href="\//);
    expect(page).not.toContain('TODO(owner)');
  });

  it('links to the content-removal page', () => {
    expect(page).toContain('ROUTES.contentRemoval');
  });
});
