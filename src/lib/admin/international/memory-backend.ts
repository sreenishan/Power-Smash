// In-memory InternationalBackend for tests and the no-backend admin preview, with a FICTIONAL seed (invented event names; links to the
// home pages of the allowed official sites only). It mirrors the rules of the 0022 RPCs so the service and the screen behave the same
// as on Supabase: owner only, a reason for every change, revisions (STALE), the link checked against the allow-list (defaults plus the
// owner's hosts), showing an event re-checks its link, the host list refuses a default, a repeat or a bad name. No delete: hide only.
import { DEFAULT_ALLOWED_HOSTS, MAX_EXTRA_HOSTS, allowedHosts, hostProblem, storedLinkProblem } from '../../international/link-rules';
import type { Actor } from '../types';
import { InternationalError, type InternationalBackend, type InternationalDbRecord, type InternationalEventRow } from './types';

export interface MemoryInternationalData {
  events: InternationalEventRow[];
  extraHosts: string[];
}

export interface MemoryInternationalAudit {
  actor: string;
  action: 'create_international_event' | 'update_international_event' | 'set_international_event_published' | 'set_international_hosts';
  entityId: string;
  /** Field names, counts and flags only (never a value). */
  diff: Record<string, unknown>;
  reason: string;
}

/** FICTIONAL seed: two shown events and one hidden one. */
export function seedInternationalData(): MemoryInternationalData {
  const at = '2026-10-30T05:00:00.000Z';
  const row = (n: number, rec: Omit<InternationalEventRow, 'id' | 'revision' | 'createdAt' | 'updatedAt'>): InternationalEventRow => ({
    id: `b1000000-0000-4000-8000-00000000000${n}`,
    ...rec,
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  return {
    events: [
      row(1, { name: 'Sample World Open 2026', levelText: 'Sample level 1000', startDate: '2026-11-17', endDate: '2026-11-22', city: 'Sample City', country: 'Demo Country', officialUrl: 'https://bwfbadminton.com/', published: true }),
      row(2, { name: 'Demo Masters 2026', levelText: null, startDate: '2026-12-08', endDate: '2026-12-13', city: null, country: 'Mock Land', officialUrl: 'https://www.tournamentsoftware.com/', published: true }),
      row(3, { name: 'Mock Team Cup 2026', levelText: 'Sample team event', startDate: '2026-10-01', endDate: '2026-10-05', city: 'Mock Town', country: 'Demo Country', officialUrl: 'https://bwf.tournamentsoftware.com/', published: false }),
    ],
    extraHosts: [],
  };
}

const RECORD_FIELDS: Array<keyof InternationalDbRecord> = ['name', 'levelText', 'startDate', 'endDate', 'city', 'country', 'officialUrl', 'published'];
const SNAKE: Record<keyof InternationalDbRecord, string> = {
  name: 'name', levelText: 'level_text', startDate: 'start_date', endDate: 'end_date', city: 'city', country: 'country', officialUrl: 'official_url', published: 'published',
};

export interface MemoryInternationalOptions {
  data?: MemoryInternationalData;
  /** Ids of owners (the actor must be one). Default: any actor whose role is 'owner'. */
  isOwner?: (actor: Actor) => boolean;
  audit?: (entry: MemoryInternationalAudit) => void;
  now?: () => Date;
  newId?: () => string;
}

export function createMemoryInternationalBackend(opts: MemoryInternationalOptions = {}): InternationalBackend & { data: MemoryInternationalData } {
  const data = opts.data ?? seedInternationalData();
  const isOwner = opts.isOwner ?? ((a: Actor) => a.role === 'owner');
  const now = opts.now ?? (() => new Date());
  let n = 0;
  const newId = opts.newId ?? (() => `b2000000-0000-4000-8000-${String(++n).padStart(12, '0')}`);
  const audit = opts.audit ?? (() => undefined);

  const requireOwner = (a: Actor) => {
    if (!isOwner(a)) throw new InternationalError('FORBIDDEN');
  };
  const requireReason = (r: string) => {
    if (r.trim() === '') throw new InternationalError('INVALID', 'A change needs a reason.');
  };
  const checkRecord = (rec: InternationalDbRecord) => {
    const p = storedLinkProblem(rec.officialUrl, allowedHosts(data.extraHosts));
    if (p) throw new InternationalError('INVALID', `${p.charAt(0).toUpperCase()}${p.slice(1)}.`);
    if (rec.endDate < rec.startDate) throw new InternationalError('INVALID', 'The last day cannot be before the first day.');
  };

  return {
    data,
    listEvents: async () => data.events.map((e) => ({ ...e })),
    getExtraHosts: async () => [...data.extraHosts],

    saveEvent: async (actor, id, record, expectedRevision, reason) => {
      requireOwner(actor);
      requireReason(reason);
      checkRecord(record);
      const at = now().toISOString();
      if (id === null) {
        if (expectedRevision !== null) throw new InternationalError('INVALID', 'A new event has no revision.');
        const row: InternationalEventRow = { id: newId(), ...record, revision: 1, createdAt: at, updatedAt: at };
        data.events.push(row);
        audit({ actor: actor.userId, action: 'create_international_event', entityId: row.id, diff: { fields: RECORD_FIELDS.map((f) => SNAKE[f]), published: row.published }, reason });
        return { id: row.id, created: true, revision: 1, fields: RECORD_FIELDS.map((f) => SNAKE[f]) };
      }
      const row = data.events.find((e) => e.id === id);
      if (!row) throw new InternationalError('NOT_FOUND', 'This event was not found.');
      if (row.revision !== expectedRevision) throw new InternationalError('STALE', 'The event changed since the form was opened.');
      const fields = RECORD_FIELDS.filter((f) => row[f] !== record[f]).map((f) => SNAKE[f]);
      if (fields.length === 0) return { id: row.id, created: false, revision: row.revision, fields: [] };
      Object.assign(row, record, { revision: row.revision + 1, updatedAt: at });
      audit({ actor: actor.userId, action: 'update_international_event', entityId: row.id, diff: { fields, published: row.published }, reason });
      return { id: row.id, created: false, revision: row.revision, fields };
    },

    setPublished: async (actor, id, published, expectedRevision, reason) => {
      requireOwner(actor);
      requireReason(reason);
      const row = data.events.find((e) => e.id === id);
      if (!row) throw new InternationalError('NOT_FOUND', 'This event was not found.');
      if (row.revision !== expectedRevision) throw new InternationalError('STALE', 'The event changed since the list was opened.');
      if (row.published === published) return { id, published, revision: row.revision, changed: false };
      if (published && storedLinkProblem(row.officialUrl, allowedHosts(data.extraHosts)) !== null) {
        throw new InternationalError('INVALID', 'The official link is not on an allowed website any more. Edit the link first.');
      }
      row.published = published;
      row.revision += 1;
      row.updatedAt = now().toISOString();
      audit({ actor: actor.userId, action: 'set_international_event_published', entityId: id, diff: { fields: ['published'], published }, reason });
      return { id, published, revision: row.revision, changed: true };
    },

    setHosts: async (actor, hosts, reason) => {
      requireOwner(actor);
      requireReason(reason);
      if (hosts.length > MAX_EXTRA_HOSTS) throw new InternationalError('INVALID', `Add at most ${MAX_EXTRA_HOSTS} websites.`);
      for (const h of hosts) {
        const p = hostProblem(h);
        if (p) throw new InternationalError('INVALID', p);
        if ((DEFAULT_ALLOWED_HOSTS as readonly string[]).includes(h)) throw new InternationalError('INVALID', `${h} is always allowed; leave it out.`);
      }
      if (new Set(hosts).size !== hosts.length) throw new InternationalError('INVALID', 'A website is listed twice.');
      const next = [...hosts].sort();
      const changed = next.join(',') !== [...data.extraHosts].sort().join(',');
      const before = new Set(data.extraHosts);
      if (changed) {
        data.extraHosts = next;
        audit({
          actor: actor.userId,
          action: 'set_international_hosts',
          entityId: '1',
          diff: { fields: ['extra_hosts'], count: next.length, added: next.filter((h) => !before.has(h)).length, removed: [...before].filter((h) => !next.includes(h)).length },
          reason,
        });
      }
      const all = allowedHosts(next);
      const eventsOffList = data.events.filter((e) => e.published && storedLinkProblem(e.officialUrl, all) !== null).length;
      return { hosts: next, fields: changed ? ['extra_hosts'] : [], eventsOffList };
    },
  };
}
