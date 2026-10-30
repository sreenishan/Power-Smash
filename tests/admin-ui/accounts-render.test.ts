// Server render of the owner's Accounts screen and the invited person's password screen (D-108), with the memory accounts service
// and a fake sender (no email is sent). Checks: the plain warnings, labelled fields, the switch state, every irreversible step behind
// a confirmation, and the pure form helpers. Fictional data only.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminContext, type AdminCtx } from '../../src/admin/ui';
import { Accounts, AccountsBody } from '../../src/admin/screens/accounts/Accounts';
import { ACCEPT_MESSAGES, AcceptInvite } from '../../src/admin/screens/accounts/AcceptInvite';
import { EMPTY_INVITE, accountsApiOf, assignableTournaments, inviteProblems, statusLabel, tournamentLabel } from '../../src/admin/screens/accounts/logic';
import { createFakeInviteSender, createMemoryAccountsBackend, emptyAccountsState } from '../../src/lib/admin/accounts/memory-backend';
import { ROLE_EXPLAIN, WARNINGS } from '../../src/lib/admin/accounts/rules';
import { createAccountsService } from '../../src/lib/admin/accounts/service';
import type { AccountDto } from '../../src/lib/admin/accounts/types';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import type { StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const OWNER = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' as const };
const T1 = '9d000000-0000-4000-8000-000000000001';
const T2 = '9d000000-0000-4000-8000-000000000002';

function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.data;
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function setup(invites = true, bareClient = false) {
  let n = 0;
  const state = emptyAccountsState(OWNER.userId);
  const backend = createMemoryAccountsBackend({
    state: () => state,
    tournaments: () => [{ id: T1, name: 'Demo Open Cup', startDate: '2026-11-02' }, { id: T2, name: 'Demo Other Cup', startDate: null }],
    audit: () => undefined,
    now: () => NOW,
    newId: () => `9e000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  const api = createAccountsService(backend, { invites: invites ? createFakeInviteSender(() => `9f000000-0000-4000-8000-${String(++n).padStart(12, '0')}`) : null, organizerAccountsEnabled: false });
  // since the integration the memory store carries the account methods; a bare client stands for an admin app without them
  const client = bareClient ? ({} as unknown as MemoryAdminStore) : new MemoryAdminStore({ now: () => NOW });
  const ctx: AdminCtx = { client, actor: OWNER, mode: 'preview', notify: () => undefined, check: ((r: StoreResult<unknown>) => r.ok) as AdminCtx['check'], signOut: () => undefined, version: 0, bump: () => undefined };
  const render = (el: ReactElement) => renderToStaticMarkup(createElement(AdminContext.Provider, { value: ctx }, el));
  return { api, render, state };
}

describe('the Accounts screen (owner)', () => {
  it('with no accounts: both switches explained, the invite form labelled, roles explained, nothing open', async () => {
    const { api, render } = setup();
    const html = render(createElement(AccountsBody, { api, data: ok(await api.accountsList()) }));
    const t = text(html);
    expect(t).toContain(WARNINGS.switchOff);
    expect(t).toContain('Turn access on');
    expect(t).toContain('Invite someone');
    expect(t).toContain(WARNINGS.invite);
    expect(t).toContain(ROLE_EXPLAIN.organizer);
    expect(t).toContain(ROLE_EXPLAIN.scorer);
    expect(t).toContain('Demo Open Cup');
    expect(t).toContain('No organizers or scorers yet.');
    for (const id of ['acc-email', 'acc-name', 'acc-invite-reason']) expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"`));
    expect(html).not.toContain('role="alertdialog"');
    expect(t).not.toMatch(/TODO\(owner\)/);
  });

  it('lists an account with its tournaments, a take-away button per tournament, and an end button', async () => {
    const { api, render } = setup();
    ok(await api.accountsInvite(OWNER, { email: 'fake.scorer@example.test', role: 'scorer', displayName: 'Demo Arun', tournamentIds: [T1], reason: 'demo reason' }));
    ok(await api.accountsSetAccess(OWNER, { enabled: true, reason: 'demo reason' }));
    const html = render(createElement(AccountsBody, { api, data: ok(await api.accountsList()) }));
    const t = text(html);
    expect(t).toContain('Demo Arun');
    expect(t).toContain('Scorer');
    expect(t).toContain('Take away Demo Open Cup');
    expect(t).toContain('End this account');
    expect(t).toContain('Give another tournament');
    expect(t).toContain(WARNINGS.adminSwitchOff);
    expect(t).toContain('Turn access off');
    // the email never reaches the screen
    expect(html).not.toContain('example.test');
  });

  it('no sender: the screen says invitations cannot be sent and the button is disabled', async () => {
    const { api, render } = setup(false);
    const html = render(createElement(AccountsBody, { api, data: ok(await api.accountsList()) }));
    expect(text(html)).toContain('Invitations cannot be sent from here yet');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send the invitation<\/button>/);
  });

  it('a client without the account methods shows a plain note instead of failing; the wired memory store has them', () => {
    expect(accountsApiOf(new MemoryAdminStore({ now: () => NOW }))).not.toBeNull();
    const { render } = setup(true, true);
    expect(text(render(createElement(Accounts, {})))).toContain('The Accounts screen is not connected yet.');
    expect(accountsApiOf(null)).toBeNull();
    expect(accountsApiOf({})).toBeNull();
  });
});

describe('the Accounts form helpers', () => {
  it('the invite form check uses the shared rules', () => {
    expect(Object.keys(inviteProblems(EMPTY_INVITE)).sort()).toEqual(['displayName', 'email', 'reason', 'role', 'tournamentIds']);
    expect(inviteProblems({ email: 'fake@example.test', displayName: 'Demo Arun', role: 'scorer', tournamentIds: [T1], reason: 'demo reason' })).toEqual({});
  });
  it('labels and the tournaments still free to give', () => {
    const a: AccountDto = { id: 'a', role: 'organizer', displayName: 'Demo', status: 'active', createdAt: NOW.toISOString(), endedAt: null, tournaments: [{ assignmentId: 'x', tournamentId: T1, tournamentName: 'Demo Open Cup' }] };
    const all = [{ id: T1, name: 'Demo Open Cup', startDate: '2026-11-02' }, { id: T2, name: 'Demo Other Cup', startDate: null }];
    expect(assignableTournaments(a, all).map((t) => t.id)).toEqual([T2]);
    expect(assignableTournaments({ ...a, status: 'ended' }, all)).toEqual([]);
    expect(statusLabel(a)).toBe('Active');
    expect(statusLabel({ ...a, tournaments: [] })).toBe('Active, no tournaments');
    expect(statusLabel({ ...a, status: 'ended', endedAt: '2026-10-21T20:00:00.000Z' })).toBe('Ended 22 October 2026'); // IST date
    expect(tournamentLabel(all[0]!)).toBe('Demo Open Cup (2 November 2026)');
    expect(tournamentLabel(all[1]!)).toBe('Demo Other Cup');
  });
});

describe('the invited person\'s password screen', () => {
  it('renders a labelled two-box form with the welcome text and no admin context', () => {
    const html = renderToStaticMarkup(createElement(AcceptInvite, { setPassword: async () => ({ ok: true as const, value: true as const }), onDone: () => undefined }));
    expect(text(html)).toContain(ACCEPT_MESSAGES.intro);
    expect(html).toMatch(/<label[^>]*for="inv-pw"/);
    expect(html).toMatch(/<label[^>]*for="inv-pw2"/);
    expect(html).toMatch(/autocomplete="new-password"/i);
  });
});
