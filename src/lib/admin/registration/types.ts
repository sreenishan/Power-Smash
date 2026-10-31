// Registrations in the admin (D-111): the owner lists registrations per event, verifies a payment made outside the site, then converts
// a registration into an event entry (an existing player record, or a new provisional player of UNKNOWN age, D-012) or rejects it.
// The owner sees contact details here (the admin is owner-only, aal2); they never reach a public view, an alert or the audit log.
import type { AgeStatus } from '../../archive/types';
import type { Actor, StoreResult } from '../types';

export type RegistrationStatus = 'submitted' | 'payment_verified' | 'converted' | 'rejected';
export const REGISTRATION_STATUSES = ['submitted', 'payment_verified', 'converted', 'rejected'] as const satisfies readonly RegistrationStatus[];

export interface RegistrationSettings {
  /** The owner's switch for the whole feature (competition_settings.registration_enabled). */
  enabled: boolean;
  paymentInstructions: string | null;
  upiId: string | null;
  payeeName: string | null;
}

/** A registration row as the owner sees it. */
export interface RegistrationRow {
  id: string;
  ref: string;
  eventId: string;
  player1Name: string;
  player2Name: string | null;
  /** null once the keep-for period removed the contact details (0025, anonymisedAt set). */
  phone: string | null;
  email: string | null;
  whatsappOk: boolean;
  paymentReference: string | null;
  /** The fee shown when the person registered (integer paise), or null. */
  feePaiseAtSubmit: number | null;
  status: RegistrationStatus;
  verifiedAmountPaise: number | null;
  verifiedAt: string | null;
  entryId: string | null;
  convertedAt: string | null;
  rejectedReason: string | null;
  rejectedAt: string | null;
  revision: number;
  createdAt: string;
  /** When the retention job removed the names as typed and the contact details (0025); null or absent = never. */
  anonymisedAt?: string | null;
}

/** An event as the Registrations screen lists it. */
export interface RegistrationEventSummary {
  id: string;
  tournamentId: string;
  tournamentName: string;
  category: string;
  ageGroup: string | null;
  /** draft | open | closed (the event itself). */
  status: string;
  /** Junior event or a tournament with a minor signal / school level: registration cannot be opened (fail closed). */
  junior: boolean;
  capacity: number | null;
  registrationOpen: boolean;
  entryFeePaise: number | null;
  counts: Record<RegistrationStatus, number>;
}

export interface PlayerCandidate {
  id: string;
  displayName: string;
  ageStatus: AgeStatus;
}

export interface RegistrationDto extends RegistrationRow {
  /** One item per typed name: existing player records with the same normalised name (the owner picks one, or a new record). */
  names: Array<{ typed: string; candidates: PlayerCandidate[] }>;
  /** A registration made under a fee must have its payment verified before it can be converted. */
  needsVerification: boolean;
}

export interface RegistrationEventDetail {
  event: RegistrationEventSummary;
  registrations: RegistrationDto[];
}

// ----------------------------------------------------------------------------- the backend (primitive reads and the 0020 RPCs)

export interface RegistrationBackend {
  getSettings(): Promise<RegistrationSettings>;
  listEvents(): Promise<Omit<RegistrationEventSummary, 'counts'>[]>;
  getEvent(eventId: string): Promise<Omit<RegistrationEventSummary, 'counts'> | null>;
  listRegistrations(eventIds: readonly string[]): Promise<RegistrationRow[]>;
  /** Players (not merged) whose name_normalized is one of `keys`. */
  findPlayers(keys: readonly string[]): Promise<Array<PlayerCandidate & { nameNormalized: string }>>;
  setSettings(actor: Actor, record: { enabled: boolean; paymentInstructions: string | null; upiId: string | null; payeeName: string | null }, reason: string): Promise<{ enabled: boolean; fields: string[] }>;
  setEventRegistration(actor: Actor, eventId: string, record: { open: boolean; entryFeePaise: number | null }, reason: string): Promise<{ id: string; fields: string[] }>;
  verifyPayment(actor: Actor, id: string, record: { amountPaise: number }, expectedRevision: number, reason: string): Promise<{ id: string; status: RegistrationStatus; revision: number }>;
  convert(
    actor: Actor,
    id: string,
    record: { players: Array<{ playerId: string } | { name: string; nameNormalized: string }>; status: 'pending' | 'confirmed' | 'waitlisted' },
    expectedRevision: number,
    reason: string,
  ): Promise<{ id: string; status: RegistrationStatus; entryId: string; newPlayerIds: string[]; revision: number }>;
  reject(actor: Actor, id: string, expectedRevision: number, reason: string): Promise<{ id: string; status: RegistrationStatus; revision: number }>;
}

// ----------------------------------------------------------------------------- the store methods the integrator adds to AdminStore

export type ConvertPlayerChoice = { playerId: string } | { newName: string };

export interface RegistrationAdminStore {
  registrationSettings(): Promise<StoreResult<RegistrationSettings>>;
  registrationEvents(): Promise<StoreResult<RegistrationEventSummary[]>>;
  registrationList(input: { eventId: string }): Promise<StoreResult<RegistrationEventDetail>>;
  registrationSaveSettings(actor: Actor, input: { enabled: boolean; paymentInstructions: string | null; upiId: string | null; payeeName: string | null; reason: string }): Promise<StoreResult<{ enabled: boolean; fields: string[] }>>;
  registrationSetEvent(actor: Actor, input: { eventId: string; open: boolean; entryFeePaise: number | null; reason: string }): Promise<StoreResult<{ id: string; fields: string[] }>>;
  registrationVerifyPayment(actor: Actor, input: { registrationId: string; amountPaise: number; expectedRevision: number; reason: string }): Promise<StoreResult<{ id: string; status: RegistrationStatus; revision: number }>>;
  registrationConvert(
    actor: Actor,
    input: { registrationId: string; players: ConvertPlayerChoice[]; status: 'pending' | 'confirmed' | 'waitlisted'; expectedRevision: number; reason: string },
  ): Promise<StoreResult<{ id: string; status: RegistrationStatus; entryId: string; newPlayerIds: string[]; revision: number }>>;
  registrationReject(actor: Actor, input: { registrationId: string; expectedRevision: number; reason: string }): Promise<StoreResult<{ id: string; status: RegistrationStatus; revision: number }>>;
}

export class RegistrationError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}
