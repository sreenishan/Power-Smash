// The registration admin flow (src/lib/admin/registration) over the memory backend: list per event, verify a payment, convert to an
// entry (a new player is provisional with UNKNOWN age; an existing player keeps their own status), reject; owner only; STALE; junior
// events refused. The Supabase backend is checked against a fake select/rpc (RPC names, actor, args). Fictional data only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTACT_TEXT_PROBLEM, REASON_CONTACT_PROBLEM, UPI_PHONE_DIGITS, UPI_PHONE_PROBLEM, contactFree, upiLooksLikePhone } from '../../src/lib/admin/registration/rules';
import { OUTBOX_TEXT_SQL_PATTERNS } from '../../src/lib/notify/outbox/payload';
import { createMemoryRegistrationBackend, seedRegistrationData } from '../../src/lib/admin/registration/memory-backend';
import { REGISTRATION_ACTION_KINDS, REGISTRATION_ACTION_NAMES, REGISTRATION_ACTION_SCHEMAS } from '../../src/lib/admin/registration/schemas';
import { createRegistrationService, settingsProblems } from '../../src/lib/admin/registration/service';
import { createSupabaseRegistrationBackend, REGISTRATION_COLUMNS } from '../../src/lib/admin/registration/supabase-backend';
import type { Actor } from '../../src/lib/admin/types';
import {
  choicesNamePublicly,
  convertChoices,
  existingRecordWarning,
  initialChoices,
  nextSteps,
  parseAmountReceived,
  parseFee,
  rupeesText,
  underpaidQuestion,
} from '../../src/admin/screens/registrations/logic';

const OWNER: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const EDITOR: Actor = { userId: '22222222-2222-4222-8222-222222222222', role: 'editor' };
const MS = 'e0000000-0000-4000-8000-000000000001';
const XD = 'e0000000-0000-4000-8000-000000000002';
const BS = 'e0000000-0000-4000-8000-000000000003';
const R1 = 'a0000000-0000-4000-8000-000000000001';
const R2 = 'a0000000-0000-4000-8000-000000000002';

function setup() {
  let n = 0;
  const backend = createMemoryRegistrationBackend(seedRegistrationData(), { now: () => new Date('2026-10-31T06:00:00.000Z'), newId: () => `f0000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  return { backend, svc: createRegistrationService(backend) };
}

describe('lists', () => {
  it('events with counts, and one event with its registrations and name matches', async () => {
    const { svc } = setup();
    const ev = await svc.registrationEvents();
    expect(ev.ok && ev.data.map((e) => [e.category, e.counts.submitted, e.junior])).toEqual([['MS', 1, false], ['XD', 1, false], ['BS', 0, true]]);
    const d = await svc.registrationList({ eventId: XD });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const r = d.data.registrations[0];
    expect(r?.names.map((x) => x.typed)).toEqual(['Demo Player Bravo', 'Mock Player Charlie']);
    expect(r?.names[0]?.candidates.map((c) => c.ageStatus)).toEqual(['adult_confirmed']);
    expect(r?.names[1]?.candidates).toEqual([]);
    expect(r?.needsVerification).toBe(false);
    expect((await svc.registrationList({ eventId: '00000000-0000-4000-8000-000000000099' })).ok).toBe(false);
  });
});

describe('settings and events', () => {
  it('the owner switches registration on with the payee pair; a lone UPI id or a bad one is refused with a field error', async () => {
    const { svc } = setup();
    expect(settingsProblems({ paymentInstructions: null, upiId: 'sample@okdemo', payeeName: null })).toHaveProperty('payeeName');
    expect(settingsProblems({ paymentInstructions: null, upiId: 'not a upi', payeeName: 'Sample Payee' })).toHaveProperty('upiId');
    expect(settingsProblems({ paymentInstructions: '<b>', payeeName: null, upiId: null })).toHaveProperty('paymentInstructions');
    const bad = await svc.registrationSaveSettings(OWNER, { enabled: true, paymentInstructions: null, upiId: 'sample@okdemo', payeeName: null, reason: 'test' });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID' });
    const ok = await svc.registrationSaveSettings(OWNER, { enabled: true, paymentInstructions: '  Sample text to pay by UPI.  ', upiId: 'Sample@OkDemo', payeeName: 'Sample Payee', reason: 'test' });
    expect(ok.ok && ok.data.fields).toEqual(['enabled', 'paymentInstructions', 'upiId', 'payeeName']);
    const s = await svc.registrationSettings();
    expect(s.ok && s.data).toEqual({ enabled: true, paymentInstructions: 'Sample text to pay by UPI.', upiId: 'sample@okdemo', payeeName: 'Sample Payee' });
    expect(await svc.registrationSaveSettings(EDITOR, { enabled: false, paymentInstructions: null, upiId: null, payeeName: null, reason: 'test' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('a junior event cannot be opened; an adult event takes a fee in paise or none', async () => {
    const { svc, backend } = setup();
    expect(await svc.registrationSetEvent(OWNER, { eventId: BS, open: true, entryFeePaise: null, reason: 'test' })).toMatchObject({ ok: false, code: 'INVALID' });
    const r = await svc.registrationSetEvent(OWNER, { eventId: MS, open: true, entryFeePaise: 75_000, reason: 'test' });
    expect(r.ok && r.data.fields).toEqual(['entryFeePaise']);
    expect(backend.data.events[0]?.entryFeePaise).toBe(75_000);
    expect(await svc.registrationSetEvent(OWNER, { eventId: MS, open: true, entryFeePaise: 0, reason: 'test' })).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('verify, convert, reject', () => {
  it('a fee registration must be verified first; then a NEW player is created provisional with UNKNOWN age', async () => {
    const { svc, backend } = setup();
    const first = await svc.registrationConvert(OWNER, { registrationId: R1, players: [{ newName: 'Sample Reg Alpha' }], status: 'confirmed', expectedRevision: 1, reason: 'test' });
    expect(first).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await svc.registrationVerifyPayment(OWNER, { registrationId: R1, amountPaise: 50_000, expectedRevision: 7, reason: 'test' })).toMatchObject({ ok: false, code: 'STALE' });
    expect(await svc.registrationVerifyPayment(EDITOR, { registrationId: R1, amountPaise: 50_000, expectedRevision: 1, reason: 'test' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const v = await svc.registrationVerifyPayment(OWNER, { registrationId: R1, amountPaise: 50_000, expectedRevision: 1, reason: 'test' });
    expect(v.ok && v.data).toEqual({ id: R1, status: 'payment_verified', revision: 2 });
    const c = await svc.registrationConvert(OWNER, { registrationId: R1, players: [{ newName: '  Sample   Reg Alpha ' }], status: 'confirmed', expectedRevision: 2, reason: 'test' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const np = backend.data.players.find((p) => p.id === c.data.newPlayerIds[0]);
    expect(np).toMatchObject({ displayName: 'Sample Reg Alpha', nameNormalized: 'sample reg alpha', ageStatus: 'unknown', isProvisional: true });
    expect(backend.data.entries).toHaveLength(1);
    expect(backend.data.registrations.find((r) => r.id === R1)?.status).toBe('converted');
    expect(await svc.registrationReject(OWNER, { registrationId: R1, expectedRevision: 3, reason: 'test' })).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('a free doubles registration converts with an EXISTING adult (status kept) and a new record', async () => {
    const { svc, backend } = setup();
    const d = await svc.registrationList({ eventId: XD });
    if (!d.ok) throw new Error('list');
    const r = d.data.registrations[0];
    if (!r) throw new Error('row');
    const players = convertChoices(r, [r.names[0]?.candidates[0]?.id ?? 'new', 'new']);
    expect(players).toEqual([{ playerId: 'b0000000-0000-4000-8000-000000000001' }, { newName: 'Mock Player Charlie' }]);
    const c = await svc.registrationConvert(OWNER, { registrationId: R2, players, status: 'pending', expectedRevision: 1, reason: 'test' });
    expect(c.ok && c.data.newPlayerIds).toHaveLength(1);
    expect(backend.data.players.find((p) => p.id === 'b0000000-0000-4000-8000-000000000001')?.ageStatus).toBe('adult_confirmed');
    expect(backend.data.entries[0]?.players).toHaveLength(2);
  });

  it('wrong number of players, a suppressed name, and rejecting with a reason', async () => {
    const { svc, backend } = setup();
    expect(await svc.registrationConvert(OWNER, { registrationId: R2, players: [{ newName: 'Demo Player Bravo' }], status: 'pending', expectedRevision: 1, reason: 'test' })).toMatchObject({ ok: false, code: 'INVALID' });
    backend.data.suppressedNames.push('mock player charlie');
    expect(await svc.registrationConvert(OWNER, { registrationId: R2, players: [{ newName: 'Demo Player Bravo' }, { newName: 'Mock Player Charlie' }], status: 'pending', expectedRevision: 1, reason: 'test' })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(backend.data.players).toHaveLength(2); // nothing half-created
    const rej = await svc.registrationReject(OWNER, { registrationId: R2, expectedRevision: 1, reason: 'Fake reason for the test' });
    expect(rej.ok && rej.data.status).toBe('rejected');
    expect(backend.data.registrations.find((r) => r.id === R2)?.rejectedReason).toBe('Fake reason for the test');
  });

  it('a name that normalises to nothing cannot become a new record', async () => {
    const { svc } = setup();
    const r = await svc.registrationConvert(OWNER, { registrationId: R2, players: [{ newName: 'Demo Player Bravo' }, { newName: '...' }], status: 'pending', expectedRevision: 1, reason: 'test' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('the Supabase backend calls the 0020 RPCs with the verified actor', () => {
  it('names, arguments and explicit columns', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const queries: string[] = [];
    const b = createSupabaseRegistrationBackend({
      select: async <T,>(table: string, q: string) => {
        queries.push(`${table}?${q}`);
        return [] as T[];
      },
      rpc: async <T,>(name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {} as T;
      },
    });
    await b.setSettings(OWNER, { enabled: true, paymentInstructions: null, upiId: null, payeeName: null }, 'r');
    await b.setEventRegistration(OWNER, MS, { open: true, entryFeePaise: 100 }, 'r');
    await b.verifyPayment(OWNER, R1, { amountPaise: 100 }, 1, 'r');
    await b.convert(OWNER, R1, { players: [{ name: 'Sample X', nameNormalized: 'sample x' }], status: 'confirmed' }, 2, 'r');
    await b.reject(OWNER, R1, 3, 'r');
    expect(calls.map((c) => c.name)).toEqual(['admin_set_registration_settings', 'admin_set_event_registration', 'admin_verify_registration_payment', 'admin_convert_registration', 'admin_reject_registration']);
    expect(calls.every((c) => c.args.p_actor === OWNER.userId)).toBe(true);
    expect(calls[2]?.args).toEqual({ p_actor: OWNER.userId, p_registration: R1, p_record: { amountPaise: 100 }, p_expected_revision: 1, p_reason: 'r' });
    expect(await b.getSettings()).toEqual({ enabled: false, paymentInstructions: null, upiId: null, payeeName: null });
    await b.listRegistrations([MS]);
    await b.findPlayers(['sample "quoted" name']);
    expect(queries.every((q) => !q.includes('select=*'))).toBe(true);
    expect(queries.some((q) => q.startsWith('event_registrations?select=' + REGISTRATION_COLUMNS.event_registrations))).toBe(true);
    expect(queries.find((q) => q.startsWith('players?'))).toContain(encodeURIComponent('"sample \\"quoted\\" name"'));
  });
});

describe('the action schemas (for the integrator)', () => {
  it('every action has a schema and a kind; strict shapes refuse unknown keys', () => {
    expect(REGISTRATION_ACTION_NAMES.sort()).toEqual(Object.keys(REGISTRATION_ACTION_KINDS).sort());
    const conv = REGISTRATION_ACTION_SCHEMAS['registrations.convert'];
    expect(conv.safeParse({ registrationId: R1, players: [{ newName: 'Sample X' }], status: 'confirmed', expectedRevision: 1, reason: 'abc' }).success).toBe(true);
    expect(conv.safeParse({ registrationId: R1, players: [{ newName: 'Sample X', ageStatus: 'adult_confirmed' }], status: 'confirmed', expectedRevision: 1, reason: 'abc' }).success).toBe(false);
    expect(REGISTRATION_ACTION_SCHEMAS['registrations.setEvent'].safeParse({ eventId: MS, open: true, entryFeePaise: 12.5, reason: 'abc' }).success).toBe(false);
    expect(REGISTRATION_ACTION_SCHEMAS['registrations.verifyPayment'].safeParse({ registrationId: R1, amountPaise: 0, expectedRevision: 1, reason: 'abc' }).success).toBe(true);
  });
});

describe('screen helpers', () => {
  it('fees and amounts in rupees become paise; nothing is filled in', () => {
    expect(parseFee('')).toEqual({ ok: true, paise: null });
    expect(parseFee('500')).toEqual({ ok: true, paise: 50_000 });
    expect(parseFee('0').ok).toBe(false);
    expect(parseAmountReceived('').ok).toBe(false);
    expect(parseAmountReceived('0')).toEqual({ ok: true, paise: 0 });
    expect(parseAmountReceived('₹1,250.50')).toEqual({ ok: true, paise: 125_050 });
    expect(rupeesText(50_000)).toBe('500');
    expect(rupeesText(null)).toBe('');
    expect(nextSteps({ status: 'submitted', needsVerification: true })).toEqual({ verify: true, convert: false, reject: true });
    expect(nextSteps({ status: 'converted', needsVerification: false })).toEqual({ verify: false, convert: false, reject: false });
  });
});

describe('the convert dialog never picks a record by itself (D-012: a typed name is a self-claim)', () => {
  it('starts every name as a new record, even when a confirmed adult has the same name', async () => {
    const { svc } = setup();
    const d = await svc.registrationList({ eventId: XD });
    if (!d.ok) throw new Error('list');
    const r = d.data.registrations[0]!;
    expect(r.names[0]?.candidates.some((c) => c.ageStatus === 'adult_confirmed')).toBe(true);
    expect(initialChoices(r)).toEqual(r.names.map(() => 'new'));
    expect(choicesNamePublicly(r, initialChoices(r))).toBe(false);
    // the owner ticking the confirmed-adult record on purpose is flagged for a second question
    const adult = r.names[0]!.candidates.find((c) => c.ageStatus === 'adult_confirmed')!;
    expect(choicesNamePublicly(r, [adult.id, 'new'])).toBe(true);
    expect(existingRecordWarning('adult_confirmed')).toMatch(/shows this name on the website/);
    expect(existingRecordWarning('unknown')).toBeNull();
  });
  it('asks before recording less than the fee; the full fee, more, or 0 (waived) are not questioned', () => {
    expect(underpaidQuestion(5_000, 50_000)).toBe('You received less than the fee of ₹500. Record ₹50 anyway?');
    expect(underpaidQuestion(50_000, 50_000)).toBeNull();
    expect(underpaidQuestion(60_000, 50_000)).toBeNull();
    expect(underpaidQuestion(0, 50_000)).toBeNull();
    expect(underpaidQuestion(100, null)).toBeNull();
  });
});

describe('contact details stay out of the public payment texts and the audit log (mirrors 0020)', () => {
  it('the payment instructions and the UPI id refuse a phone number; the reason refuses contact details', async () => {
    const { svc } = setup();
    expect(settingsProblems({ paymentInstructions: 'Pay, then call 90000 00000 with the reference.', upiId: null, payeeName: null }).paymentInstructions).toBe(CONTACT_TEXT_PROBLEM);
    expect(settingsProblems({ paymentInstructions: 'Write to fake@example.test after paying.', upiId: null, payeeName: null }).paymentInstructions).toBe(CONTACT_TEXT_PROBLEM);
    expect(settingsProblems({ paymentInstructions: null, upiId: '9000000000@okfake', payeeName: 'Fake Payee' }).upiId).toBe(UPI_PHONE_PROBLEM);
    expect(settingsProblems({ paymentInstructions: null, upiId: '90000-00000@okfake', payeeName: 'Fake Payee' }).upiId).toBe(UPI_PHONE_PROBLEM);
    expect(settingsProblems({ paymentInstructions: 'Pay by UPI and type the reference in the note.', upiId: 'fakepayee2026@okfake', payeeName: 'Fake Payee' })).toEqual({});
    expect(upiLooksLikePhone('fakepayee@okfake')).toBe(false);
    expect(contactFree('Message wa.me/910000000000')).toBe(false);
    const d = await svc.registrationList({ eventId: MS });
    if (!d.ok) throw new Error('list');
    const r = d.data.registrations[0]!;
    const res = await svc.registrationReject(OWNER, { registrationId: r.id, expectedRevision: r.revision, reason: 'called 90000 00000, duplicate' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.errors?.reason).toBe(REASON_CONTACT_PROBLEM);
  });
  it('the SQL holds the same contact patterns', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/0020_registrations.sql', import.meta.url), 'utf8');
    for (const p of Object.values(OUTBOX_TEXT_SQL_PATTERNS)) expect(sql).toContain(p);
    expect(sql).toContain(`length(regexp_replace(split_part(p, '@', 1), '[^0-9]', '', 'g')) >= ${UPI_PHONE_DIGITS}`);
    expect(sql).toMatch(/if not app\.registration_contact_free\(p_reason\) then/);
  });
});
