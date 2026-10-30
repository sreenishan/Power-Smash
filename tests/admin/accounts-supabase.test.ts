// The Supabase side of accounts, with a fake fetch/select/rpc (no network): the RPC names and arguments of 0019 with the VERIFIED actor
// id, explicit columns, the role lookup (an ended account has no role), the per-request scope reads, and the Supabase Auth calls
// (admin invite with the secret key, ban, the invitation link, the new password). Fictional ids, example.test addresses, fake keys
// built at run time.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_COLUMNS, ACCOUNT_RPCS, createSupabaseAccountsBackend, createSupabaseRoleLookup, createSupabaseScopeDeps } from '../../src/lib/admin/accounts/supabase-backend';
import { BAN_DURATION, createGoTrueAdmin, parseInviteRedirect, passwordProblem, setInvitedPassword } from '../../src/lib/admin/gotrue';
import { readFileSync } from 'node:fs';

const OWNER = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' as const };
const U = '9c000000-0000-4000-8000-0000000000a1';
const T1 = '9d000000-0000-4000-8000-000000000001';
const SECRET = ['sb', 'secret', 'FAKE', 'accounts'].join('_');
const PUB = ['sb', 'publishable', 'FAKE'].join('_');

function recorder(rows: Record<string, unknown[]> = {}) {
  const selects: { table: string; query: string }[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  return {
    selects,
    rpcs,
    deps: {
      select: async <T>(table: string, query: string): Promise<T[]> => {
        selects.push({ table, query });
        return (rows[table] ?? []) as T[];
      },
      rpc: async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
        rpcs.push({ name, args });
        return { id: 'x' } as T;
      },
    },
  };
}

describe('createSupabaseAccountsBackend', () => {
  it('writes only through the 0019 RPCs with the verified actor id', async () => {
    const r = recorder();
    const b = createSupabaseAccountsBackend(r.deps);
    await b.createAccount(OWNER, U, { role: 'scorer', displayName: 'Demo Arun', tournamentIds: [T1] }, 'why');
    await b.assignTournament(OWNER, U, T1, 'why');
    await b.revokeAssignment(OWNER, T1, 'why');
    await b.disableAccount(OWNER, U, 'why');
    await b.setOrganizerAccess(OWNER, true, 'why');
    expect(r.rpcs.map((x) => x.name)).toEqual([...ACCOUNT_RPCS]);
    expect(r.rpcs.every((x) => x.args['p_actor'] === OWNER.userId)).toBe(true);
    expect(r.rpcs[0]!.args).toEqual({ p_actor: OWNER.userId, p_user: U, p_record: { role: 'scorer', displayName: 'Demo Arun', tournamentIds: [T1] }, p_reason: 'why' });
    expect(r.rpcs[4]!.args).toEqual({ p_actor: OWNER.userId, p_enabled: true, p_reason: 'why' });
    // the RPC names exist in the migration
    const sql = readFileSync('supabase/migrations/0019_competition_accounts.sql', 'utf8');
    for (const name of ACCOUNT_RPCS) expect(sql).toContain(`create or replace function public.${name}(`);
  });
  it('reads explicit columns, never select *, and only organizer and scorer rows', async () => {
    const r = recorder({ profiles: [{ id: U, role: 'scorer', display_name: 'Demo Arun', created_at: '2026-10-22T10:00:00Z', disabled_at: null }], competition_settings: [{ organizer_roles_enabled: true }] });
    const b = createSupabaseAccountsBackend(r.deps);
    expect(await b.listAccounts()).toEqual([{ id: U, role: 'scorer', displayName: 'Demo Arun', createdAt: '2026-10-22T10:00:00Z', disabledAt: null }]);
    await b.listAssignments([U]);
    await b.listTournaments();
    expect(await b.getOrganizerAccess()).toBe(true);
    for (const s of r.selects) expect(s.query).not.toMatch(/select=\*/);
    expect(r.selects[0]!.query).toContain(`select=${ACCOUNT_COLUMNS.profiles}&role=in.(organizer,scorer)`);
    expect(r.selects.some((s) => s.table === 'organizer_assignments' && s.query.includes(`profile_id=in.(${U})`))).toBe(true);
    // no email column anywhere
    expect(JSON.stringify(ACCOUNT_COLUMNS)).not.toMatch(/email|phone/);
  });
});

describe('role lookup and per-request scope', () => {
  it('an ended account and an unknown role get no role; a bad id is not even asked', async () => {
    const lookup = (row: unknown) => createSupabaseRoleLookup(recorder({ profiles: row ? [row] : [] }).deps);
    expect(await lookup({ role: 'organizer', disabled_at: null })(U)).toBe('organizer');
    expect(await lookup({ role: 'organizer', disabled_at: '2026-10-22T10:00:00Z' })(U)).toBeNull();
    expect(await lookup({ role: 'player', disabled_at: null })(U)).toBeNull();
    expect(await lookup(null)(U)).toBeNull();
    const r = recorder();
    expect(await createSupabaseRoleLookup(r.deps)('not-a-uuid')).toBeNull();
    expect(r.selects).toEqual([]);
  });
  it('assignments: only active rows of the account\'s role, and none while the switch is off or the account ended', async () => {
    const on = recorder({ profiles: [{ role: 'scorer', disabled_at: null }], competition_settings: [{ organizer_roles_enabled: true }], organizer_assignments: [{ tournament_id: T1, role: 'scorer' }] });
    expect(await createSupabaseScopeDeps(on.deps).assignments(U)).toEqual([{ tournamentId: T1, role: 'scorer' }]);
    const q = on.selects.find((s) => s.table === 'organizer_assignments')!.query;
    expect(q).toContain('revoked_at=is.null');
    expect(q).toContain('role=eq.scorer');
    const off = recorder({ profiles: [{ role: 'scorer', disabled_at: null }], competition_settings: [{ organizer_roles_enabled: false }], organizer_assignments: [{ tournament_id: T1, role: 'scorer' }] });
    expect(await createSupabaseScopeDeps(off.deps).assignments(U)).toEqual([]);
    const ended = recorder({ profiles: [{ role: 'scorer', disabled_at: '2026-10-22T10:00:00Z' }], competition_settings: [{ organizer_roles_enabled: true }], organizer_assignments: [{ tournament_id: T1, role: 'scorer' }] });
    expect(await createSupabaseScopeDeps(ended.deps).assignments(U)).toEqual([]);
    const owner = recorder({ profiles: [{ role: 'owner', disabled_at: null }], competition_settings: [{ organizer_roles_enabled: true }] });
    expect(await createSupabaseScopeDeps(owner.deps).assignments(U)).toEqual([]);
  });
  it('the resolver walks entry, draw and match to the event, then the tournament', async () => {
    const r = recorder({ event_entries: [{ event_id: 'e1' }], draws: [{ event_id: 'e1' }], competition_matches: [{ event_id: 'e1' }], tournament_events: [{ tournament_id: T1 }], courts: [{ tournament_id: T1 }] });
    const res = createSupabaseScopeDeps(r.deps).resolver;
    for (const kind of ['event', 'entry', 'draw', 'match', 'court'] as const) expect(await res.tournamentOf(kind, U), kind).toBe(T1);
    expect(await res.tournamentOf('event', 'nope')).toBeNull();
    const empty = createSupabaseScopeDeps(recorder().deps).resolver;
    expect(await empty.tournamentOf('match', U)).toBeNull();
  });
});

describe('Supabase Auth: the admin invitation (server only) and accepting it', () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  it('invite: POST /invite with the secret key, the redirect as a query, the email only in the body; answers the user id', async () => {
    const { f, calls } = fakeFetch(200, { id: U.toUpperCase(), email: 'fake.organizer@example.test' });
    const admin = createGoTrueAdmin({ url: 'https://fakeref.supabase.co/', secretKey: SECRET, fetch: f });
    expect(await admin.invite('fake.organizer@example.test', { redirectTo: 'https://admin.example.test/admin/' })).toEqual({ ok: true, userId: U });
    expect(calls[0]!.url).toBe('https://fakeref.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2Fadmin.example.test%2Fadmin%2F');
    expect(calls[0]!.url).not.toContain('example.test%2Fadmin%2F&');
    expect(calls[0]!.url).not.toContain('fake.organizer');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'fake.organizer@example.test' });
  });
  it('invite failures map to our codes and never pass the text on', async () => {
    const cases: [number, unknown, string][] = [
      [422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, 'already_registered'],
      [422, { msg: 'Unable to validate email address: invalid format' }, 'invalid_email'],
      [429, {}, 'rate_limited'],
      [500, { msg: 'boom' }, 'unexpected'],
      [200, { id: 'not-a-uuid' }, 'unexpected'],
    ];
    for (const [status, body, code] of cases) {
      const admin = createGoTrueAdmin({ url: 'https://fakeref.supabase.co', secretKey: SECRET, fetch: fakeFetch(status, body).f });
      expect(await admin.invite('fake@example.test'), code).toEqual({ ok: false, code });
    }
    const down = createGoTrueAdmin({ url: 'https://fakeref.supabase.co', secretKey: SECRET, fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(await down.invite('fake@example.test')).toEqual({ ok: false, code: 'network' });
  });
  it('ban: PUT the admin user with a long ban, never a delete', async () => {
    const { f, calls } = fakeFetch(200, {});
    const admin = createGoTrueAdmin({ url: 'https://fakeref.supabase.co', secretKey: SECRET, fetch: f });
    expect(await admin.ban(U)).toBe(true);
    expect(calls[0]!.url).toBe(`https://fakeref.supabase.co/auth/v1/admin/users/${U}`);
    expect(calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ban_duration: BAN_DURATION });
    expect(await admin.ban('nope')).toBe(false);
  });
  it('the invitation link: only type=invite with both tokens is accepted', () => {
    expect(parseInviteRedirect('#access_token=abc.def.ghi&refresh_token=r1&expires_in=3600&token_type=bearer&type=invite')).toEqual({ accessToken: 'abc.def.ghi', refreshToken: 'r1', expiresIn: 3600 });
    expect(parseInviteRedirect('#access_token=abc&refresh_token=r1&expires_in=3600&type=recovery')).toBeNull();
    expect(parseInviteRedirect('#access_token=abc&expires_in=3600&type=invite')).toBeNull();
    expect(parseInviteRedirect('#error=access_denied&error_code=otp_expired')).toBeNull();
    expect(parseInviteRedirect('')).toBeNull();
    expect(parseInviteRedirect('#access_token=a b&refresh_token=r&expires_in=1&type=invite')).toBeNull();
  });
  it('the new password: at least 12 characters; PUT /user with the publishable key and the invitation token', async () => {
    expect(passwordProblem('short')).not.toBeNull();
    expect(passwordProblem(' padded-password ')).not.toBeNull();
    expect(passwordProblem('correct horse battery')).toBeNull();
    const { f, calls } = fakeFetch(200, { id: U });
    expect(await setInvitedPassword({ url: 'https://fakeref.supabase.co', publishableKey: PUB, fetch: f }, 'abc.def.ghi', 'correct horse battery')).toEqual({ ok: true, value: true });
    expect(calls[0]!.url).toBe('https://fakeref.supabase.co/auth/v1/user');
    expect(calls[0]!.init.method).toBe('PUT');
    expect((calls[0]!.init.headers as Record<string, string>)['apikey']).toBe(PUB);
    expect(await setInvitedPassword({ url: 'https://fakeref.supabase.co', publishableKey: PUB, fetch: fakeFetch(401, {}).f }, 'abc', 'correct horse battery')).toEqual({ ok: false, code: 'invalid_credentials' });
    expect(await setInvitedPassword({ url: 'https://fakeref.supabase.co', publishableKey: PUB, fetch: f }, 'abc', 'short')).toEqual({ ok: false, code: 'invalid_credentials' });
  });
});
