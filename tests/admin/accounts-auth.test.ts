// The auth guard for the four roles (D-108, wave 4): aal2 for everyone, the role only from profiles (an ended account has none),
// organizers and scorers only while ORGANIZER_ACCOUNTS_ENABLED is exactly 'true' and only for their role's actions; the owner and
// editors exactly as before; the account actions owner only. Locally generated keys, fictional ids.
import { describe, expect, it } from 'vitest';
import {
  authorizeAdmin,
  authorizeEnrolCheck,
  authorizeEnrolCheckPlatform,
  authorizePlatform,
  isPlatformActionAllowed,
  type PlatformAuthDeps,
} from '../../src/lib/admin/auth';
import { ACCOUNT_ACTIONS, organizerAccountsEnabled, roleFromProfileRow } from '../../src/lib/admin/accounts/access';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { AUDIENCE, authDeps, EDITOR_ID, ISSUER, makeKeys, NOW, OWNER_ID, signToken, STRANGER_ID, type Keys } from './_helpers';

const ORG_ID = '9a000000-0000-4000-8000-0000000000a1';
const SCO_ID = '9a000000-0000-4000-8000-0000000000a2';
const ENDED_ID = '9a000000-0000-4000-8000-0000000000a3';

const rows: Record<string, { role: string; disabled_at: string | null }> = {
  [OWNER_ID]: { role: 'owner', disabled_at: null },
  [EDITOR_ID]: { role: 'editor', disabled_at: null },
  [ORG_ID]: { role: 'organizer', disabled_at: null },
  [SCO_ID]: { role: 'scorer', disabled_at: null },
  [ENDED_ID]: { role: 'organizer', disabled_at: '2026-10-21T10:00:00.000Z' },
};

function deps(k: Keys, over: Partial<PlatformAuthDeps> = {}): PlatformAuthDeps {
  return {
    jwt: { keys: k.publicKey, issuer: ISSUER, audience: AUDIENCE, now: () => NOW },
    roles: async (id) => roleFromProfileRow(rows[id]),
    editorsEnabled: false,
    organizerAccountsEnabled: true,
    ...over,
  };
}
const req = (t: string | null) => new Request('https://admin.example.test/api/admin/x', { method: 'POST', headers: t ? { authorization: `Bearer ${t}` } : {} });

describe('the switch and the profiles row', () => {
  it('ORGANIZER_ACCOUNTS_ENABLED is on only when exactly "true"', () => {
    expect(organizerAccountsEnabled('true')).toBe(true);
    for (const v of ['TRUE', 'True', ' true', 'true ', '1', 'yes', '', undefined, null, true]) expect(organizerAccountsEnabled(v), String(v)).toBe(false);
  });
  it('the role comes from the row; an ended account, a missing row or an unknown role has none', () => {
    expect(roleFromProfileRow({ role: 'owner', disabled_at: null })).toBe('owner');
    expect(roleFromProfileRow({ role: 'organizer', disabled_at: null })).toBe('organizer');
    expect(roleFromProfileRow({ role: 'scorer' })).toBe('scorer');
    expect(roleFromProfileRow({ role: 'scorer', disabled_at: '2026-10-21T10:00:00Z' })).toBeNull();
    expect(roleFromProfileRow({ role: 'player', disabled_at: null })).toBeNull();
    expect(roleFromProfileRow({ role: 'OWNER' })).toBeNull();
    expect(roleFromProfileRow(null)).toBeNull();
    expect(roleFromProfileRow(undefined)).toBeNull();
  });
});

describe('isPlatformActionAllowed', () => {
  const on = { editorsEnabled: false, organizerAccountsEnabled: true };
  it('the owner keeps every admin action and gets the account actions', () => {
    for (const a of [...Object.keys(ADMIN_ACTIONS), ...Object.keys(ACCOUNT_ACTIONS)]) expect(isPlatformActionAllowed('owner', a, on), a).toBe(true);
  });
  it('organizers and scorers: only their map, nothing while the switch is off, never an account action', () => {
    expect(isPlatformActionAllowed('organizer', 'competition.confirmResult', on)).toBe(true);
    expect(isPlatformActionAllowed('scorer', 'competition.recordResult', on)).toBe(true);
    expect(isPlatformActionAllowed('scorer', 'competition.confirmResult', on)).toBe(false);
    for (const role of ['organizer', 'scorer'] as const) {
      for (const a of Object.keys(ACCOUNT_ACTIONS)) expect(isPlatformActionAllowed(role, a, on), a).toBe(false);
      for (const a of ['dashboard', 'players.search', 'leads.list', 'payments.mark', 'settings.get', 'competition.rankings', 'competition.saveVenue', 'competition.approvePointsTable', 'site.publishNow', 'undo']) {
        expect(isPlatformActionAllowed(role, a, on), `${role} ${a}`).toBe(false);
      }
      for (const a of Object.keys(ADMIN_ACTIONS)) expect(isPlatformActionAllowed(role, a, { ...on, organizerAccountsEnabled: false }), a).toBe(false);
    }
  });
  it('editors stay off, and even when on cannot use the account actions', () => {
    expect(isPlatformActionAllowed('editor', 'dashboard', on)).toBe(false);
    for (const a of Object.keys(ACCOUNT_ACTIONS)) expect(isPlatformActionAllowed('editor', a, { ...on, editorsEnabled: true }), a).toBe(false);
    expect(isPlatformActionAllowed(null, 'dashboard', on)).toBe(false);
    expect(isPlatformActionAllowed('owner', 'no.such.action', on)).toBe(false);
  });
});

describe('authorizePlatform', () => {
  it('the owner passes exactly as with authorizeAdmin', async () => {
    const k = await makeKeys();
    const t = await signToken(k);
    expect(await authorizePlatform(req(t), 'players.merge', deps(k))).toEqual({ ok: true, actor: { userId: OWNER_ID, role: 'owner' } });
    expect(await authorizePlatform(req(t), 'accounts.invite', deps(k))).toEqual({ ok: true, actor: { userId: OWNER_ID, role: 'owner' } });
    expect(await authorizeAdmin(req(t), 'players.merge', authDeps(k))).toEqual({ ok: true, actor: { userId: OWNER_ID, role: 'owner' } });
  });
  it('an organizer passes for a competition action with aal2 and the switch on; a scorer only for recording', async () => {
    const k = await makeKeys();
    const org = await signToken(k, { sub: ORG_ID });
    const sco = await signToken(k, { sub: SCO_ID });
    expect(await authorizePlatform(req(org), 'competition.saveEvent', deps(k))).toEqual({ ok: true, actor: { userId: ORG_ID, role: 'organizer' } });
    expect(await authorizePlatform(req(sco), 'competition.recordResult', deps(k))).toEqual({ ok: true, actor: { userId: SCO_ID, role: 'scorer' } });
    expect(await authorizePlatform(req(sco), 'competition.confirmResult', deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizePlatform(req(org), 'accounts.list', deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizePlatform(req(org), 'dashboard', deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
  });
  it('aal1 is refused for every role, the switch off refuses organizers and scorers, an ended account is refused', async () => {
    const k = await makeKeys();
    for (const sub of [OWNER_ID, ORG_ID, SCO_ID]) {
      expect(await authorizePlatform(req(await signToken(k, { sub, aal: 'aal1' })), 'competition.event', deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    }
    expect(await authorizePlatform(req(await signToken(k, { sub: ORG_ID })), 'competition.event', deps(k, { organizerAccountsEnabled: false }))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizePlatform(req(await signToken(k, { sub: ENDED_ID })), 'competition.event', deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
  });
  it('the role never comes from token metadata; no token is 401; a failing lookup is 503', async () => {
    const k = await makeKeys();
    const claim = await signToken(k, { sub: STRANGER_ID, extra: { app_metadata: { role: 'organizer' }, user_metadata: { role: 'owner' } } });
    expect(await authorizePlatform(req(claim), 'competition.event', deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizePlatform(req(null), 'competition.event', deps(k))).toEqual({ ok: false, status: 401, code: 'unauthorized' });
    const failing = deps(k, { roles: async () => { throw new Error('down'); } });
    expect(await authorizePlatform(req(await signToken(k, { sub: ORG_ID })), 'competition.event', failing)).toEqual({ ok: false, status: 503, code: 'unavailable' });
  });
  it('the existing owner-only guard still refuses an organizer (today\'s behaviour until the integrator switches over)', async () => {
    const k = await makeKeys();
    const legacy = authDeps(k, { roles: async (id) => (rows[id]?.role === 'owner' ? 'owner' : null) });
    expect(await authorizeAdmin(req(await signToken(k, { sub: ORG_ID })), 'competition.event', legacy)).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizeEnrolCheck(req(await signToken(k, { sub: ORG_ID, aal: 'aal1' })), legacy)).toEqual({ ok: false, status: 403, code: 'forbidden' });
  });
});

describe('authorizeEnrolCheckPlatform (aal1: may a first code app be set up?)', () => {
  it('the owner, and an organizer or scorer only while the switch is on; never an editor or an ended account', async () => {
    const k = await makeKeys();
    const at = async (sub: string) => req(await signToken(k, { sub, aal: 'aal1' }));
    expect(await authorizeEnrolCheckPlatform(await at(OWNER_ID), deps(k, { organizerAccountsEnabled: false }))).toMatchObject({ ok: true });
    expect(await authorizeEnrolCheckPlatform(await at(ORG_ID), deps(k))).toEqual({ ok: true, actor: { userId: ORG_ID, role: 'organizer' } });
    expect(await authorizeEnrolCheckPlatform(await at(SCO_ID), deps(k))).toMatchObject({ ok: true });
    expect(await authorizeEnrolCheckPlatform(await at(ORG_ID), deps(k, { organizerAccountsEnabled: false }))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizeEnrolCheckPlatform(await at(EDITOR_ID), deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizeEnrolCheckPlatform(await at(ENDED_ID), deps(k))).toEqual({ ok: false, status: 403, code: 'forbidden' });
    expect(await authorizeEnrolCheckPlatform(req(null), deps(k))).toEqual({ ok: false, status: 401, code: 'unauthorized' });
  });
});
