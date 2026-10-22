import { describe, expect, it } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { readAttribution } from '../../src/lib/forms/attribution';
import { initialValues } from '../../src/lib/forms/definitions';
import { ELAPSED_MS_MAX } from '../../src/lib/contracts/lead-constants';
import { buildPayload, clampElapsed, splitList } from '../../src/lib/forms/payload';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { META, forms, fullValues, pinClock } from './helpers';

pinClock();

describe('payload', () => {
  it('stores which notice text the visitor saw (id and version), the honeypot, key and token', () => {
    const p = buildPayload(forms.coverage!, fullValues.coverage!, { ...META, elapsedMs: 4321.7 });
    expect(p.consent).toEqual({ id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version });
    expect(p.website).toBe('');
    expect(p.idempotencyKey).toBe(META.idempotencyKey);
    expect(p.token).toBe(META.token);
    expect(p.elapsedMs).toBe(4322);
    expect(p.kind).toBe('coverage');
    expect(p.lang).toBe('en');
  });

  it('turns lists, yes/no, slugs and blanks into the shapes the contract wants', () => {
    const p = buildPayload(forms.coverage!, fullValues.coverage!, META);
    expect(p.categories).toEqual(['U13 boys singles', 'Open doubles']);
    expect(p.liveStream).toBe(true);
    expect(p.addOns).toEqual(['extra-court']);
    expect(p.matchDays).toBe('2');
    const bare = buildPayload(forms.coverage!, initialValues(forms.coverage!), META);
    for (const key of ['categories', 'liveStream', 'addOns', 'venue', 'email', 'packageKey', 'filmingPermission', 'budgetRange']) {
      expect(bare, key).not.toHaveProperty(key);
    }
  });

  it('"No" for live stream is sent as false, not dropped', () => {
    const p = buildPayload(forms.coverage!, { ...fullValues.coverage!, liveStream: 'no' }, META);
    expect(p.liveStream).toBe(false);
  });

  it('the tournament public-contact consent is always on record and false unless ticked', () => {
    const untouched = buildPayload(forms.tournament_submission!, initialValues(forms.tournament_submission!), META);
    expect(untouched.publicContactConsent).toEqual({ id: CONSENT.tournamentPublicContact.id, version: CONSENT.tournamentPublicContact.version, given: false });
    expect(untouched.coverageInterest).toBe(false);
    const ticked = buildPayload(forms.tournament_submission!, { ...fullValues.tournament_submission!, publicContactConsent: true }, META);
    expect((ticked.publicContactConsent as { given: boolean }).given).toBe(true);
  });

  it('the poster is a link only (no file field exists in the form)', () => {
    const names = forms.tournament_submission!.steps.flatMap((s) => s.fields.map((f) => f.name));
    expect(names).toContain('posterUrl');
    expect(forms.tournament_submission!.steps.flatMap((s) => s.fields).some((f) => (f.type as string) === 'file')).toBe(false);
  });

  it('whatsappOk follows the visitor\'s choice of WhatsApp, never assumed', () => {
    expect(buildPayload(forms.coverage!, { ...fullValues.coverage!, contactPreference: 'whatsapp' }, META).whatsappOk).toBe(true);
    expect(buildPayload(forms.coverage!, { ...fullValues.coverage!, contactPreference: 'call' }, META).whatsappOk).toBe(false);
    expect(buildPayload(forms.general!, fullValues.general!, META).whatsappOk).toBe(false);
  });

  it('splitList handles commas and new lines and drops blanks', () => {
    expect(splitList('a, b,,\n c ,')).toEqual(['a', 'b', 'c']);
    expect(splitList('  ')).toEqual([]);
  });

  it('source carries the page path and only the five standard UTM values', () => {
    const p = buildPayload(forms.general!, fullValues.general!, { ...META, page: '/contact', search: '?utm_source=whatsapp&utm_medium=status&utm_campaign=oct&gclid=abc&utm_content=' + 'x'.repeat(100) });
    expect(p.source).toEqual({ path: '/contact', utm: { source: 'whatsapp', medium: 'status', campaign: 'oct', content: 'x'.repeat(64) } });
    expect(readAttribution('/book', '')).toEqual({ path: '/book' });
    expect(readAttribution('book', '')).toEqual({ path: '/' });
  });

  it('consent wording is never pre-ticked: the public-contact text is shown unchanged as the label', () => {
    const field = forms.tournament_submission!.steps.flatMap((s) => s.fields).find((f) => f.name === 'publicContactConsent')!;
    expect(field.label).toBe(CONSENT.tournamentPublicContact.text);
    expect(field.type).toBe('checkbox');
  });
});

describe('B-4 / R-ELAPSED: the time since the first touch is clamped, never a reason to refuse the form', () => {
  it('stays inside 0 to 24 hours, as whole milliseconds', () => {
    expect(ELAPSED_MS_MAX).toBe(86_400_000);
    expect(clampElapsed(0)).toBe(0);
    expect(clampElapsed(4321.7)).toBe(4322);
    expect(clampElapsed(-5)).toBe(0);
    expect(clampElapsed(86_400_000)).toBe(86_400_000);
    expect(clampElapsed(90_000_000)).toBe(86_400_000);
    expect(clampElapsed(Number.POSITIVE_INFINITY)).toBe(86_400_000);
    expect(clampElapsed(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('a value that is not a number is left out (the field is optional) instead of being sent as null', () => {
    expect(clampElapsed(Number.NaN)).toBeUndefined();
    expect(buildPayload(forms.coverage!, fullValues.coverage!, { ...META, elapsedMs: Number.NaN })).not.toHaveProperty('elapsedMs');
  });

  it('a form left open for days still sends a body the server accepts', () => {
    for (const elapsedMs of [90_000_000, 3 * 86_400_000, 1e15]) {
      const payload = buildPayload(forms.coverage!, fullValues.coverage!, { ...META, elapsedMs });
      expect(payload.elapsedMs).toBe(86_400_000);
      const result = validateLeadRequest(payload);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  });

  it('no timer value at all sends no elapsedMs', () => {
    expect(buildPayload(forms.coverage!, fullValues.coverage!, META)).not.toHaveProperty('elapsedMs');
  });
});
