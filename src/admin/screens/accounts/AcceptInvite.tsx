// The first screen an invited organizer or scorer sees (D-108): the Supabase invitation link opens the admin address, and here they
// choose a password. Then they sign in with it as usual and must set up two-step sign-in (a code app) before anything else. Shown by
// the sign-in screen when the address carries an invitation (gotrue.ts parseInviteRedirect); it needs no admin context. The token is
// kept in memory only and the address fragment is cleared by the caller.
import { useState } from 'react';
import { PASSWORD_MAX, passwordProblem, type AuthResult } from '../../../lib/admin/gotrue';
import { Button, Field, inputCls } from '../../ui';
import { ErrorText, Note } from '../competition/shared';

export const ACCEPT_MESSAGES = {
  intro: 'Welcome. Power Smash has invited you to help run tournaments. Choose a password for your sign-in. Next you will set up a sign-in code app on your phone.',
  mismatch: 'The two passwords are not the same.',
  invalid_credentials: 'This invitation link has expired or was already used. Ask for a new invitation.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  network: 'The sign-in service could not be reached. Try again in a minute.',
  unexpected: 'The password was not saved. Try again, or ask for a new invitation.',
  done: 'Your password is saved. Sign in with your email address and the new password.',
} as const;

export function AcceptInvite(props: { setPassword: (password: string) => Promise<AuthResult<true>>; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const save = async () => {
    const p = passwordProblem(pw);
    const next: Record<string, string> = {};
    if (p) next['pw'] = p;
    else if (pw !== again) next['again'] = ACCEPT_MESSAGES.mismatch;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const r = await props.setPassword(pw);
      if (r.ok) {
        setDone(true);
        setPw('');
        setAgain('');
      } else {
        const code = r.code === 'invalid_credentials' || r.code === 'rate_limited' || r.code === 'network' ? r.code : 'unexpected';
        setErrors({ form: ACCEPT_MESSAGES[code] });
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <Note>{ACCEPT_MESSAGES.done}</Note>
        <div>
          <Button variant="primary" onClick={props.onDone}>Go to sign in</Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p>{ACCEPT_MESSAGES.intro}</p>
      <Field label="New password" htmlFor="inv-pw" hint="At least 12 characters. A few unrelated words work well.">
        <PasswordInput id="inv-pw" value={pw} onChange={setPw} error={errors['pw']} />
      </Field>
      <Field label="The same password again" htmlFor="inv-pw2">
        <PasswordInput id="inv-pw2" value={again} onChange={setAgain} error={errors['again']} />
      </Field>
      <ErrorText text={errors['form']} />
      <div>
        <Button type="submit" variant="primary" busy={busy}>Save the password</Button>
      </div>
    </form>
  );
}

function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <>
      <input
        id={props.id}
        className={inputCls}
        type="password"
        autoComplete="new-password"
        value={props.value}
        maxLength={PASSWORD_MAX}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <ErrorText id={`${props.id}-error`} text={props.error} />
    </>
  );
}
