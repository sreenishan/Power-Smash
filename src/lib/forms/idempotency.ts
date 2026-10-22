// Idempotency keys for lead submissions (D-029): one key per form session, REUSED when the same data is sent again
// (a retry after a timeout must not create a second lead), replaced when the visitor changed what they are sending.
//
// Why replace on change: if attempt 1 reached the server but the reply was lost, and the visitor then edits a field and
// sends again, reusing the key would make the server replay attempt 1 and silently drop the edit. A new key at worst
// creates a second lead the owner can merge; losing the visitor's correction is worse.

export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => unknown;
}

/**
 * A random RFC 4122 version 4 UUID, the format the lead contract requires (z.uuid). Uses crypto.randomUUID where it
 * exists, otherwise builds one from crypto.getRandomValues. Throws if no secure RNG exists.
 */
export function newIdempotencyKey(source: RandomSource | undefined = globalThis.crypto): string {
  if (source?.randomUUID) return source.randomUUID();
  if (source?.getRandomValues) {
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Never fall back to Math.random: a guessable key lets someone replay another visitor's submission.
  throw new Error('No secure random source available');
}

/** Fields that change on every attempt and must not influence the fingerprint. */
const VOLATILE_FIELDS = new Set(['idempotencyKey', 'token', 'elapsedMs']);

/** Stable text for "is this the same submission as before": sorted keys, volatile fields left out. */
export function payloadFingerprint(payload: Record<string, unknown>): string {
  const keep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(keep);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        out[k] = keep((value as Record<string, unknown>)[k]);
      }
      return out;
    }
    return value;
  };
  const top: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) {
    if (!VOLATILE_FIELDS.has(k)) top[k] = keep(payload[k]);
  }
  return JSON.stringify(top);
}

export interface IdempotencySession {
  /** The key for this payload: reused if the payload is unchanged since the last call, otherwise a new one. */
  keyFor(payload: Record<string, unknown>): string;
  /** Forget the key (after a `duplicate` answer, or after a successful send). */
  rotate(): void;
}

export function createIdempotencySession(generate: () => string = newIdempotencyKey): IdempotencySession {
  let key: string | null = null;
  let fingerprint: string | null = null;
  return {
    keyFor(payload) {
      const fp = payloadFingerprint(payload);
      if (key === null || fingerprint !== fp) {
        key = generate();
        fingerprint = fp;
      }
      return key;
    },
    rotate() {
      key = null;
      fingerprint = null;
    },
  };
}
