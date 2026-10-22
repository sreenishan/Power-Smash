// Sign-in: email + password, then the authenticator code (TOTP). Until a verified factor exists the owner enrols one first.
// The owner enrols TWO factors (phone plus a second device, D-006): after the first, the screen offers a second.
import { useState, type ReactElement } from 'react';
import { qrMatrix } from '../lib/qr';
import type { AuthSession, Enrolment } from '../lib/admin/gotrue';
import { Button, Field, TextInput, cardCls } from './ui';

export interface LoginApi {
  signIn(email: string, password: string): Promise<{ ok: true; session: AuthSession } | { ok: false; message: string }>;
  verify(session: AuthSession, factorId: string, code: string): Promise<{ ok: true; session: AuthSession } | { ok: false; message: string }>;
  enrol(session: AuthSession, name: string): Promise<{ ok: true; enrolment: Enrolment } | { ok: false; message: string }>;
  factorsOf(session: AuthSession): { id: string }[];
}

function Qr({ text }: { text: string }) {
  let m: ReturnType<typeof qrMatrix> | null = null;
  try {
    m = qrMatrix(text);
  } catch {
    m = null;
  }
  if (!m) return null;
  const q = 4;
  const size = m.size + q * 2;
  const cells: ReactElement[] = [];
  m.rows.forEach((row, y) => row.forEach((dark, x) => { if (dark) cells.push(<rect key={`${x}-${y}`} x={x + q} y={y + q} width="1" height="1" />); }));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Authenticator QR code" className="h-56 w-56 bg-white" shapeRendering="crispEdges">
      <g fill="#000">{cells}</g>
    </svg>
  );
}

export function Login({ api, onSignedIn }: { api: LoginApi; onSignedIn: (s: AuthSession) => void }) {
  const [step, setStep] = useState<'credentials' | 'code' | 'enrol'>('credentials');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const submitCredentials = () =>
    wrap(async () => {
      const r = await api.signIn(email.trim(), password);
      if (!r.ok) return setMessage(r.message);
      setSession(r.session);
      setPassword('');
      const first = api.factorsOf(r.session)[0];
      if (first) {
        setFactorId(first.id);
        setStep('code');
      } else {
        const e = await api.enrol(r.session, 'Owner phone');
        if (!e.ok) return setMessage(e.message);
        setEnrolment(e.enrolment);
        setFactorId(e.enrolment.factorId);
        setStep('enrol');
      }
    });

  const submitCode = () =>
    wrap(async () => {
      if (!session || !factorId) return;
      const r = await api.verify(session, factorId, code.trim());
      if (!r.ok) return setMessage(r.message);
      onSignedIn(r.session);
    });

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h1 className="text-h2 font-bold text-heading">Power Smash admin</h1>
      <form className={`${cardCls} flex flex-col gap-4`} onSubmit={(e) => { e.preventDefault(); void (step === 'credentials' ? submitCredentials() : submitCode()); }}>
        {step === 'credentials' ? (
          <>
            <Field label="Email" htmlFor="login-email"><TextInput id="login-email" type="email" autoComplete="username" value={email} onChange={setEmail} /></Field>
            <Field label="Password" htmlFor="login-password"><TextInput id="login-password" type="password" autoComplete="current-password" value={password} onChange={setPassword} /></Field>
          </>
        ) : null}
        {step === 'enrol' && enrolment ? (
          <>
            <p>First time: add this account to your authenticator app. Scan the picture, or type the secret.</p>
            <div className="flex justify-center"><Qr text={enrolment.uri} /></div>
            <p className="break-all text-small">Secret: <span className="font-mono">{enrolment.secret}</span></p>
            <p className="text-small text-fg-muted">Set up a second authenticator on another device too, so losing one phone does not lock you out.</p>
          </>
        ) : null}
        {step !== 'credentials' ? (
          <Field label="6-digit code from your authenticator app" htmlFor="login-code">
            <TextInput id="login-code" value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
          </Field>
        ) : null}
        {message ? <p role="alert" className="font-semibold text-ps-live">{message}</p> : null}
        <Button type="submit" variant="primary" busy={busy} disabled={step === 'credentials' ? email.trim() === '' || password === '' : !/^\d{6}$/.test(code.trim())}>
          {step === 'credentials' ? 'Continue' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
