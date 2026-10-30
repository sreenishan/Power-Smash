// The registration admin actions (D-111), shared by the memory store (tests, preview) and the Supabase store (the Vercel admin function):
// both give it a RegistrationBackend. Every write is one owner RPC of migration 0020 that checks the owner and audits; refusals come
// back as plain English in `errors.form`. A new player name is normalised here with the parser's one normaliser (PC-05), so the
// database's suppression check and the duplicate search use the same key as the rest of the archive.
import { normalizeName } from '../../parser/normalize';
import { CONTACT_TEXT_PROBLEM, UPI_PHONE_PROBLEM, contactFree, rejectReasonProblem, upiLooksLikePhone } from './rules';
import { failResult, okResult, type AdminErrorCode, type StoreResult } from '../types';
import {
  REGISTRATION_STATUSES,
  RegistrationError,
  type RegistrationAdminStore,
  type RegistrationBackend,
  type RegistrationDto,
  type RegistrationEventSummary,
  type RegistrationRow,
  type RegistrationStatus,
} from './types';

const PASS_THROUGH: readonly AdminErrorCode[] = ['INVALID', 'NOT_FOUND', 'STALE', 'FORBIDDEN', 'BACKEND_ERROR'];

function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof RegistrationError || (typeof code === 'string' && (PASS_THROUGH as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    return typeof detail === 'string' && detail !== '' ? failResult(c, { form: detail }) : failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

const refuse = (message: string, field = 'form') => failResult('INVALID', { [field]: message });

function emptyCounts(): Record<RegistrationStatus, number> {
  return Object.fromEntries(REGISTRATION_STATUSES.map((s) => [s, 0])) as Record<RegistrationStatus, number>;
}

/** The plain-English refusal for a UPI id or payee pair the database would refuse anyway (checked first so the owner gets a field error). */
export function settingsProblems(input: { paymentInstructions: string | null; upiId: string | null; payeeName: string | null }): Record<string, string> {
  const errors: Record<string, string> = {};
  const text = (input.paymentInstructions ?? '').trim();
  if (text !== '' && (text.length < 10 || text.length > 1000 || /[<>]/.test(text))) errors.paymentInstructions = 'Write 10 to 1000 characters, without < or >.';
  else if (text !== '' && !contactFree(text)) errors.paymentInstructions = CONTACT_TEXT_PROBLEM;
  const upi = (input.upiId ?? '').trim().toLowerCase();
  if (upi !== '' && !/^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9.-]{1,63}$/.test(upi)) errors.upiId = 'A UPI id looks like name@bank, for example sample@okdemo.';
  else if (upi !== '' && upiLooksLikePhone(upi)) errors.upiId = UPI_PHONE_PROBLEM;
  const payee = (input.payeeName ?? '').trim();
  if (payee !== '' && (payee.length < 2 || payee.length > 80 || /[<>]/.test(payee))) errors.payeeName = 'Write the name the UPI id pays, 2 to 80 characters.';
  if ((upi === '') !== (payee === '') && !errors.upiId && !errors.payeeName) errors[upi === '' ? 'upiId' : 'payeeName'] = 'Give the UPI id together with the name it pays, or leave both empty.';
  return errors;
}

export function createRegistrationService(b: RegistrationBackend): RegistrationAdminStore {
  async function summaries(): Promise<RegistrationEventSummary[]> {
    const events = await b.listEvents();
    const regs = events.length === 0 ? [] : await b.listRegistrations(events.map((e) => e.id));
    return events.map((e) => {
      const counts = emptyCounts();
      for (const r of regs) if (r.eventId === e.id) counts[r.status] += 1;
      return { ...e, counts };
    });
  }

  async function dtos(rows: RegistrationRow[]): Promise<RegistrationDto[]> {
    const keys = new Set<string>();
    for (const r of rows) for (const n of [r.player1Name, r.player2Name]) if (n) { const k = normalizeName(n); if (k) keys.add(k); }
    const players = keys.size === 0 ? [] : await b.findPlayers([...keys]);
    const candidatesFor = (typed: string) => {
      const k = normalizeName(typed);
      return k === null ? [] : players.filter((p) => p.nameNormalized === k).map(({ id, displayName, ageStatus }) => ({ id, displayName, ageStatus }));
    };
    return rows.map((r) => ({
      ...r,
      names: [r.player1Name, ...(r.player2Name ? [r.player2Name] : [])].map((typed) => ({ typed, candidates: candidatesFor(typed) })),
      needsVerification: r.feePaiseAtSubmit !== null && r.status === 'submitted',
    }));
  }

  return {
    registrationSettings: () => guard(async () => okResult(await b.getSettings())),
    registrationEvents: () => guard(async () => okResult(await summaries())),
    registrationList: (input) =>
      guard(async () => {
        const event = await b.getEvent(input.eventId);
        if (!event) return failResult('NOT_FOUND');
        const rows = (await b.listRegistrations([event.id])).sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id.localeCompare(y.id)));
        const counts = emptyCounts();
        for (const r of rows) counts[r.status] += 1;
        return okResult({ event: { ...event, counts }, registrations: await dtos(rows) });
      }),

    registrationSaveSettings: (actor, input) =>
      guard(async () => {
        const problems = settingsProblems(input);
        if (Object.keys(problems).length > 0) return failResult('INVALID', problems);
        const clean = (v: string | null) => (v === null || v.trim() === '' ? null : v.trim());
        return okResult(
          await b.setSettings(actor, { enabled: input.enabled, paymentInstructions: clean(input.paymentInstructions), upiId: clean(input.upiId)?.toLowerCase() ?? null, payeeName: clean(input.payeeName) }, input.reason),
        );
      }),
    registrationSetEvent: (actor, input) =>
      guard(async () => {
        const event = await b.getEvent(input.eventId);
        if (!event) return failResult('NOT_FOUND');
        if (input.open && event.junior) return refuse('Registration on the website is not offered for junior events yet.');
        if (input.open && event.status !== 'open') return refuse('Open the event itself first (its status must be open).');
        return okResult(await b.setEventRegistration(actor, input.eventId, { open: input.open, entryFeePaise: input.entryFeePaise }, input.reason));
      }),
    registrationVerifyPayment: (actor, input) =>
      guard(async () => okResult(await b.verifyPayment(actor, input.registrationId, { amountPaise: input.amountPaise }, input.expectedRevision, input.reason))),
    registrationConvert: (actor, input) =>
      guard(async () => {
        const players: Array<{ playerId: string } | { name: string; nameNormalized: string }> = [];
        for (const [i, p] of input.players.entries()) {
          if ('playerId' in p) {
            players.push({ playerId: p.playerId });
            continue;
          }
          const name = p.newName.trim().replace(/\s+/g, ' ');
          const key = normalizeName(name);
          if (key === null) return refuse('This name cannot be used for a new player record. Type it in letters.', `players.${i}`);
          players.push({ name, nameNormalized: key });
        }
        return okResult(await b.convert(actor, input.registrationId, { players, status: input.status }, input.expectedRevision, input.reason));
      }),
    registrationReject: (actor, input) =>
      guard(async () => {
        const p = rejectReasonProblem(input.reason);
        if (p) return refuse(p, 'reason');
        return okResult(await b.reject(actor, input.registrationId, input.expectedRevision, input.reason));
      }),
  };
}
