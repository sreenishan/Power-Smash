// Host helper shared by the placement code. Pure.

/** Lower-case host of an https URL, or null for anything else. */
export function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}
