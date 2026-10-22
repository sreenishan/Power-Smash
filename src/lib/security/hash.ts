// Pseudonymous hashing for IPs, phones, emails and sessions (D-029): HMAC-SHA-256 with a Worker-only key that carries
// a key id, output truncated, documented as pseudonymous (not anonymous). WebCrypto only (Workers and Node 24).

export interface ParsedHmacKey {
  kid: string;
  secret: string;
}

/**
 * `HMAC_KEY` = `<key id>:<random secret of at least 32 characters>`, e.g. generated at the PC with
 * `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64url'))"` and entered by the owner (docs/SECRETS.md).
 * The key id is stored in front of every hash so a later rotation does not orphan old hashes.
 */
export function parseHmacKey(raw: string | null | undefined): ParsedHmacKey | null {
  if (!raw) return null;
  const m = /^([A-Za-z0-9_-]{1,16}):(.{32,})$/.exec(raw);
  return m ? { kid: m[1] as string, secret: m[2] as string } : null;
}

const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer, bytes: number): string =>
  Array.from(new Uint8Array(buf).slice(0, bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// Imported keys are cached by secret VALUE (so a rotated secret gets a new entry): one import per isolate, not per hash.
const importedKeys = new Map<string, Promise<CryptoKey>>();
function importKey(secret: string): Promise<CryptoKey> {
  let k = importedKeys.get(secret);
  if (!k) {
    if (importedKeys.size >= 4) importedKeys.clear();
    k = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    importedKeys.set(secret, k);
  }
  return k;
}

/** HMAC-SHA-256 over `purpose|value`, first 16 bytes as hex, prefixed with the key id: `k1.<32 hex>`. */
export async function pseudonym(key: ParsedHmacKey, purpose: string, value: string, bytes = 16): Promise<string> {
  const cryptoKey = await importKey(key.secret);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${purpose}|${value}`));
  return `${key.kid}.${toHex(sig, bytes)}`;
}

/**
 * Reduce an IP address to the unit a person can realistically rotate within: IPv4 as is, IPv6 to its /64.
 * Returns `none` when the address is missing (local dev); never throws.
 */
export function normaliseIp(ip: string | null | undefined): string {
  const raw = (ip ?? '').trim().toLowerCase();
  if (raw === '') return 'none';
  if (!raw.includes(':')) return raw.slice(0, 15);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw); // IPv4-mapped IPv6
  if (mapped) return mapped[1] as string;
  const [head = '', tail = ''] = raw.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail === '' ? [] : tail.split(':');
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = raw.includes('::') ? [...headParts, ...Array(missing).fill('0'), ...tailParts] : headParts;
  return `v6:${full
    .slice(0, 4)
    .map((h) => h.replace(/^0+(?=.)/, ''))
    .join(':')}`;
}

/** Lowercase hex, `n` random bytes, from an injected byte source. */
export function randomHex(randomBytes: (n: number) => Uint8Array, n: number): string {
  return Array.from(randomBytes(n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
