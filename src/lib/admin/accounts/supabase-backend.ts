// AccountsBackend, the scope reader and the role lookup over Supabase PostgREST (the Vercel admin function only; secret key,
// service_role). Reads select explicit columns (never select *), paged; writes are only the owner RPCs of migration 0019, with the
// VERIFIED actor id as p_actor. Errors come from the store's `rpc`/`select` (a code, and for the database's own sentences the sentence).
import type { AccountRow, AccountTournamentRef, AccountsBackend, AssignmentRow, PlatformRole, ScopedRole } from './types';
import { roleFromProfileRow } from './access';
import type { ActiveAssignment, ScopeDeps } from './scoped-store';

export interface SupabaseAccountsDeps {
  select: <T>(table: string, query: string) => Promise<T[]>;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

export const ACCOUNT_COLUMNS = {
  profiles: 'id,role,display_name,created_at,disabled_at',
  organizer_assignments: 'id,profile_id,tournament_id,role,created_at,revoked_at',
  tournaments: 'id,name,start_date',
  competition_settings: 'organizer_roles_enabled',
} as const;

/** The 0019 RPC names (for the store's plain-sentence allow-list, like COMPETITION_DETAIL_RPCS). */
export const ACCOUNT_RPCS = ['admin_create_account', 'admin_assign_tournament', 'admin_revoke_assignment', 'admin_disable_account', 'admin_set_organizer_access'] as const;

const PAGE = 1000;
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProfileDb = { id: string; role: string; display_name: string | null; created_at: string; disabled_at: string | null };
type AssignmentDb = { id: string; profile_id: string; tournament_id: string; role: ScopedRole; created_at: string; revoked_at: string | null };

export function createSupabaseAccountsBackend(deps: SupabaseAccountsDeps): AccountsBackend {
  const { select, rpc } = deps;
  async function all<T>(table: string, query: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < 100 * PAGE; offset += PAGE) {
      const page = await select<T>(table, `${query}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }
  return {
    listAccounts: async () =>
      (await all<ProfileDb>('profiles', `select=${ACCOUNT_COLUMNS.profiles}&role=in.(organizer,scorer)&order=created_at.asc`)).map(
        (p): AccountRow => ({ id: p.id, role: p.role as ScopedRole, displayName: p.display_name ?? '', createdAt: p.created_at, disabledAt: p.disabled_at }),
      ),
    listAssignments: async (ids) => {
      const out: AssignmentRow[] = [];
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        const rows = await all<AssignmentDb>('organizer_assignments', `select=${ACCOUNT_COLUMNS.organizer_assignments}&profile_id=in.(${chunk.map(enc).join(',')})&order=created_at.asc`);
        out.push(...rows.map((a) => ({ id: a.id, profileId: a.profile_id, tournamentId: a.tournament_id, role: a.role, createdAt: a.created_at, revokedAt: a.revoked_at })));
      }
      return out;
    },
    listTournaments: async () =>
      (await all<{ id: string; name: string; start_date: string | null }>('tournaments', `select=${ACCOUNT_COLUMNS.tournaments}&status=eq.published&order=start_date.desc.nullslast`)).map(
        (t): AccountTournamentRef => ({ id: t.id, name: t.name, startDate: t.start_date }),
      ),
    getOrganizerAccess: async () => {
      const rows = await select<{ organizer_roles_enabled: boolean }>('competition_settings', `select=${ACCOUNT_COLUMNS.competition_settings}&id=eq.1&limit=1`);
      return rows[0]?.organizer_roles_enabled === true;
    },
    createAccount: (actor, userId, record, reason) =>
      rpc('admin_create_account', { p_actor: actor.userId, p_user: userId, p_record: { role: record.role, displayName: record.displayName, tournamentIds: record.tournamentIds }, p_reason: reason }),
    assignTournament: (actor, profileId, tournamentId, reason) => rpc('admin_assign_tournament', { p_actor: actor.userId, p_profile: profileId, p_tournament: tournamentId, p_reason: reason }),
    revokeAssignment: (actor, assignmentId, reason) => rpc('admin_revoke_assignment', { p_actor: actor.userId, p_assignment: assignmentId, p_reason: reason }),
    disableAccount: (actor, profileId, reason) => rpc('admin_disable_account', { p_actor: actor.userId, p_profile: profileId, p_reason: reason }),
    setOrganizerAccess: (actor, enabled, reason) => rpc('admin_set_organizer_access', { p_actor: actor.userId, p_enabled: enabled, p_reason: reason }),
  };
}

/**
 * The role from profiles (fail closed: no row, an unknown role or an ended account = null). Replaces the owner/editor-only lookup of
 * config.ts once the integrator wires accounts in.
 */
export function createSupabaseRoleLookup(deps: Pick<SupabaseAccountsDeps, 'select'>): (userId: string) => Promise<PlatformRole | null> {
  return async (userId) => {
    if (!UUID.test(userId)) return null;
    const rows = await deps.select<{ role?: unknown; disabled_at?: unknown }>('profiles', `select=role,disabled_at&id=eq.${enc(userId)}&limit=1`);
    return roleFromProfileRow(rows[0]);
  };
}

/**
 * The scope for one request, read fresh: the caller's active assignments (none when the account is ended or the database switch is
 * off, the same three conditions as app.require_competition_access) and the tournament of each competition record.
 */
export function createSupabaseScopeDeps(deps: Pick<SupabaseAccountsDeps, 'select'>): ScopeDeps {
  const { select } = deps;
  const one = async <T>(table: string, query: string): Promise<T | null> => (await select<T>(table, `${query}&limit=1`))[0] ?? null;
  const eventTournament = async (eventId: string | null | undefined): Promise<string | null> =>
    eventId ? ((await one<{ tournament_id: string }>('tournament_events', `select=tournament_id&id=eq.${enc(eventId)}`))?.tournament_id ?? null) : null;
  return {
    assignments: async (userId): Promise<ActiveAssignment[]> => {
      if (!UUID.test(userId)) return [];
      const [profile, settings] = await Promise.all([
        one<{ role?: unknown; disabled_at?: unknown }>('profiles', `select=role,disabled_at&id=eq.${enc(userId)}`),
        one<{ organizer_roles_enabled: boolean }>('competition_settings', 'select=organizer_roles_enabled&id=eq.1'),
      ]);
      const role = roleFromProfileRow(profile);
      if ((role !== 'organizer' && role !== 'scorer') || settings?.organizer_roles_enabled !== true) return [];
      const rows = await select<{ tournament_id: string; role: ScopedRole }>(
        'organizer_assignments',
        `select=tournament_id,role&profile_id=eq.${enc(userId)}&role=eq.${role}&revoked_at=is.null&limit=${PAGE}`,
      );
      return rows.map((r) => ({ tournamentId: r.tournament_id, role: r.role }));
    },
    resolver: {
      tournamentOf: async (kind, id) => {
        if (!UUID.test(id)) return null;
        if (kind === 'event') return eventTournament(id);
        if (kind === 'court') return (await one<{ tournament_id: string }>('courts', `select=tournament_id&id=eq.${enc(id)}`))?.tournament_id ?? null;
        if (kind === 'entry') return eventTournament((await one<{ event_id: string }>('event_entries', `select=event_id&id=eq.${enc(id)}`))?.event_id);
        if (kind === 'draw') return eventTournament((await one<{ event_id: string }>('draws', `select=event_id&id=eq.${enc(id)}`))?.event_id);
        if (kind === 'match') return eventTournament((await one<{ event_id: string }>('competition_matches', `select=event_id&id=eq.${enc(id)}`))?.event_id);
        return null;
      },
    },
  };
}
