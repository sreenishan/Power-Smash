// In-memory RegistrationBackend for tests and the no-backend admin preview, with a FICTIONAL seed (invented names, 910000000000-style
// phones, example.test emails). It mirrors the rules of the 0020 RPCs so the service and the screen behave the same as on Supabase:
// owner only, a reason for every change, revisions (STALE), junior events refused, "verify first" for a registration made under a fee,
// a new player is provisional with UNKNOWN age (D-012), an existing player keeps their own age status, capacity counted under one lock.
import type { AgeStatus } from '../../archive/types';
import type { Actor } from '../types';
import { RegistrationError, type RegistrationBackend, type RegistrationEventSummary, type RegistrationRow, type RegistrationSettings } from './types';

type EventRec = Omit<RegistrationEventSummary, 'counts'>;
export interface MemoryPlayer {
  id: string;
  displayName: string;
  nameNormalized: string;
  ageStatus: AgeStatus;
  isProvisional: boolean;
  mergedInto: string | null;
}
export interface MemoryEntry {
  id: string;
  eventId: string;
  players: string[];
  status: 'pending' | 'confirmed' | 'waitlisted';
}
export interface MemoryRegistrationData {
  settings: RegistrationSettings;
  events: EventRec[];
  registrations: RegistrationRow[];
  players: MemoryPlayer[];
  entries: MemoryEntry[];
  suppressedNames: string[];
}

const ADULT = 'adult_confirmed' as const;

/** FICTIONAL seed: one open tournament with a singles event (fee), a doubles event (no fee) and a junior event. */
export function seedRegistrationData(): MemoryRegistrationData {
  const t = { tournamentId: 'c0000000-0000-4000-8000-000000000001', tournamentName: 'Sample City Open 2026' };
  return {
    settings: { enabled: false, paymentInstructions: null, upiId: null, payeeName: null },
    events: [
      { id: 'e0000000-0000-4000-8000-000000000001', ...t, category: 'MS', ageGroup: null, status: 'open', junior: false, capacity: 4, registrationOpen: true, entryFeePaise: 50_000 },
      { id: 'e0000000-0000-4000-8000-000000000002', ...t, category: 'XD', ageGroup: null, status: 'open', junior: false, capacity: null, registrationOpen: true, entryFeePaise: null },
      { id: 'e0000000-0000-4000-8000-000000000003', ...t, category: 'BS', ageGroup: 'U15', status: 'open', junior: true, capacity: null, registrationOpen: false, entryFeePaise: null },
    ],
    registrations: [
      {
        id: 'a0000000-0000-4000-8000-000000000001', ref: 'PSR-2026-A1B2C3', eventId: 'e0000000-0000-4000-8000-000000000001',
        player1Name: 'Sample Reg Alpha', player2Name: null, phone: '910000000001', email: 'alpha@example.test', whatsappOk: true,
        paymentReference: 'UTR000011112222', feePaiseAtSubmit: 50_000, status: 'submitted', verifiedAmountPaise: null, verifiedAt: null, entryId: null,
        convertedAt: null, rejectedReason: null, rejectedAt: null, revision: 1, createdAt: '2026-10-30T05:00:00.000Z',
      },
      {
        id: 'a0000000-0000-4000-8000-000000000002', ref: 'PSR-2026-D4E5F6', eventId: 'e0000000-0000-4000-8000-000000000002',
        player1Name: 'Demo Player Bravo', player2Name: 'Mock Player Charlie', phone: '910000000002', email: null, whatsappOk: false,
        paymentReference: null, feePaiseAtSubmit: null, status: 'submitted', verifiedAmountPaise: null, verifiedAt: null, entryId: null,
        convertedAt: null, rejectedReason: null, rejectedAt: null, revision: 1, createdAt: '2026-10-30T06:00:00.000Z',
      },
    ],
    players: [
      // an existing adult record with the same name as one registrant (the owner may pick it), and a protected record
      { id: 'b0000000-0000-4000-8000-000000000001', displayName: 'Demo Player Bravo', nameNormalized: 'demo player bravo', ageStatus: ADULT, isProvisional: false, mergedInto: null },
      { id: 'b0000000-0000-4000-8000-000000000002', displayName: 'Sample Reg Alpha', nameNormalized: 'sample reg alpha', ageStatus: 'unknown', isProvisional: true, mergedInto: null },
    ],
    entries: [],
    suppressedNames: [],
  };
}

export interface MemoryRegistrationOptions {
  now?: () => Date;
  newId?: () => string;
}

export function createMemoryRegistrationBackend(data: MemoryRegistrationData = seedRegistrationData(), opts: MemoryRegistrationOptions = {}): RegistrationBackend & { data: MemoryRegistrationData } {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const owner = (a: Actor) => {
    if (a.role !== 'owner') throw new RegistrationError('FORBIDDEN');
  };
  const needReason = (r: string) => {
    if (r.trim() === '') throw new RegistrationError('INVALID', 'A change needs a reason.');
  };
  const getReg = (id: string, expected: number) => {
    const r = data.registrations.find((x) => x.id === id);
    if (!r) throw new RegistrationError('NOT_FOUND');
    if (r.revision !== expected) throw new RegistrationError('STALE', 'The registration changed; reload it.');
    if (r.status !== 'submitted' && r.status !== 'payment_verified') throw new RegistrationError('INVALID', `The registration is already ${r.status.replace('_', ' ')}.`);
    return r;
  };
  const copy = <T>(v: T): T => structuredClone(v);

  return {
    data,
    getSettings: async () => copy(data.settings),
    listEvents: async () => copy(data.events.filter((e) => e.status !== 'draft')),
    getEvent: async (id) => copy(data.events.find((e) => e.id === id) ?? null),
    listRegistrations: async (ids) => copy(data.registrations.filter((r) => ids.includes(r.eventId))),
    findPlayers: async (keys) =>
      data.players.filter((p) => p.mergedInto === null && keys.includes(p.nameNormalized)).map((p) => ({ id: p.id, displayName: p.displayName, ageStatus: p.ageStatus, nameNormalized: p.nameNormalized })),

    setSettings: async (a, record, reason) => {
      owner(a);
      needReason(reason);
      if ((record.upiId === null) !== (record.payeeName === null)) throw new RegistrationError('INVALID', 'Give the UPI id together with the name it pays, or neither.');
      const before = data.settings;
      const fields = (['enabled', 'paymentInstructions', 'upiId', 'payeeName'] as const).filter((k) => before[k] !== record[k]);
      data.settings = { ...record };
      return { enabled: record.enabled, fields: [...fields] };
    },
    setEventRegistration: async (a, eventId, record, reason) => {
      owner(a);
      needReason(reason);
      const e = data.events.find((x) => x.id === eventId);
      if (!e) throw new RegistrationError('NOT_FOUND');
      if (record.entryFeePaise !== null && (!Number.isInteger(record.entryFeePaise) || record.entryFeePaise < 1 || record.entryFeePaise > 100_000_000)) {
        throw new RegistrationError('INVALID', 'The entry fee in paise must be a whole number from 1 to 100000000.');
      }
      if (record.open && e.status !== 'open') throw new RegistrationError('INVALID', 'Open the event itself first (its status must be open).');
      if (record.open && e.junior) throw new RegistrationError('INVALID', 'Registration on the site is not offered for junior events yet.');
      const fields = [...(e.registrationOpen !== record.open ? ['open'] : []), ...(e.entryFeePaise !== record.entryFeePaise ? ['entryFeePaise'] : [])];
      e.registrationOpen = record.open;
      e.entryFeePaise = record.entryFeePaise;
      return { id: e.id, fields };
    },
    verifyPayment: async (a, id, record, expected, reason) => {
      owner(a);
      needReason(reason);
      if (!Number.isInteger(record.amountPaise) || record.amountPaise < 0 || record.amountPaise > 100_000_000) throw new RegistrationError('INVALID', 'Enter the amount received.');
      const r = getReg(id, expected);
      r.status = 'payment_verified';
      r.verifiedAmountPaise = record.amountPaise;
      r.verifiedAt = now().toISOString();
      r.revision += 1;
      return { id: r.id, status: r.status, revision: r.revision };
    },
    convert: async (a, id, record, expected, reason) => {
      owner(a);
      needReason(reason);
      const r = getReg(id, expected);
      const e = data.events.find((x) => x.id === r.eventId);
      if (!e) throw new RegistrationError('NOT_FOUND');
      if (e.status === 'closed') throw new RegistrationError('INVALID', 'The event is closed to new entries.');
      if (r.feePaiseAtSubmit !== null && r.status !== 'payment_verified') throw new RegistrationError('INVALID', 'Verify the payment first (enter 0 if you waive the fee).');
      const count = r.player2Name === null ? 1 : 2;
      if (record.players.length !== count) throw new RegistrationError('INVALID', 'Give one player record for each name in the registration.');
      const ids: string[] = [];
      const created: MemoryPlayer[] = [];
      for (const p of record.players) {
        if ('playerId' in p) {
          if (!data.players.some((x) => x.id === p.playerId && x.mergedInto === null)) throw new RegistrationError('NOT_FOUND', 'Player not found (or merged into another).');
          ids.push(p.playerId);
        } else {
          if (data.suppressedNames.includes(p.nameNormalized)) throw new RegistrationError('INVALID', 'This name is on the removal list; pick the existing record or reject the registration.');
          // D-012: provisional, UNKNOWN age; never a self-claimed age
          const np: MemoryPlayer = { id: newId(), displayName: p.name, nameNormalized: p.nameNormalized, ageStatus: 'unknown', isProvisional: true, mergedInto: null };
          created.push(np);
          ids.push(np.id);
        }
      }
      if (new Set(ids).size !== ids.length) throw new RegistrationError('INVALID', 'A pair needs two different players.');
      const active = data.entries.filter((x) => x.eventId === e.id);
      if (ids.some((pid) => active.some((x) => x.players.includes(pid)))) throw new RegistrationError('INVALID', 'A player is already entered in this event.');
      if (record.status !== 'waitlisted' && e.capacity !== null && active.filter((x) => x.status !== 'waitlisted').length >= e.capacity) {
        throw new RegistrationError('INVALID', `The event is full (capacity ${e.capacity}); waitlist the entry instead.`);
      }
      data.players.push(...created);
      const entry: MemoryEntry = { id: newId(), eventId: e.id, players: ids, status: record.status };
      data.entries.push(entry);
      r.status = 'converted';
      r.entryId = entry.id;
      r.convertedAt = now().toISOString();
      r.revision += 1;
      return { id: r.id, status: r.status, entryId: entry.id, newPlayerIds: created.map((p) => p.id), revision: r.revision };
    },
    reject: async (a, id, expected, reason) => {
      owner(a);
      needReason(reason);
      const r = getReg(id, expected);
      r.status = 'rejected';
      r.rejectedReason = reason.trim();
      r.rejectedAt = now().toISOString();
      r.revision += 1;
      return { id: r.id, status: r.status, revision: r.revision };
    },
  };
}
