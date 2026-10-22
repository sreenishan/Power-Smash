import { describe, expect, it } from 'vitest';
import { FIELD_ERROR_MESSAGES, LEAD_KINDS } from '../../src/lib/contracts/lead-constants';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { allFields, initialValues } from '../../src/lib/forms/definitions';
import { buildPayload } from '../../src/lib/forms/payload';
import {
  firstErrorField,
  firstStepWithError,
  mapFieldErrors,
  validateStep,
  validateValues,
} from '../../src/lib/forms/validate';
import { START_DATE_OUT_OF_RANGE_MESSAGE } from '../../src/lib/contracts/lead-constants';
import { META, NOW, forms, fullValues, pinClock } from './helpers';

pinClock();

describe('initial values: nothing is ticked, nothing is typed', () => {
  for (const [kind, form] of Object.entries(forms)) {
    it(`${kind}: every checkbox starts false and every group starts empty`, () => {
      const values = initialValues(form);
      for (const field of allFields(form)) {
        if (field.type === 'checkbox') expect(values[field.name], field.name).toBe(false);
        else if (field.type === 'checks') expect(values[field.name], field.name).toEqual([]);
        else if (!(kind === 'tournament_submission' && field.name === 'listingType')) expect(values[field.name], field.name).toBe('');
      }
    });
  }

  it('the only pre-selected radio is the free tournament listing, never a consent', () => {
    expect(initialValues(forms.tournament_submission!).listingType).toBe('free');
    expect(initialValues(forms.tournament_submission!).publicContactConsent).toBe(false);
    expect(initialValues(forms.tournament_submission!).coverageInterest).toBe(false);
  });
});

describe('the contract accepts what every form can produce', () => {
  for (const [kind, form] of Object.entries(forms)) {
    it(`${kind}: a fully filled form passes the contract`, () => {
      const payload = buildPayload(form, fullValues[kind]!, META);
      const result = validateLeadRequest(payload);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });

    it(`${kind}: the client-side check finds no error in a fully filled form`, () => {
      expect(validateValues(form, fullValues[kind]!).fields).toEqual({});
    });
  }

  it('every field name in every form is known to the contract (no field is silently stripped)', () => {
    for (const [kind, form] of Object.entries(forms)) {
      const payload = buildPayload(form, fullValues[kind]!, META);
      const result = validateLeadRequest(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const data = result.data as unknown as Record<string, unknown>;
      for (const field of allFields(form)) {
        if (field.name === 'contactPreference' || field.name === 'publicContactConsent') continue;
        const filled = fullValues[kind]![field.name];
        const empty = filled === '' || filled === false || (Array.isArray(filled) && filled.length === 0);
        if (!empty) expect(data[field.name], `${kind}.${field.name} was dropped by the contract`).not.toBeUndefined();
      }
    }
  });
});

describe('required fields per kind show a plain message on the right field', () => {
  it('coverage step 1: tournament name, first day, name and phone are required', () => {
    const errors = validateStep(forms.coverage!, 0, initialValues(forms.coverage!));
    expect(Object.keys(errors).sort()).toEqual(['eventName', 'name', 'phone', 'startDate']);
    expect(errors.startDate).toBe('Please pick the first day of the tournament.');
    expect(errors.name).toBe(FIELD_ERROR_MESSAGES.required);
  });

  it('coverage: the filming-permission question must be answered, and "Not sure" is a valid answer', () => {
    const values = { ...fullValues.coverage!, filmingPermission: '' };
    expect(validateValues(forms.coverage!, values).fields.filmingPermission).toBe('Please choose one. "Not sure" is fine.');
    for (const answer of ['yes', 'no', 'unsure']) {
      expect(validateValues(forms.coverage!, { ...fullValues.coverage!, filmingPermission: answer }).fields).toEqual({});
    }
  });

  it('coverage: only step 1 errors show on step 1, later steps are not complained about yet', () => {
    const values = { ...initialValues(forms.coverage!), eventName: 'Sample Open', startDate: '2027-01-05', name: 'Test Person', phone: '9876543210' };
    expect(validateStep(forms.coverage!, 0, values)).toEqual({});
    expect(validateStep(forms.coverage!, 1, values)).toEqual({});
    expect(Object.keys(validateStep(forms.coverage!, 2, values))).toEqual(['filmingPermission']);
  });

  it('sponsorship: company, name and phone', () => {
    const errors = validateStep(forms.sponsorship!, 0, initialValues(forms.sponsorship!));
    expect(Object.keys(errors).sort()).toEqual(['company', 'name', 'phone']);
  });

  it('general: a phone number or an email is needed, and the message', () => {
    const base = { ...initialValues(forms.general!), name: 'Test Person', message: 'A real message here.' };
    const none = validateValues(forms.general!, base).fields;
    expect(none.phone).toBe(FIELD_ERROR_MESSAGES.contact_required);
    expect(validateValues(forms.general!, { ...base, email: 'a@example.com' }).fields).toEqual({});
    expect(validateValues(forms.general!, { ...base, phone: '9876543210' }).fields).toEqual({});
    expect(validateValues(forms.general!, { ...base, message: 'Hi' }).fields.message).toBe('Please write a little more so we can help.');
  });

  it('tournament submission: name, first day, contact person and phone', () => {
    const errors = validateStep(forms.tournament_submission!, 0, initialValues(forms.tournament_submission!));
    expect(Object.keys(errors).sort()).toEqual(['name', 'phone', 'startDate', 'tournamentName']);
  });
});

describe('field level messages come from the contract, in plain English', () => {
  it('maps an invalid phone, email, link and date', () => {
    const values = {
      ...fullValues.tournament_submission!,
      phone: '12345',
      email: 'not-an-email',
      registrationLink: 'http://insecure.example',
      posterUrl: 'ftp://nope.example',
      startDate: '2027-13-40',
    };
    const errors = validateValues(forms.tournament_submission!, values).fields;
    expect(errors.phone).toBe(FIELD_ERROR_MESSAGES.invalid_phone);
    expect(errors.email).toBe(FIELD_ERROR_MESSAGES.invalid_email);
    expect(errors.registrationLink).toBe(FIELD_ERROR_MESSAGES.invalid_url);
    expect(errors.posterUrl).toBe(FIELD_ERROR_MESSAGES.invalid_url);
    expect(errors.startDate).toBe(FIELD_ERROR_MESSAGES.invalid_date);
  });

  it('rejects a link or digits in a name, a leading formula character, and too-long text', () => {
    const values = {
      ...fullValues.coverage!,
      name: 'Visit www.spam.example now',
      venue: '=SUM(A1)',
      notes: 'x'.repeat(1600),
    };
    const errors = validateValues(forms.coverage!, values).fields;
    expect(errors.name).toBeDefined();
    expect(errors.venue).toBeDefined();
    expect(errors.notes).toBe(FIELD_ERROR_MESSAGES.too_long);
  });

  it('flags an end date before the start date, even while another field is also wrong', () => {
    const values = { ...fullValues.coverage!, startDate: '2027-02-10', endDate: '2027-02-01', phone: '12' };
    const errors = validateValues(forms.coverage!, values).fields;
    expect(errors.endDate).toBe('The last day cannot be before the first day.');
    expect(errors.phone).toBe(FIELD_ERROR_MESSAGES.invalid_phone);
  });

  it('every message is plain English: no code words, no zod text', () => {
    for (const message of Object.values(FIELD_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/undefined|zod|expected|invalid_|_/i);
    }
  });
});

describe('server fieldErrors are mapped onto the form (field path to field name)', () => {
  it('maps top-level and dotted paths, and reports fields the visitor cannot see', () => {
    const mapped = mapFieldErrors(forms.tournament_submission!, {
      phone: 'invalid_phone',
      'publicContactConsent.version': 'invalid',
      'consent.id': 'invalid',
      token: 'invalid',
      serviceKeys: 'invalid',
    });
    expect(mapped.fields.phone).toBe(FIELD_ERROR_MESSAGES.invalid_phone);
    expect(mapped.fields.publicContactConsent).toBe(FIELD_ERROR_MESSAGES.invalid);
    expect(mapped.unmapped.sort()).toEqual(['consent.id:invalid', 'serviceKeys:invalid', 'token:invalid']);
  });

  it('uses the field-specific wording when the form defines one', () => {
    const mapped = mapFieldErrors(forms.coverage!, { startDate: 'required' });
    expect(mapped.fields.startDate).toBe('Please pick the first day of the tournament.');
  });

  it('finds the first error in display order and its step', () => {
    const errors = { notes: 'x', eventName: 'y', filmingPermission: 'z' };
    expect(firstStepWithError(forms.coverage!, errors)).toBe(0);
    expect(firstErrorField(forms.coverage!, errors)).toBe('eventName');
    expect(firstErrorField(forms.coverage!, { notes: 'x', filmingPermission: 'z' })).toBe('filmingPermission');
    expect(firstStepWithError(forms.coverage!, {})).toBe(-1);
  });
});

describe('kinds', () => {
  it('the forms cover the lead kinds that have a form (player_product has none; content_removal is sent by the request form)', () => {
    for (const form of Object.values(forms)) expect(LEAD_KINDS).toContain(form.kind);
    expect(Object.values(forms).map((f) => f.kind).sort()).toEqual(['alerts_signup', 'coverage', 'general', 'profile_request', 'sponsorship', 'tournament_submission', 'video_submission']);
  });
});

describe('C-18: the permission question on /book', () => {
  const field = () => forms.coverage!.steps.flatMap((s) => s.fields).find((f) => f.name === 'filmingPermission')!;

  it('asks for written permission or agreement for filming, publishing and earning from the matches', () => {
    const label = field().label;
    expect(label).toContain('written permission or agreement');
    expect(label).toMatch(/film/);
    expect(label).toMatch(/publish/);
    expect(label).toMatch(/earn money/);
    expect(label).toMatch(/organizer or association/);
  });

  it('offers Yes / Not yet / Not sure, with the values the contract knows (D-019)', () => {
    expect(field().options).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'Not yet' },
      { value: 'unsure', label: 'Not sure' },
    ]);
    // every option is accepted by the contract
    for (const o of field().options!) {
      const result = validateLeadRequest(buildPayload(forms.coverage!, { ...fullValues.coverage!, filmingPermission: o.value }, META));
      expect(result.ok, o.value).toBe(true);
    }
  });

  it('the hint says that a message or an email counts as written, and names the answers that are on screen', () => {
    const hint = field().hint!;
    expect(hint).toMatch(/WhatsApp message or an email counts as written/);
    expect(hint).toContain('"Not yet"');
    expect(hint).toContain('"Not sure"');
    expect(hint).not.toContain('"No"');
  });

  it('the question is still required, and "Not sure" is a complete answer', () => {
    expect(validateValues(forms.coverage!, { ...fullValues.coverage!, filmingPermission: '' }, NOW).fields.filmingPermission).toBe('Please choose one. "Not sure" is fine.');
    expect(validateValues(forms.coverage!, { ...fullValues.coverage!, filmingPermission: 'unsure' }, NOW).fields).toEqual({});
  });
});

describe('B-13: the browser checks the value that is sent (trimmed), like the server', () => {
  const edge = ['﻿', ' ', ' ', '\n', '\r\n', '\t', ' ', ' '];

  it('a stray invisible mark or line break at the edge of a pasted value is not an error', () => {
    for (const e of edge) {
      for (const [name, value] of [
        ['name', 'Test Person'],
        ['eventName', 'Sample Open 2027'],
        ['email', 'test.person@example.com'],
        ['phone', '98765 43210'],
        ['venue', 'Sample Indoor Stadium'],
      ] as const) {
        for (const pasted of [`${e}${value}`, `${value}${e}`, `${e}${value}${e}`]) {
          const values = { ...fullValues.coverage!, [name]: pasted };
          const client = validateValues(forms.coverage!, values, NOW).fields[name];
          const server = validateLeadRequest(buildPayload(forms.coverage!, values, META));
          const serverCode = server.ok ? undefined : server.fieldErrors[name];
          expect(client === undefined, `${name} ${JSON.stringify(pasted)}: client says ${client}, server says ${serverCode}`).toBe(serverCode === undefined);
        }
      }
    }
  });

  it('the value the server receives is exactly the one the browser checked', () => {
    const values = { ...fullValues.general!, email: 'test.person@example.com\n', message: '﻿We would like to know more. ' };
    expect(validateValues(forms.general!, values, NOW).fields).toEqual({});
    const payload = buildPayload(forms.general!, values, META);
    expect(payload.email).toBe('test.person@example.com');
    expect(payload.message).toBe('We would like to know more.');
    expect(validateLeadRequest(payload).ok).toBe(true);
  });

  it('a value that is only edge characters counts as blank, so a required box says "required"', () => {
    const values = { ...fullValues.general!, name: '﻿\n ' };
    expect(validateValues(forms.general!, values, NOW).fields.name).toBe(FIELD_ERROR_MESSAGES.required);
  });

  it('hidden characters INSIDE a value are still refused', () => {
    const values = { ...fullValues.general!, name: 'Test﻿Person' };
    expect(validateValues(forms.general!, values, NOW).fields.name).toBe(FIELD_ERROR_MESSAGES.control_chars);
  });
});

describe('R-DATE in the forms: a start date is from yesterday up to three years ahead, in one plain sentence', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = '2026-10-21'; // NOW is 12:00 IST on this day
  const dayOffset = (n: number) => iso(new Date(Date.UTC(2026, 9, 21 + n)));
  const SENTENCE = 'Please check the date: it should be from yesterday up to three years ahead.';

  it('accepts yesterday, today and the last allowed day; refuses the day before yesterday and the day after the window', () => {
    for (const startDate of [dayOffset(-1), today, dayOffset(1095)]) {
      expect(validateStep(forms.coverage!, 0, { ...fullValues.coverage!, startDate }, NOW).startDate, startDate).toBeUndefined();
    }
    for (const startDate of [dayOffset(-2), dayOffset(1096), '2000-01-01', '2100-12-31']) {
      expect(validateStep(forms.coverage!, 0, { ...fullValues.coverage!, startDate }, NOW).startDate, startDate).toBe(SENTENCE);
    }
  });

  it('the sentence is the one agreed for both sides (it comes from the contract constants)', () => {
    expect(FIELD_ERROR_MESSAGES.date_out_of_range).toBe(SENTENCE);
    expect(START_DATE_OUT_OF_RANGE_MESSAGE).toBe(SENTENCE);
  });

  it('a date that is not a real date still gets the plain "pick a valid date" message', () => {
    expect(validateStep(forms.coverage!, 0, { ...fullValues.coverage!, startDate: '2027-02-30' }, NOW).startDate).toBe(FIELD_ERROR_MESSAGES.invalid_date);
  });

  it('the tournament form and the booking form both check the start date the same way', () => {
    for (const kind of ['coverage', 'tournament_submission'] as const) {
      const form = forms[kind]!;
      expect(validateValues(form, { ...fullValues[kind]!, startDate: '2001-05-05' }, NOW).fields.startDate, kind).toBe(SENTENCE);
      expect(validateValues(form, { ...fullValues[kind]!, startDate: '2027-02-10', endDate: '' }, NOW).fields.startDate, kind).toBeUndefined();
    }
  });

  it('the last day is checked as a plain date (like the server) and must not be before the first day', () => {
    const values = { ...fullValues.coverage!, startDate: '2027-02-10', endDate: '2027-02-09' };
    expect(validateValues(forms.coverage!, values, NOW).fields.endDate).toBe('The last day cannot be before the first day.');
    // far ahead is not a window error on the last day, the server does not apply the window to it
    expect(validateValues(forms.coverage!, { ...fullValues.coverage!, startDate: '2027-02-10', endDate: '2031-02-10' }, NOW).fields.endDate).toBeUndefined();
  });

  it('a server answer of date_out_of_range on a start date shows the same sentence', () => {
    expect(mapFieldErrors(forms.coverage!, { startDate: 'date_out_of_range' }).fields.startDate).toBe(SENTENCE);
    expect(mapFieldErrors(forms.tournament_submission!, { startDate: 'date_out_of_range' }).fields.startDate).toBe(SENTENCE);
  });

  it('the clock is injectable: the same date is fine today and out of range in four years', () => {
    const values = { ...fullValues.coverage!, startDate: '2027-02-10', endDate: '' };
    expect(validateStep(forms.coverage!, 0, values, NOW).startDate).toBeUndefined();
    expect(validateStep(forms.coverage!, 0, values, new Date('2030-06-01T06:30:00Z')).startDate).toBe(SENTENCE);
  });

  it('the day changes at midnight India time: 18:29:59 UTC is still "today", 18:30:00 UTC is tomorrow', () => {
    const values = { ...fullValues.coverage!, startDate: '2026-10-20', endDate: '' }; // yesterday relative to the 21st
    expect(validateStep(forms.coverage!, 0, values, new Date('2026-10-21T18:29:59.999Z')).startDate).toBeUndefined();
    expect(validateStep(forms.coverage!, 0, values, new Date('2026-10-21T18:30:00.000Z')).startDate).toBe(SENTENCE);
  });
});

describe('R-TEXT in the forms: what organisers paste from posters is accepted', () => {
  it('the rupee sign, dashes, curly quotes, % ! ? and the middle dot are fine in the label-style boxes', () => {
    for (const [name, value] of [
      ['eventName', "Chennai Open – Men's Doubles"],
      ['eventName', 'Cup “26” — Day 1!'],
      ['budgetRange', '₹ 25,000 – ₹ 30,000'],
      ['budgetRange', '20% advance'],
      ['venue', 'Anna Stadium · Court 2'],
      ['district', 'Is it Madurai?'],
      ['organization', 'Chennai ‘District’ Association'],
    ] as const) {
      expect(validateValues(forms.coverage!, { ...fullValues.coverage!, [name]: value }, NOW).fields[name], `${name}: ${value}`).toBeUndefined();
    }
  });

  it('a person\'s name does not get the extra characters, and the unsafe ones stay refused everywhere', () => {
    expect(validateValues(forms.coverage!, { ...fullValues.coverage!, name: '₹ Test Person' }, NOW).fields.name).toBeDefined();
    for (const bad of ['A|B', 'A;B', 'A[1]', 'A{1}', 'A\\B', 'A`B', '=₹5', 'Cup <b>']) {
      expect(validateValues(forms.coverage!, { ...fullValues.coverage!, venue: bad }, NOW).fields.venue, bad).toBeDefined();
    }
  });
});
