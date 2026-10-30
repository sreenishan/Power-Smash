// The owner's Accounts actions over the memory backend and a fake invitation sender (no email is ever sent). Checks: the form rules,
// nothing is sent before every tournament is known, the email is never kept, plain-English refusals, an ended account is banned too
// (best effort), and the list. Fictional data only (example.test addresses, invented names).
import { describe, expect, it } from 'vitest';
import { createFakeInviteSender, createMemoryAccountsBackend, emptyAccountsState } from '../../src/lib/admin/accounts/memory-backend';
import { DISPLAY_NAME_MAX, accessSummary, displayNameProblem, emailProblem, tournamentsProblem, WARNINGS } from '../../src/lib/admin/accounts/rules';
import { ACCOUNT_SCHEMAS } from '../../src/lib/admin/accounts/schemas';
import { INVITE_MESSAGES, createAccountsService } from '../../src/lib/admin/accounts/service';
import { ACCOUNTS_STORE_METHODS, type InviteSender } from '../../src/lib/admin/accounts/types';
import type { StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const OWNER = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' as const };
const STRANGER = { userId: '9c000000-0000-4000-8000-000000000009', role: 'owner' as const };
const T1 = '9d000000-0000-4000-8000-000000000001';
const T2 = '9d000000-0000-4000-8000-000000000002';
const EMAIL = 'fake.organizer@example.test';
const R = 'fake reason';

function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code} ${JSON.stringify(r.errors ?? {})}`);
  return r.data;
}

function setup(opts: { invites?: InviteSender | null; enabled?: boolean } = {}) {
  let n = 0;
  const state = emptyAccountsState(OWNER.userId);
  const audit: { action: string; entityId: string; reason: string }[] = [];
  const backend = createMemoryAccountsBackend({
    state: () => state,
    tournaments: () => [{ id: T1, name: 'Demo Open Cup', startDate: '2026-11-02' }, { id: T2, name: 'Demo Other Cup', startDate: null }],
    audit: (_a, action, _e, entityId, reason) => audit.push({ action, entityId, reason }),
    now: () => NOW,
    newId: () => `9e000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  const fake = createFakeInviteSender(() => `9f000000-0000-4000-8000-${String(++n).padStart(12, '0')}`);
  const svc = createAccountsService(backend, { invites: opts.invites === undefined ? fake : opts.invites, organizerAccountsEnabled: opts.enabled ?? false, redirectTo: 'https://admin.example.test/admin/' });
  return { svc, state, audit, fake, backend };
}

const invite = { email: EMAIL, role: 'organizer' as const, displayName: 'Demo Kavya', tournamentIds: [T1], reason: R };

describe('the account rules (shared by the form, the server and the SQL)', () => {
  it('a name is 2 to 60 characters with no email and no phone number', () => {
    expect(displayNameProblem('Demo Kavya')).toBeNull();
    expect(displayNameProblem('K')).not.toBeNull();
    expect(displayNameProblem('x'.repeat(DISPLAY_NAME_MAX + 1))).not.toBeNull();
    expect(displayNameProblem('kavya@example.test')).toMatch(/email/);
    expect(displayNameProblem('Kavya 910000000000')).toMatch(/phone/);
    expect(displayNameProblem('Court 123456')).toBeNull(); // six digits is fine, seven is not (the SQL: fewer than 7)
    expect(displayNameProblem('Court 1234567')).not.toBeNull();
  });
  it('a light email check, and 1 to 50 distinct tournaments', () => {
    expect(emailProblem(EMAIL)).toBeNull();
    expect(emailProblem('')).not.toBeNull();
    expect(emailProblem('not an email')).not.toBeNull();
    expect(tournamentsProblem([])).not.toBeNull();
    expect(tournamentsProblem([T1, T1])).not.toBeNull();
    expect(tournamentsProblem([T1, T2])).toBeNull();
  });
  it('the zod schemas are strict', () => {
    expect(ACCOUNT_SCHEMAS['accounts.invite'].safeParse(invite).success).toBe(true);
    expect(ACCOUNT_SCHEMAS['accounts.invite'].safeParse({ ...invite, phone: '910000000000' }).success).toBe(false);
    expect(ACCOUNT_SCHEMAS['accounts.invite'].safeParse({ ...invite, role: 'owner' }).success).toBe(false);
    expect(ACCOUNT_SCHEMAS['accounts.invite'].safeParse({ ...invite, tournamentIds: ['nope'] }).success).toBe(false);
    expect(ACCOUNT_SCHEMAS['accounts.setAccess'].safeParse({ enabled: 'true', reason: R }).success).toBe(false);
    expect(ACCOUNT_SCHEMAS['accounts.disable'].safeParse({ profileId: T1, reason: 'x' }).success).toBe(false);
  });
  it('the switch summary names both switches in plain words', () => {
    expect(accessSummary(false, false)).toEqual({ tone: 'warn', text: WARNINGS.switchOff });
    expect(accessSummary(true, false)).toEqual({ tone: 'warn', text: WARNINGS.adminSwitchOff });
    expect(accessSummary(true, true)).toEqual({ tone: 'good', text: WARNINGS.switchOn });
  });
  it('every store method is listed', () => {
    const { svc } = setup();
    expect(Object.keys(svc).sort()).toEqual([...ACCOUNTS_STORE_METHODS].sort());
  });
});

describe('accountsInvite', () => {
  it('sends one invitation, records the account with its role and tournaments, and never keeps the email', async () => {
    const { svc, state, audit, fake } = setup();
    const r = ok(await svc.accountsInvite(OWNER, invite));
    expect(r).toMatchObject({ role: 'organizer', tournaments: 1 });
    expect(fake.sent).toBe(1);
    expect(state.accounts).toHaveLength(1);
    expect(state.assignments.map((a) => [a.tournamentId, a.role])).toEqual([[T1, 'organizer']]);
    expect(JSON.stringify(state)).not.toContain('example.test');
    expect(JSON.stringify(audit)).not.toContain('example.test');
    expect(JSON.stringify(audit)).not.toContain('Kavya');
    const list = ok(await svc.accountsList());
    expect(JSON.stringify(list)).not.toContain('example.test');
    expect(list.accounts[0]).toMatchObject({ displayName: 'Demo Kavya', role: 'organizer', status: 'active', tournaments: [{ tournamentId: T1, tournamentName: 'Demo Open Cup' }] });
  });
  it('refuses a bad form with field sentences and sends nothing', async () => {
    const { svc, fake } = setup();
    const r = await svc.accountsInvite(OWNER, { ...invite, email: 'nope', displayName: 'a@b', tournamentIds: [], reason: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors ?? {}).sort()).toEqual(['displayName', 'email', 'reason', 'tournamentIds']);
    expect(fake.sent).toBe(0);
  });
  it('an unknown tournament is refused BEFORE anything is sent', async () => {
    const { svc, fake } = setup();
    const r = await svc.accountsInvite(OWNER, { ...invite, tournamentIds: ['9d000000-0000-4000-8000-0000000000ff'] });
    expect(r).toMatchObject({ ok: false, code: 'INVALID' });
    expect(fake.sent).toBe(0);
  });
  it('no sender (preview, or no secret key) says so plainly', async () => {
    const { svc } = setup({ invites: null });
    expect(await svc.accountsInvite(OWNER, invite)).toEqual({ ok: false, code: 'INVALID', errors: { form: INVITE_MESSAGES.not_available } });
    expect(ok(await svc.accountsList()).canInvite).toBe(false);
  });
  it('a Supabase refusal becomes a plain sentence and nothing is saved', async () => {
    const failing = createFakeInviteSender(() => 'x', { fail: 'already_registered' });
    const { svc, state } = setup({ invites: failing });
    expect(await svc.accountsInvite(OWNER, invite)).toEqual({ ok: false, code: 'INVALID', errors: { email: INVITE_MESSAGES.already_registered } });
    expect(state.accounts).toEqual([]);
  });
  it('sent but not saved: the owner is told the person cannot do anything and what to do', async () => {
    const { svc, state } = setup();
    state.staff.push({ id: '9f000000-0000-4000-8000-000000000001', role: 'editor' }); // the id the fake sender hands out first
    expect(await svc.accountsInvite(OWNER, invite)).toEqual({ ok: false, code: 'INVALID', errors: { form: INVITE_MESSAGES.not_recorded } });
  });
  it('only the owner can invite (the backend refuses anyone else)', async () => {
    const { svc } = setup();
    expect(await svc.accountsInvite(STRANGER, invite)).toEqual({ ok: false, code: 'INVALID', errors: { form: INVITE_MESSAGES.not_recorded } });
  });
});

describe('assign, revoke, end and the switch', () => {
  it('assign and revoke with plain refusals', async () => {
    const { svc, state } = setup();
    const { id } = ok(await svc.accountsInvite(OWNER, invite));
    ok(await svc.accountsAssign(OWNER, { profileId: id, tournamentId: T2, reason: R }));
    expect(await svc.accountsAssign(OWNER, { profileId: id, tournamentId: T2, reason: R })).toEqual({ ok: false, code: 'INVALID', errors: { form: 'this person already has this tournament' } });
    const a = state.assignments.find((x) => x.tournamentId === T2)!;
    ok(await svc.accountsRevokeAssignment(OWNER, { assignmentId: a.id, reason: R }));
    expect((await svc.accountsRevokeAssignment(OWNER, { assignmentId: a.id, reason: R })).ok).toBe(false);
    expect((await svc.accountsRevokeAssignment(OWNER, { assignmentId: '9e000000-0000-4000-8000-0000000000ff', reason: R }))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(ok(await svc.accountsList()).accounts[0]!.tournaments.map((t) => t.tournamentId)).toEqual([T1]);
    expect(await svc.accountsAssign(OWNER, { profileId: id, tournamentId: T2, reason: '' })).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('ending an account revokes everything, asks Supabase to block the sign-in, and cannot be repeated', async () => {
    const { svc, fake, state } = setup();
    const { id } = ok(await svc.accountsInvite(OWNER, invite));
    const r = ok(await svc.accountsDisable(OWNER, { profileId: id, reason: R }));
    expect(r).toEqual({ id, disabled: true, assignmentsRevoked: 1, signInBlocked: true });
    expect(fake.banned).toEqual([id]);
    expect(state.assignments.every((a) => a.revokedAt !== null)).toBe(true);
    expect((await svc.accountsDisable(OWNER, { profileId: id, reason: R })).ok).toBe(false);
    const list = ok(await svc.accountsList());
    expect(list.accounts[0]).toMatchObject({ status: 'ended', tournaments: [] });
    expect(await svc.accountsAssign(OWNER, { profileId: id, tournamentId: T2, reason: R })).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('the switch: off by default, owner only, reported with the admin switch', async () => {
    const { svc } = setup({ enabled: true });
    expect(ok(await svc.accountsList())).toMatchObject({ databaseSwitchOn: false, adminSwitchOn: true, canInvite: true });
    expect(ok(await svc.accountsSetAccess(OWNER, { enabled: true, reason: R }))).toEqual({ enabled: true, changed: true });
    expect(ok(await svc.accountsList()).databaseSwitchOn).toBe(true);
    expect(await svc.accountsSetAccess(STRANGER, { enabled: false, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
  });
});
