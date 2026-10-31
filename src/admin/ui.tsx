// Small shared UI pieces for the admin (React, tokens only, 44 px targets, 16 px text). No raw HTML injection anywhere.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AdminClient } from '../lib/admin/http-store';
import type { Actor, AdminErrorCode, StoreResult, UndoDescriptor } from '../lib/admin/types';
import { AGE_EXPLAIN, AGE_LABEL, messageFor } from './messages';

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

// Inputs: a 1 px edge that passes 3:1 (line-strong), a faint inset, court edge on focus. Cards: the admin card recipe in admin.css
// (1 px hairline, one court accent edge, soft shadow). Both re-colour themselves in dark mode through the semantic tokens.
export const inputCls = 'ps-admin-input block w-full min-h-[3rem] rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-muted ps-transition hover:border-ps-ink focus-visible:border-ps-court disabled:opacity-60';
export const cardCls = 'ps-admin-card p-4 sm:p-5';
/** Small form and group labels: sentence case, semibold (no tracked capitals). */
export const labelCls = 'text-small font-semibold text-heading';

/** Button look for links and other non-button elements, so a link that acts like a button matches <Button>. */
export function btnCls(variant: 'primary' | 'quiet' | 'danger' = 'quiet', small = false): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-md px-4 font-semibold no-underline ps-transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60',
    small ? 'min-h-tap text-small' : 'min-h-[3rem] text-body',
    variant === 'primary' && 'bg-ps-court text-ps-white shadow-card hover:bg-ps-court-deep',
    variant === 'quiet' && 'border border-line-strong bg-surface text-fg hover:border-ps-ink hover:bg-ps-court-tint',
    variant === 'danger' && 'bg-ps-live text-ps-white shadow-card hover:opacity-90',
  );
}

// ----------------------------------------------------------------------------- icons

// A few Lucide icons (ISC licence) drawn inline: the admin has no icon library and must not add one. Always decorative.
const ICON_PATHS = {
  arrowLeft: <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  externalLink: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
  pencil: <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>,
  home: <><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  video: <><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  menu: <><path d="M4 12h16" /><path d="M4 6h16" /><path d="M4 18h16" /></>,
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  activity: <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />,
  bell: <><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>,
  clipboard: <><rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>,
} as const;
export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cx('shrink-0', className)}>
      {ICON_PATHS[name]}
    </svg>
  );
}

// ----------------------------------------------------------------------------- context

export interface AdminCtx {
  client: AdminClient;
  actor: Actor;
  mode: 'preview' | 'live';
  /** Shows a message; with an undo descriptor it shows an Undo button. */
  notify: (text: string, undo?: UndoDescriptor) => void;
  /** Turns a failed result into a message. Returns true when the result is OK. */
  check: <T>(r: StoreResult<T>) => r is { ok: true; data: T };
  signOut: () => void;
  /** Bumped after every change so every screen reloads its lists. */
  version: number;
  bump: () => void;
}

export const AdminContext = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const v = useContext(AdminContext);
  if (!v) throw new Error('AdminContext missing');
  return v;
}

// ----------------------------------------------------------------------------- data hook

export function useAsync<T>(load: () => Promise<StoreResult<T>>, deps: unknown[]): { data: T | null; error: AdminErrorCode | null; loading: boolean } {
  const { version, signOut } = useAdmin();
  const [state, setState] = useState<{ data: T | null; error: AdminErrorCode | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    void load().then((r) => {
      if (mine !== seq.current) return;
      if (!r.ok && r.code === 'UNAUTHORIZED') signOut();
      setState(r.ok ? { data: r.data, error: null, loading: false } : { data: null, error: r.code, loading: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}

// ----------------------------------------------------------------------------- primitives

export function Button(props: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit'; small?: boolean; className?: string }) {
  const v = props.variant ?? 'quiet';
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      className={cx(btnCls(v, props.small), props.className)}
    >
      {props.busy ? 'Working...' : props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.htmlFor} className={labelCls}>
        {props.label}
      </label>
      {props.children}
      {props.hint ? <p className="text-small text-fg-muted">{props.hint}</p> : null}
    </div>
  );
}

export function TextInput(props: { id: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; inputMode?: 'numeric' | 'text'; maxLength?: number }) {
  return (
    <input
      id={props.id}
      className={inputCls}
      value={props.value}
      type={props.type ?? 'text'}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete ?? 'off'}
      inputMode={props.inputMode}
      maxLength={props.maxLength}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

/**
 * One chip vocabulary for the whole admin. The tone is never the only signal: the words say it, and good, warn and danger carry an icon.
 *   neutral  a plain fact (format, places, "Seed 3")
 *   good     done or safe (confirmed, published, approved, on)
 *   warn     needs the owner's attention, nothing is broken (not approved yet, protected on the site, junior)
 *   danger   stopped or refused (rare; red fill, white text)
 */
export function Badge(props: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' | 'danger' }) {
  const tone = props.tone ?? 'neutral';
  return (
    <span className={`ps-chip ps-admin-chip ps-admin-chip-${tone}`}>
      {tone === 'good' ? <Icon name="check" size={14} /> : tone === 'warn' || tone === 'danger' ? <Icon name="alert" size={14} /> : null}
      {props.children}
    </span>
  );
}

export function AgeBadge({ status }: { status: keyof typeof AGE_LABEL }) {
  return (
    <span title={AGE_EXPLAIN[status]}>
      <Badge tone={status === 'adult_confirmed' ? 'good' : status === 'unknown' ? 'neutral' : 'warn'}>{AGE_LABEL[status]}</Badge>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="ps-admin-empty">{children}</p>;
}

export function LoadState({ loading, error, children }: { loading: boolean; error: AdminErrorCode | null; children: ReactNode }) {
  if (error) return <p role="alert" className="ps-admin-callout ps-admin-callout-warn">{messageFor(error)}</p>;
  if (loading) return <p className="ps-admin-loading" aria-live="polite">Loading...</p>;
  return <>{children}</>;
}

/** Inline confirmation instead of a modal: works with a phone keyboard and keeps focus where the owner is. */
export function Confirm(props: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} tabIndex={-1} role="alertdialog" aria-label={props.title} className="ps-admin-confirm mt-3">
      <p className="font-bold text-heading">{props.title}</p>
      <div className="mt-1 text-body">{props.body}</div>
      {props.children}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={props.danger ? 'danger' : 'primary'} onClick={props.onConfirm} busy={props.busy}>
          {props.confirmLabel}
        </Button>
        <Button onClick={props.onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
