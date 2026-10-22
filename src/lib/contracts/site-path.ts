// A page path the client reports (lead `source.path`, event `path`). S-14: stored values must be safe to show later in the M3
// admin, so the rule is strict: ONE leading slash (a protocol-relative `//host/x` is refused), no backslash, no `..`, no query
// string or fragment (they are cut off first), only URL-path characters, at most `LEAD_LIMITS.sourcePath.max` characters.
// Returns the bare path or null. Pure, no zod, safe to import in the browser.
const PATH_AFTER_FIRST_SLASH = /^[A-Za-z0-9/_\-.~%]{0,199}$/;

export function cleanSitePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const bare = raw.split(/[?#]/)[0] ?? '';
  if (!bare.startsWith('/') || bare.startsWith('//')) return null;
  if (bare.includes('\\') || bare.includes('//') || bare.includes('..')) return null;
  return PATH_AFTER_FIRST_SLASH.test(bare.slice(1)) ? bare : null;
}
