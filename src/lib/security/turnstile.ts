// Cloudflare Turnstile server-side validation, fail closed (D-029).
// Endpoint, JSON request support, 2,048-character tokens, 300-second validity, single use (a replay returns
// `timeout-or-duplicate`) and the response fields: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// (checked 2026-10-21). Test secrets and their dummy responses (hostname "localhost", action "test"):
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/ (checked 2026-10-21).

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileFailure = 'unconfigured' | 'rejected' | 'unavailable' | 'hostname_mismatch' | 'action_mismatch';
export type TurnstileResult = { ok: true } | { ok: false; reason: TurnstileFailure };

export interface TurnstileOptions {
  fetch: typeof fetch;
  secret: string | null;
  token: string;
  remoteIp?: string | null;
  /** Hostnames the widget may report. Skipped in test mode. */
  expectedHostnames: readonly string[];
  /** Action the widget was rendered with. Null = no check. Skipped in test mode. */
  expectedAction: string | null;
  /** Cloudflare's published test secret is in use: the dummy response reports hostname "localhost", action "test". */
  testMode: boolean;
  timeoutMs?: number;
}

export async function verifyTurnstile(o: TurnstileOptions): Promise<TurnstileResult> {
  if (!o.secret) return { ok: false, reason: 'unconfigured' };
  const body: Record<string, string> = { secret: o.secret, response: o.token };
  if (o.remoteIp) body.remoteip = o.remoteIp;
  let json: { success?: unknown; hostname?: unknown; action?: unknown };
  try {
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(o.timeoutMs ?? 5000) : undefined;
    const res = await o.fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (json.success !== true) return { ok: false, reason: 'rejected' };
  if (!o.testMode) {
    if (o.expectedHostnames.length > 0) {
      const host = typeof json.hostname === 'string' ? json.hostname.toLowerCase() : '';
      if (!o.expectedHostnames.includes(host)) return { ok: false, reason: 'hostname_mismatch' };
    }
    if (o.expectedAction !== null && json.action !== o.expectedAction) return { ok: false, reason: 'action_mismatch' };
  }
  return { ok: true };
}
