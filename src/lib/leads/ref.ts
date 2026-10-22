// Lead reference codes: `PS-YYYY-XXXXXX` (D-025). The year is the IST year (D-030); the suffix is random
// (30 bits from the injected random source), never sequential, from Crockford's base32 alphabet without I, L, O, U so it
// is easy to read out over a phone call or a WhatsApp message.
export const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 characters

/** Calendar year in Asia/Kolkata for an instant. */
export function istYear(now: Date): number {
  // IST is UTC+05:30 all year (no DST).
  return new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCFullYear();
}

export function makeRefCode(now: Date, randomBytes: (n: number) => Uint8Array, suffixLength = 6): string {
  const bytes = randomBytes(suffixLength);
  let suffix = '';
  for (let i = 0; i < suffixLength; i += 1) {
    // 256 is a multiple of 32, so masking the low 5 bits is unbiased.
    suffix += REF_ALPHABET[(bytes[i] as number) & 31];
  }
  return `PS-${istYear(now)}-${suffix}`;
}
