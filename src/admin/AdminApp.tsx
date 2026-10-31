// The admin app shell (lazy-loaded by AdminLoader so the public JS budget is not touched). Mobile-first: a bottom tab bar, one column.
// Two modes, decided by build variables that are NOT secret:
//   live     PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_PUBLISHABLE_KEY set: real sign-in (password + TOTP), data through /api/admin/*.
//   preview  anything missing: an in-memory store with FICTIONAL data, clearly labelled. No network, no real data in any build.
// Tokens live in memory only (a reload signs you out): nothing sensitive is written to browser storage.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { env } from '../config/env';
import { createGoTrue, parseInviteRedirect, setInvitedPassword, type AuthSession, type InviteRedirect } from '../lib/admin/gotrue';
import { canEnrolTotp, createHttpAdminStore, sessionRole, type AdminClient } from '../lib/admin/http-store';
import { navAreasFor } from '../lib/admin/accounts/access';
import { MemoryAdminStore, previewAs } from '../lib/admin/memory-store';
import type { Actor, UndoDescriptor } from '../lib/admin/types';
import './admin.css';
import { Login, type LoginApi } from './Login';
import { hashFor, messageFor, parseHash, ROUTE_TITLE, ROUTES_ADMIN, TAB_LABEL, TAB_ROUTES, tabFor, type AdminRoute } from './messages';
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
  live: lazy(() => import('./screens/Live').then((m) => ({ default: m.Live }))),
  competitions: lazy(() => import('./screens/Competitions').then((m) => ({ default: m.Competitions }))),
  scoring: lazy(() => import('./screens/ScoringArea').then((m) => ({ default: m.Scoring }))),
  registrations: lazy(() => import('./screens/RegistrationsArea').then((m) => ({ default: m.Registrations }))),
  international: lazy(() => import('./screens/InternationalArea').then((m) => ({ default: m.International }))),
  notices: lazy(() => import('./screens/NoticesArea').then((m) => ({ default: m.Notices }))),
  accounts: lazy(() => import('./screens/AccountsArea').then((m) => ({ default: m.Accounts }))),
  settings: lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings }))),
  more: lazy(() => import('./screens/More').then((m) => ({ default: m.More }))),
};

// Shown before sign-in when the page was opened from an invitation email (D-108); its own lazy chunk.
const AcceptInvite = lazy(() => import('./screens/accounts/AcceptInvite').then((m) => ({ default: m.AcceptInvite })));
// The published staff notices on an organizer's or scorer's home (D-114); its own lazy chunk.
const StaffNotices = lazy(() => import('./screens/notices/Notices').then((m) => ({ default: m.StaffNoticesPanel })));

/** The areas an actor may open, in tab order: every tab for the owner; organizers and scorers only their areas (accounts/access.ts). */
export function tabsFor(role: Actor['role']): readonly AdminRoute[] {
  const areas = navAreasFor(role);
  if (areas === null) return TAB_ROUTES;
  return areas.filter((a): a is AdminRoute => (ROUTES_ADMIN as readonly string[]).includes(a));
}

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

/** `?preview-as=organizer` or `?preview-as=scorer` shows the preview as that role would see it (made-up data; preview mode only). */
export function previewRoleFrom(search: string): 'organizer' | 'scorer' | null {
  const v = new URLSearchParams(search).get('preview-as');
  return v === 'organizer' || v === 'scorer' ? v : null;
}

function PreviewApp() {
  const { client, actor } = useMemo<{ client: AdminClient; actor: Actor }>(() => {
    const store = new MemoryAdminStore();
    const role = previewRoleFrom(typeof location === 'undefined' ? '' : location.search);
    return role ? previewAs(store, role) : { client: store, actor: { userId: 'preview-owner', role: 'owner' } };
  }, []);
  return <Shell client={client} actor={actor} mode="preview" signOut={() => undefined} />;
}

function LiveApp() {
  const goTrueCfg = useMemo(() => ({ url: env.supabaseUrl!, publishableKey: env.supabasePublishableKey!, fetch: window.fetch.bind(window) }), []);
  const goTrue = useMemo(() => createGoTrue(goTrueCfg), [goTrueCfg]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [role, setRole] = useState<Actor['role'] | null>(null);
  const [roleRefused, setRoleRefused] = useState(false);
  // An invitation link (D-108) carries a one-time sign-in in the address fragment: read it once, then clear it from the address at once.
  const [invite, setInvite] = useState<InviteRedirect | null>(() => {
    if (typeof location === 'undefined') return null;
    const found = parseInviteRedirect(location.hash);
    if (found) history.replaceState(null, '', location.pathname + location.search);
    return found;
  });
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
  const signOut = useCallback(() => {
    setSession(null);
    setRole(null);
  }, []);

  // the server says which role this session has (D-108); nothing is shown until it answers, and no answer means sign in again
  const userId = session?.userId ?? null;
  useEffect(() => {
    if (!userId || !sessionRef.current) return;
    let live = true;
    void sessionRole({ token: sessionRef.current.accessToken, fetch: window.fetch.bind(window) }).then((r) => {
      if (!live) return;
      if (r === null) {
        setRoleRefused(true);
        setSession(null);
      } else {
        setRoleRefused(false);
        setRole(r);
      }
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (invite) {
    return (
      <Suspense fallback={<p className="p-4 text-fg-muted">Loading...</p>}>
        <AcceptInvite setPassword={(pw) => setInvitedPassword(goTrueCfg, invite.accessToken, pw)} onDone={() => setInvite(null)} />
      </Suspense>
    );
  }
  if (!session) {
    return (
      <>
        {roleRefused ? (
          <p role="alert" className="mx-auto max-w-xl p-4 text-ps-ink">
            This account cannot use the admin right now. If Power Smash invited you, ask the owner to check your access.
          </p>
        ) : null}
        <Login api={api} onSignedIn={setSession} />
      </>
    );
  }
  if (!role) return <p className="p-4 text-fg-muted">Loading...</p>;
  return <Shell client={client} actor={{ userId: session.userId, role }} mode="live" signOut={signOut} />;
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

  // organizers and scorers see only their areas (the server refuses everything else anyway); an unknown or other area falls back to the first
  const tabs = tabsFor(actor.role);
  const owner = actor.role === 'owner';
  const shown: AdminRoute = owner || tabs.includes(route) ? route : (tabs[0] ?? 'dashboard');
  const Screen = SCREENS[shown];
  const undo = async () => {
    if (!notice?.undo) return;
    const r = await client.undo(actor, notice.undo);
    setNotice(r.ok ? { text: 'Undone.', tone: 'ok' } : { text: messageFor(r.code), tone: 'error' });
    bump();
  };

  return (
    <AdminContext.Provider value={ctx}>
      <div className={cx('mx-auto flex min-h-screen max-w-2xl flex-col', notice ? 'pb-20' : 'pb-28')}>
        {mode === 'preview' ? (
          <p role="status" className="bg-ps-live-tint p-3 text-center text-small font-semibold text-ps-ink">
            Preview with made-up data. Nothing here is real and nothing is saved or sent.
            {actor.role !== 'owner' ? ` You are seeing what ${actor.role === 'organizer' ? 'an organizer' : 'a scorer'} sees.` : ''}
          </p>
        ) : null}
        <header className="ps-surface-dark flex items-center justify-between gap-3 border-b-4 border-ps-volt bg-ps-ink px-4 py-3">
          <h1 className="text-h3 font-bold text-ps-white">{ROUTE_TITLE[shown]}</h1>
          {mode === 'live' ? <Button small onClick={signOut}>Sign out</Button> : null}
        </header>
        <main className="flex-1 px-4 pt-5" id="admin-main">
          {!owner && tabs.length > 0 ? (
            <Suspense fallback={null}>
              <StaffNotices store={client} />
            </Suspense>
          ) : null}
          {!owner && tabs.length === 0 ? (
            <p className="text-fg-muted">This account has no admin areas.</p>
          ) : (
            <Suspense fallback={<p className="text-fg-muted">Loading...</p>}>
              <Screen />
            </Suspense>
          )}
        </main>

        {/* Sticky, not fixed: it shows where it always did (80 px up, above the tabs) but takes its own room after the screen, so the last row
            can always be scrolled clear of it, however long the message. pb-20 while it shows matches bottom-20; w-full keeps the old width.
            min-w-0 lets a long one-word name wrap instead of pushing Close off the screen (the page would scroll sideways). */}
        {notice ? (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={cx('sticky bottom-20 z-20 mx-auto mt-4 flex w-full max-w-xl items-center justify-between gap-3 rounded-lg border-2 p-3 shadow-overlay', notice.tone === 'error' ? 'border-ps-live bg-ps-live-tint text-ps-ink' : 'border-ps-court bg-surface text-fg')}>
            <span className="min-w-0">{notice.text}</span>
            <span className="flex gap-2">
              {notice.undo ? <Button small onClick={() => void undo()}>Undo</Button> : null}
              <Button small onClick={() => setNotice(null)}>Close</Button>
            </span>
          </div>
        ) : null}

        <nav aria-label="Admin sections" className="fixed inset-x-0 bottom-0 z-10 border-t border-ps-ink-soft bg-ps-ink shadow-overlay">
          <ul className="mx-auto flex max-w-2xl">
            {tabs.map((r) => (
              <li key={r} className="flex-1">
                <a href={hashFor(r)} aria-current={(owner ? tabFor(shown) : shown) === r ? 'page' : undefined} className={cx('flex min-h-tap items-center justify-center px-1 py-3 text-center text-small font-bold no-underline', (owner ? tabFor(shown) : shown) === r ? 'border-t-4 border-ps-volt bg-ps-ink-soft text-ps-volt' : 'border-t-4 border-transparent text-ps-mist')}>
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
