// Tokens of the email list (D-114). WebCrypto only (Vercel functions on Node 24, and the tests).
//  - Confirmation: 32 random bytes as base64url, ONLY in the email. The database keeps its SHA-256 hash (hex), so a copy of the table
//    cannot confirm anyone. A link works once and for CONFIRM_TTL_HOURS (src/lib/notices/constants.ts, the SQL interval).
//  - Unsubscribe: an HMAC of the subscriber id with the server's HMAC_KEY (src/lib/security/hash.ts pseudonym, purpose
//    'notify_unsubscribe'), so every email can carry a working link and nothing about it is stored. A rotated HMAC_KEY makes older
//    links stop working (open item in docs/m5/integration/notifications.md: keep the old key id for unsubscribe checks).
import { pseudonym, type ParsedHmacKey } from '../security/hash';
import { CONFIRM_ENDPOINT, UNSUBSCRIBE_ENDPOINT } from './constants';

export const CONFIRM_TOKEN_BYTES = 32;
export const CONFIRM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const UNSUBSCRIBE_SIG_PATTERN = /^[A-Za-z0-9_-]{1,16}\.[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new confirmation token from an injected byte source. */
export function newConfirmToken(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(CONFIRM_TOKEN_BYTES);
  if (bytes.length !== CONFIRM_TOKEN_BYTES) throw new RangeError('need 32 random bytes');
  return base64url(bytes);
}

/** SHA-256 of the token, lower-case hex: what the database stores and looks up. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function unsubscribeSignature(key: ParsedHmacKey, subscriberId: string): Promise<string> {
  if (!UUID.test(subscriberId)) throw new RangeError('not a subscriber id');
  return pseudonym(key, 'notify_unsubscribe', subscriberId);
}

/** Constant-time comparison of two short ASCII strings. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyUnsubscribe(key: ParsedHmacKey, subscriberId: string, signature: string): Promise<boolean> {
  if (!UUID.test(subscriberId) || !UNSUBSCRIBE_SIG_PATTERN.test(signature)) return false;
  return sameText(await unsubscribeSignature(key, subscriberId), signature);
}

/** https://host/api/notify/confirm?t=<token> (an endpoint: no trailing slash, never through path()). */
export function confirmUrl(origin: string, token: string): string {
  const u = new URL(CONFIRM_ENDPOINT, origin);
  u.searchParams.set('t', token);
  return u.toString();
}

export function unsubscribeUrl(origin: string, subscriberId: string, signature: string): string {
  const u = new URL(UNSUBSCRIBE_ENDPOINT, origin);
  u.searchParams.set('s', subscriberId);
  u.searchParams.set('t', signature);
  return u.toString();
}

/** The adapter's unsubscribe resolver (src/lib/notify/outbox/adapters.ts emailAdapter.unsubscribeUrl). Null for a non-list recipient. */
export function unsubscribeUrlResolver(key: ParsedHmacKey | null, origin: string | null): ((recipientId: string) => Promise<string | null>) | null {
  if (!key || !origin || !origin.startsWith('https://')) return null;
  return async (recipientId) => {
    const m = /^subscriber:([0-9a-f-]{36})$/.exec(recipientId);
    if (!m) return null;
    const id = m[1] as string;
    return unsubscribeUrl(origin, id, await unsubscribeSignature(key, id));
  };
}
