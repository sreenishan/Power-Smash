// Client address for rate limiting and spam checks (Vercel port, 2026-10-22).
//
// On Vercel the platform sets the forwarding headers itself and overwrites any value the visitor sent
// (https://vercel.com/docs/headers/request-headers: `x-vercel-forwarded-for`, `x-real-ip`, `x-forwarded-for`), so the
// FIRST address of `x-vercel-forwarded-for` is the one to trust. We prefer it, then `x-real-ip`, then `x-forwarded-for`.
// Outside Vercel (local dev, tests) these headers are caller-controlled; that is acceptable there only, and the
// Cloudflare header `cf-connecting-ip` is deliberately IGNORED now: behind Vercel it is attacker-supplied.
// Every candidate must parse as an IPv4 or IPv6 literal, otherwise it is skipped (never hashed as free text).
// IPv6 is reduced to its /64 later by `normaliseIp` (./hash.ts).

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9a-f:.]+$/i;

function validIp(candidate: string): string | null {
  const v = candidate.trim().replace(/^\[|\]$/g, '');
  if (v.length === 0 || v.length > 45) return null;
  if (IPV4.test(v)) return v;
  if (!v.includes(':') || !IPV6.test(v)) return null;
  // IPv6: hex groups of 1-4 digits, at most one `::`, an optional trailing dotted IPv4 (counts as two groups).
  const doubles = v.split('::').length - 1;
  if (doubles > 1 || v.includes(':::')) return null;
  let rest = v;
  let extra = 0;
  const tail = /:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (tail) {
    if (!IPV4.test(tail[1] as string)) return null;
    rest = v.slice(0, v.length - (tail[1] as string).length) + '0';
    extra = 1;
  }
  const hexOk = rest.split(':').every((g) => g === '' || /^[0-9a-f]{1,4}$/i.test(g));
  if (!hexOk) return null;
  const count = rest.split(':').filter((g) => g !== '').length + extra;
  if (doubles === 1) return count <= 7 ? v : null;
  return count === 8 ? v : null;
}

function firstValid(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0] ?? '';
  return validIp(first);
}

/** The visitor's address as seen by the platform, or null when none of the trusted headers holds a valid address. */
export function clientIpFromHeaders(headers: Pick<Headers, 'get'>): string | null {
  return (
    firstValid(headers.get('x-vercel-forwarded-for')) ??
    firstValid(headers.get('x-real-ip')) ??
    firstValid(headers.get('x-forwarded-for'))
  );
}
