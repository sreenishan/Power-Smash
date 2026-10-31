// The owner's Accounts screen (D-108): invite an organizer or scorer by email with their tournaments, list the accounts, take a
// tournament away, end an account, and the database switch for organizer and scorer access. Owner only (the server refuses everyone
// else). The email address goes to Supabase Auth, which sends its own invitation email; Power Smash keeps only the name the owner
// gives, the role and the tournaments. Plain English, 44 px targets, inline confirmations, no raw HTML.
import { useState } from 'react';
import { ROLE_EXPLAIN, WARNINGS, accessSummary } from '../../../lib/admin/accounts/rules';
import type { AccountDto, AccountTournamentRef, AccountsOverview, AccountsStore, ScopedRole } from '../../../lib/admin/accounts/types';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, cx, inputCls, useAdmin, useAsync } from '../../ui';
import { ErrorText, H2, Input, Note, ReasonField, useAction } from '../competition/shared';
import { EMPTY_INVITE, accountsApiOf, assignableTournaments, inviteProblems, roleLabel, statusLabel, tournamentLabel, type InviteForm } from './logic';

export function Accounts(props: { api?: AccountsStore }) {
  const { client } = useAdmin();
  const api = props.api ?? accountsApiOf(client);
  if (!api) return <Note tone="warn">The Accounts screen is not connected yet. Nothing here works until the next admin update.</Note>;
  return <AccountsWith api={api} />;
}

function AccountsWith({ api }: { api: AccountsStore }) {
  const q = useAsync(() => api.accountsList(), []);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Give an organizer or a scorer access to the tournaments you choose. They can only work on those tournaments, and only in Competitions.</p>
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {q.data ? <AccountsBody api={api} data={q.data} /> : null}
      </LoadState>
    </div>
  );
}

export function AccountsBody({ api, data }: { api: AccountsStore; data: AccountsOverview }) {
  const summary = accessSummary(data.databaseSwitchOn, data.adminSwitchOn);
  return (
    <>
      <Note tone={summary.tone === 'good' ? 'info' : 'warn'}>{summary.text}</Note>
      <AccessSwitch api={api} on={data.databaseSwitchOn} />
      <InviteSection api={api} data={data} />
      <section aria-labelledby="acc-list" className="flex flex-col gap-3">
        <H2 id="acc-list">People with access</H2>
        {data.accounts.length === 0 ? <Empty>No organizers or scorers yet.</Empty> : data.accounts.map((a) => <AccountCard key={a.id} api={api} a={a} tournaments={data.tournaments} />)}
      </section>
    </>
  );
}

function AccessSwitch({ api, on }: { api: AccountsStore; on: boolean }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const go = async () => {
    const r = await act.run(() => api.accountsSetAccess(actor, { enabled: !on, reason }));
    if (r) {
      setAsking(false);
      setReason('');
      notify(r.enabled ? 'Organizer and scorer access is on.' : 'Organizer and scorer access is off.');
      bump();
    }
  };
  return (
    <section aria-labelledby="acc-switch" className={cardCls}>
      <H2 id="acc-switch">Organizer and scorer access</H2>
      <p className="mt-1">
        Now: <Badge tone={on ? 'good' : 'warn'}>{on ? 'On' : 'Off'}</Badge>
      </p>
      {!asking ? (
        <div className="mt-3">
          <Button variant={on ? 'danger' : 'primary'} onClick={() => setAsking(true)}>{on ? 'Turn access off' : 'Turn access on'}</Button>
        </div>
      ) : (
        <Confirm
          title={on ? 'Turn organizer and scorer access off?' : 'Turn organizer and scorer access on?'}
          body={on ? 'Every organizer and scorer loses access straight away. Their accounts and tournaments stay, ready for when you turn it on again.' : 'The people listed below can then work on their tournaments (once ORGANIZER_ACCOUNTS_ENABLED is also true on Vercel).'}
          confirmLabel={on ? 'Turn off' : 'Turn on'}
          danger={on}
          busy={act.busy}
          onConfirm={() => void go()}
          onCancel={() => setAsking(false)}
        >
          <ReasonField id="acc-switch-reason" value={reason} onChange={setReason} error={act.fields['reason']} />
          <ErrorText text={act.error} />
        </Confirm>
      )}
    </section>
  );
}

function InviteSection({ api, data }: { api: AccountsStore; data: AccountsOverview }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [f, setF] = useState<InviteForm>(EMPTY_INVITE);
  const [asking, setAsking] = useState(false);
  const [local, setLocal] = useState<Record<string, string>>({});
  const errors = { ...local, ...act.fields };
  const set = <K extends keyof InviteForm>(k: K, v: InviteForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (id: string) => set('tournamentIds', f.tournamentIds.includes(id) ? f.tournamentIds.filter((x) => x !== id) : [...f.tournamentIds, id]);

  const ask = () => {
    const p = inviteProblems(f);
    setLocal(p);
    if (Object.keys(p).length === 0) setAsking(true);
  };
  const send = async () => {
    if (f.role === '') return;
    const r = await act.run(() => api.accountsInvite(actor, { email: f.email, displayName: f.displayName, role: f.role as ScopedRole, tournamentIds: f.tournamentIds, reason: f.reason }));
    if (r) {
      setAsking(false);
      setF(EMPTY_INVITE);
      notify(`Invitation sent. ${f.displayName.trim()} appears below as ${roleLabel(r.role).toLowerCase()}.`);
      bump();
    } else {
      setAsking(false);
    }
  };

  return (
    <section aria-labelledby="acc-invite" className={cardCls}>
      <H2 id="acc-invite">Invite someone</H2>
      {!data.canInvite ? <Note tone="warn">Invitations cannot be sent from here yet (the server is not set up for it, or this is the preview).</Note> : null}
      <div className="mt-3 flex flex-col gap-3">
        <Note>{WARNINGS.invite}</Note>
        <Field label="Their email address" htmlFor="acc-email" hint="Only Supabase keeps it, to send the invitation and for their sign-in.">
          <Input id="acc-email" type="email" value={f.email} onChange={(v) => set('email', v)} error={errors['email']} maxLength={254} />
          <ErrorText id="acc-email-error" text={errors['email']} />
        </Field>
        <Field label="Name to show in this list" htmlFor="acc-name" hint="A first name is enough. No email address or phone number.">
          <Input id="acc-name" value={f.displayName} onChange={(v) => set('displayName', v)} error={errors['displayName']} maxLength={60} />
          <ErrorText id="acc-name-error" text={errors['displayName']} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-semibold text-heading">What they do</legend>
          {(['organizer', 'scorer'] as const).map((r) => (
            <label key={r} className="flex min-h-tap items-start gap-3 rounded-md border border-line-strong p-3 has-[:checked]:border-ps-court has-[:checked]:bg-ps-court-tint">
              <input type="radio" name="acc-role" value={r} checked={f.role === r} onChange={() => set('role', r)} className="mt-1 h-5 w-5" />
              <span>
                <span className="block font-bold">{roleLabel(r)}</span>
                <span className="text-small text-fg-muted">{ROLE_EXPLAIN[r]}</span>
              </span>
            </label>
          ))}
          <ErrorText text={errors['role']} />
        </fieldset>
        {f.role === 'organizer' ? <Note tone="warn">{WARNINGS.role}</Note> : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-semibold text-heading">Their tournaments</legend>
          {data.tournaments.length === 0 ? <Empty>No tournaments yet. Approve a tournament under More, Tournaments first.</Empty> : null}
          {data.tournaments.map((t) => (
            <label key={t.id} className="flex min-h-tap items-center gap-3">
              <input type="checkbox" checked={f.tournamentIds.includes(t.id)} onChange={() => toggle(t.id)} className="h-5 w-5" />
              <span className="break-words">{tournamentLabel(t)}</span>
            </label>
          ))}
          <ErrorText text={errors['tournamentIds']} />
        </fieldset>
        <ReasonField id="acc-invite-reason" value={f.reason} onChange={(v) => set('reason', v)} error={errors['reason']} />
        {!asking ? (
          <div>
            <Button variant="primary" disabled={!data.canInvite} onClick={ask}>Send the invitation</Button>
          </div>
        ) : (
          <Confirm
            title="Send the invitation?"
            body={`An email goes to ${f.email.trim()} now, and it cannot be taken back. They become ${f.role === '' ? '' : roleLabel(f.role).toLowerCase()} for ${f.tournamentIds.length} tournament${f.tournamentIds.length === 1 ? '' : 's'}.`}
            confirmLabel="Send"
            busy={act.busy}
            onConfirm={() => void send()}
            onCancel={() => setAsking(false)}
          />
        )}
        <ErrorText text={act.error} />
      </div>
    </section>
  );
}

function AccountCard({ api, a, tournaments }: { api: AccountsStore; a: AccountDto; tournaments: readonly AccountTournamentRef[] }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [asking, setAsking] = useState<null | { kind: 'revoke'; assignmentId: string; name: string } | { kind: 'disable' } | { kind: 'assign' }>(null);
  const [reason, setReason] = useState('');
  const [pick, setPick] = useState('');
  const headingId = `acc-${a.id}`;
  const options = assignableTournaments(a, tournaments);
  const done = (text: string) => {
    setAsking(null);
    setReason('');
    setPick('');
    notify(text);
    bump();
  };
  const go = async () => {
    if (!asking) return;
    if (asking.kind === 'revoke') {
      const r = await act.run(() => api.accountsRevokeAssignment(actor, { assignmentId: asking.assignmentId, reason }));
      if (r) done(`${a.displayName} no longer has ${asking.name}.`);
    } else if (asking.kind === 'disable') {
      const r = await act.run(() => api.accountsDisable(actor, { profileId: a.id, reason }));
      if (r) done(r.signInBlocked ? `${a.displayName}'s account has ended.` : `${a.displayName}'s account has ended. Their sign-in could not be blocked in Supabase, but they can no longer do anything here.`);
    } else {
      const r = await act.run(() => api.accountsAssign(actor, { profileId: a.id, tournamentId: pick, reason }));
      if (r) done(`${a.displayName} now has another tournament.`);
    }
  };

  return (
    <article className={cx(cardCls, a.status === 'ended' && 'opacity-80')} aria-labelledby={headingId}>
      <h3 id={headingId} className="break-words text-body font-bold text-heading">{a.displayName}</h3>
      <p className="mt-1 flex flex-wrap gap-2">
        <Badge>{roleLabel(a.role)}</Badge>
        <Badge tone={a.status === 'active' ? 'good' : 'warn'}>{statusLabel(a)}</Badge>
      </p>
      {a.tournaments.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2" aria-label={`Tournaments of ${a.displayName}`}>
          {a.tournaments.map((t) => (
            <li key={t.assignmentId} className="flex flex-wrap items-center justify-between gap-2">
              <span className="break-words">{t.tournamentName}</span>
              <Button small onClick={() => setAsking({ kind: 'revoke', assignmentId: t.assignmentId, name: t.tournamentName })}>{`Take away ${t.tournamentName}`}</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {a.status === 'active' && asking === null ? (
        <div className="mt-3 flex flex-col gap-2">
          {options.length > 0 ? (
            <Field label="Give another tournament" htmlFor={`${headingId}-pick`}>
              <select id={`${headingId}-pick`} className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a tournament</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>{tournamentLabel(t)}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {options.length > 0 ? <Button disabled={pick === ''} onClick={() => setAsking({ kind: 'assign' })}>Give this tournament</Button> : null}
            <Button variant="danger" onClick={() => setAsking({ kind: 'disable' })}>End this account</Button>
          </div>
        </div>
      ) : null}
      {asking ? (
        <Confirm
          title={asking.kind === 'revoke' ? `Take ${asking.name} away from ${a.displayName}?` : asking.kind === 'disable' ? `End ${a.displayName}'s account?` : `Give this tournament to ${a.displayName}?`}
          body={asking.kind === 'revoke' ? WARNINGS.revoke : asking.kind === 'disable' ? WARNINGS.disable : a.role === 'organizer' ? WARNINGS.role : 'They can record scores for its matches straight away.'}
          confirmLabel={asking.kind === 'revoke' ? 'Take it away' : asking.kind === 'disable' ? 'End the account' : 'Give it'}
          danger={asking.kind !== 'assign'}
          busy={act.busy}
          onConfirm={() => void go()}
          onCancel={() => setAsking(null)}
        >
          <ReasonField id={`${headingId}-reason`} value={reason} onChange={setReason} error={act.fields['reason']} />
        </Confirm>
      ) : null}
      <ErrorText text={act.error} />
    </article>
  );
}
