// Small shared UI pieces for the admin (React, tokens only, 44 px targets, 16 px text). No raw HTML injection anywhere.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AdminClient } from '../lib/admin/http-store';
import type { Actor, AdminErrorCode, StoreResult, UndoDescriptor } from '../lib/admin/types';
import { AGE_EXPLAIN, AGE_LABEL, messageFor } from './messages';

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

export const inputCls = 'block w-full min-h-[3rem] rounded-md border-2 border-line-strong bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-muted ps-transition hover:border-ps-ink focus-visible:border-ps-court disabled:opacity-60';
export const cardCls = 'rounded-lg border border-line border-l-4 border-l-ps-court bg-surface p-4 shadow-card';

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

export function Button(props: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit'; small?: boolean }) {
  const v = props.variant ?? 'quiet';
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 font-bold ps-transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60',
        props.small ? 'min-h-tap text-small' : 'min-h-[3rem] text-body',
        v === 'primary' && 'bg-ps-court text-ps-white hover:bg-ps-court-deep',
        v === 'quiet' && 'border-2 border-line-strong bg-surface text-fg hover:bg-ps-court-tint',
        v === 'danger' && 'bg-ps-live text-ps-white hover:opacity-90',
      )}
    >
      {props.busy ? 'Working...' : props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.htmlFor} className="text-small font-bold uppercase tracking-wider text-fg">
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

export function Badge(props: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' | 'danger' }) {
  const tone = props.tone ?? 'neutral';
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-pill border px-2 py-0.5 text-small font-semibold',
        tone === 'neutral' && 'border-line-strong text-fg',
        tone === 'warn' && 'border-ps-live bg-ps-live-tint text-ps-ink',
        tone === 'good' && 'border-ps-court bg-ps-court-tint text-ps-ink',
        tone === 'danger' && 'border-ps-live bg-ps-live text-ps-white',
      )}
    >
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
  return <p className="rounded-lg border-2 border-dashed border-line-strong p-4 text-fg-muted">{children}</p>;
}

export function LoadState({ loading, error, children }: { loading: boolean; error: AdminErrorCode | null; children: ReactNode }) {
  if (error) return <p role="alert" className="rounded-lg border-2 border-ps-live bg-ps-live-tint p-4 text-ps-ink">{messageFor(error)}</p>;
  if (loading) return <p className="text-fg-muted" aria-live="polite">Loading...</p>;
  return <>{children}</>;
}

/** Inline confirmation instead of a modal: works with a phone keyboard and keeps focus where the owner is. */
export function Confirm(props: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} tabIndex={-1} role="alertdialog" aria-label={props.title} className="mt-3 rounded-lg border-2 border-ps-live bg-ps-live-tint p-4 text-ps-ink">
      <p className="font-bold">{props.title}</p>
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
