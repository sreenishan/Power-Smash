// International events in the admin (D-112): the owner lists major international events by hand (name, level, dates, place and ONE
// official link on an allowed website), edits them, hides or shows them, and manages the extra allowed websites. Nothing is fetched
// from the linked sites. Public facts only: no contact data, no player names.
import type { Actor, StoreResult } from '../types';

/** A stored event as the owner sees it. */
export interface InternationalEventRow {
  id: string;
  name: string;
  levelText: string | null;
  /** YYYY-MM-DD, a calendar date read as India time (D-030). */
  startDate: string;
  endDate: string;
  city: string | null;
  country: string;
  officialUrl: string;
  published: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface InternationalEventDto extends InternationalEventRow {
  /** The website of the link, without "www.". */
  host: string;
  /** False when the owner has since removed the link's website from the list: the event is then not on the website even if shown. */
  onAllowList: boolean;
}

export interface InternationalSettingsDto {
  /** The fixed websites (D-112). */
  defaultHosts: string[];
  /** Websites the owner added. */
  extraHosts: string[];
}

export interface InternationalListDto {
  events: InternationalEventDto[];
  settings: InternationalSettingsDto;
}

export interface InternationalSaveInput {
  /** null = add a new event. */
  id: string | null;
  /** The revision the form was opened with (null for a new event). */
  expectedRevision: number | null;
  name: string;
  levelText: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  officialUrl: string;
  published: boolean;
  reason: string;
}

export interface InternationalSaveResult {
  id: string;
  created: boolean;
  revision: number;
  /** Names of the fields that changed (empty = nothing changed). */
  fields: string[];
  /** True when tracking parts (utm_ and similar) were removed from the link before saving. */
  removedTracking: boolean;
}

export interface InternationalSetPublishedInput {
  id: string;
  published: boolean;
  expectedRevision: number;
  reason: string;
}

export interface InternationalSetPublishedResult {
  id: string;
  published: boolean;
  revision: number;
  changed: boolean;
}

export interface InternationalSaveHostsInput {
  hosts: string[];
  reason: string;
}

export interface InternationalSaveHostsResult {
  hosts: string[];
  /** ['extra_hosts'] when the list changed, else []. */
  fields: string[];
  /** Shown events whose link is no longer on an allowed website (they drop off the website until the link is changed). */
  eventsOffList: number;
}

/** The store methods the integrator adds to AdminStore (memory, Supabase and HTTP stores). */
export interface InternationalAdminStore {
  internationalList(): Promise<StoreResult<InternationalListDto>>;
  internationalSave(actor: Actor, input: InternationalSaveInput): Promise<StoreResult<InternationalSaveResult>>;
  internationalSetPublished(actor: Actor, input: InternationalSetPublishedInput): Promise<StoreResult<InternationalSetPublishedResult>>;
  internationalSaveHosts(actor: Actor, input: InternationalSaveHostsInput): Promise<StoreResult<InternationalSaveHostsResult>>;
}

/** The record the owner RPC takes (p_record of public.admin_save_international_event): every key present. */
export interface InternationalDbRecord {
  name: string;
  levelText: string | null;
  startDate: string;
  endDate: string;
  city: string | null;
  country: string;
  officialUrl: string;
  published: boolean;
}

/** The data layer under the service: the memory backend (tests, preview) or Supabase (the owner RPCs of migration 0022). */
export interface InternationalBackend {
  listEvents(): Promise<InternationalEventRow[]>;
  getExtraHosts(): Promise<string[]>;
  saveEvent(actor: Actor, id: string | null, record: InternationalDbRecord, expectedRevision: number | null, reason: string): Promise<{ id: string; created: boolean; revision: number; fields: string[] }>;
  setPublished(actor: Actor, id: string, published: boolean, expectedRevision: number, reason: string): Promise<InternationalSetPublishedResult>;
  setHosts(actor: Actor, hosts: string[], reason: string): Promise<InternationalSaveHostsResult>;
}

export class InternationalError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}
