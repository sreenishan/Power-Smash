// The admin app shell (lazy-loaded by AdminLoader so the public JS budget is not touched). Mobile-first: a bottom tab bar, one column.
// Two modes, decided by build variables that are NOT secret:
//   live     PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_PUBLISHABLE_KEY set: real sign-in (password + TOTP), data through /api/admin/*.
//   preview  anything missing: an in-memory store with FICTIONAL data, clearly labelled. No network, no real data in any build.
// Tokens live in memory only (a reload signs you out): nothing sensitive is written to browser storage.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { env } from '../config/env';
import { createGoTrue, type AuthSession } from '../lib/admin/gotrue';
import { canEnrolTotp, createHttpAdminStore, type AdminClient } from '../lib/admin/http-store';
import { MemoryAdminStore } from '../lib/admin/memory-store';
import type { Actor, UndoDescriptor } from '../lib/admin/types';
import './admin.css';
import { Login, type LoginApi } from './Login';
import { hashFor, messageFor, parseHash, ROUTE_TITLE, TAB_LABEL, TAB_ROUTES, tabFor, type AdminRoute } from './messages';
import { AdminContext, Button, cx, type AdminCtx } from './ui';

// Every area is its own lazy chunk: the owner phone downloads only the area it opens (admin JS budget).
const SCREENS: Record<AdminRoute, ComponentType> = {
  dashboard: lazy(() => import('./screens/Dashboard').then((m) => ({ default: m.Dashboard }))),
  inbox: lazy(() => import('./screens/Inbox').then((m) => ({ default: m.Inbox }))),
  videos: lazy(() => import('./screens/Videos').then((m) => ({ default: m.Videos }))),
  players: lazy(() => import('./screens/Players').then((m) => ({ default: m.Players }))),
  tournaments: lazy(() => import('./screens/Tournaments').then((m) => ({ default: m.Tournaments }))),
  submissions: lazy(() => import('./screens/Submissions').then((m) => ({ default: m.Submissions }))),
  sponsors: lazy(() => import('./screens/Sponsors').then((m) => ({ default: m.Sponsors }))),
  prices: lazy(() => import('./screens/Prices').then((m) => ({ default: m.Prices }))),
  posters: lazy(() => import('./screens/Posters').then((m) => ({ default: m.Posters }))),
  settings: lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings }))),
  more: lazy(() => import('./screens/More').then((m) => ({ default: m.More }))),
};

function useRoute(): AdminRoute {
  const [route, setRoute] = useState<AdminRoute>(() => parseHash(typeof location === 'undefined' ? '' : location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const LIVE = env.supabaseUrl !== null && env.supabasePublishableKey !== null;

export default function AdminApp() {
  return LIVE ? <LiveApp /> : <PreviewApp />;
}

function PreviewApp() {
  const client = useMemo<AdminClient>(() => new MemoryAdminStore(), []);
  const actor = useMemo<Actor>(() => ({ userId: 'preview-owner', role: 'owner' }), []);
  return <Shell client={client} actor={actor} mode="preview" signOut={() => undefined} />;
}

function LiveApp() {
  const goTrue = useMemo(() => createGoTrue({ url: env.supabaseUrl!, publishableKey: env.supabasePublishableKey!, fetch: window.fetch.bind(window) }), []);
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  sessionRef.current = session;

  const api = useMemo<LoginApi>(
    () => ({
      async signIn(email, password) {
        const r = await goTrue.signInWithPassword(email, password);
        return r.ok ? { ok: true, session: r.value } : { ok: false, message: r.code === 'rate_limited' ? 'Too many tries. Wait a few minutes.' : r.code === 'network' ? 'No connection. Try again.' : 'Email or password is not right.' };
      },
      async verify(s, factorId, code) {
        const r = await goTrue.verifyTotp(s, factorId, code);
        return r.ok ? { ok: true, session: r.value } : { ok: false, message: r.code === 'network' ? 'No connection. Try again.' : 'That code is not right. Wait for a new one and try again.' };
      },
      async enrol(s, name) {
        // S2-8: only the very first factor, only for the owner profile, decided by the Worker
        const permitted = await canEnrolTotp({ token: s.accessToken, fetch: window.fetch.bind(window) });
        if (!permitted) return { ok: false, message: 'Authenticator setup is closed for this account. If you lost your authenticator, use the recovery steps from the owner guide.' };
        const r = await goTrue.enrollTotp(s, name, permitted);
        return r.ok ? { ok: true, enrolment: r.value } : { ok: false, message: 'Could not start authenticator setup. Try again.' };
      },
      factorsOf: (s) => goTrue.verifiedTotpFactors(s),
    }),
    [goTrue],
  );

  // refresh the token a minute before it runs out; if that fails the owner signs in again
  useEffect(() => {
    if (!session) return;
    const wait = Math.max(5_000, session.expiresAt - Date.now() - 60_000);
    const t = window.setTimeout(() => {
      void goTrue.refresh(session).then((r) => setSession(r.ok ? r.value : null));
    }, wait);
    return () => window.clearTimeout(t);
  }, [session, goTrue]);

  const client = useMemo(() => createHttpAdminStore({ getToken: () => sessionRef.current?.accessToken ?? null, fetch: window.fetch.bind(window) }), []);
  const signOut = useCallback(() => setSession(null), []);

  if (!session) return <Login api={api} onSignedIn={setSession} />;
  return <Shell client={client} actor={{ userId: session.userId, role: 'owner' }} mode="live" signOut={signOut} />;
}

function Shell({ client, actor, mode, signOut }: { client: AdminClient; actor: Actor; mode: 'preview' | 'live'; signOut: () => void }) {
  const route = useRoute();
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<{ text: string; undo?: UndoDescriptor; tone: 'ok' | 'error' } | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const ctx = useMemo<AdminCtx>(
    () => ({
      client,
      actor,
      mode,
      signOut,
      version,
      bump,
      notify: (text, undo) => setNotice({ text, undo, tone: 'ok' }),
      check: (<T,>(r: Parameters<AdminCtx['check']>[0]): r is { ok: true; data: T } => {
        if (r.ok) return true;
        setNotice({ text: messageFor(r.code), tone: 'error' });
        if (r.code === 'UNAUTHORIZED') signOut();
        return false;
      }) as AdminCtx['check'],
    }),
    [client, actor, mode, signOut, version, bump],
  );

  const Screen = SCREENS[route];
  const undo = async () => {
    if (!notice?.undo) return;
    const r = await client.undo(actor, notice.undo);
    setNotice(r.ok ? { text: 'Undone.', tone: 'ok' } : { text: messageFor(r.code), tone: 'error' });
    bump();
  };

  return (
    <AdminContext.Provider value={ctx}>
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col pb-28">
        {mode === 'preview' ? (
          <p role="status" className="bg-ps-live-tint p-3 text-center text-small font-semibold text-ps-ink">
            Preview with made-up data. Nothing here is real and nothing is saved or sent.
          </p>
        ) : null}
        <header className="ps-surface-dark flex items-center justify-between gap-3 border-b-4 border-ps-volt bg-ps-ink px-4 py-3">
          <h1 className="text-h3 font-bold text-ps-white">{ROUTE_TITLE[route]}</h1>
          {mode === 'live' ? <Button small onClick={signOut}>Sign out</Button> : null}
        </header>
        <main className="flex-1 px-4 pt-5" id="admin-main">
          <Suspense fallback={<p className="text-fg-muted">Loading...</p>}>
            <Screen />
          </Suspense>
        </main>

        {notice ? (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={cx('fixed inset-x-0 bottom-20 z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-lg border-2 p-3 shadow-overlay', notice.tone === 'error' ? 'border-ps-live bg-ps-live-tint text-ps-ink' : 'border-ps-court bg-surface text-fg')}>
            <span>{notice.text}</span>
            <span className="flex gap-2">
              {notice.undo ? <Button small onClick={() => void undo()}>Undo</Button> : null}
              <Button small onClick={() => setNotice(null)}>Close</Button>
            </span>
          </div>
        ) : null}

        <nav aria-label="Admin sections" className="fixed inset-x-0 bottom-0 z-10 border-t border-ps-ink-soft bg-ps-ink shadow-overlay">
          <ul className="mx-auto flex max-w-2xl">
            {TAB_ROUTES.map((r) => (
              <li key={r} className="flex-1">
                <a href={hashFor(r)} aria-current={tabFor(route) === r ? 'page' : undefined} className={cx('flex min-h-tap items-center justify-center px-1 py-3 text-center text-small font-bold no-underline', tabFor(route) === r ? 'border-t-4 border-ps-volt bg-ps-ink-soft text-ps-volt' : 'border-t-4 border-transparent text-ps-mist')}>
                  {TAB_LABEL[r]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </AdminContext.Provider>
  );
}
