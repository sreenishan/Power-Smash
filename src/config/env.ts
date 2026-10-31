// Typed access to PUBLIC_* build variables (D-027). Missing values are `null`, never a made-up default:
// a section that needs a missing owner input is hidden (D-034 hide-section rule), see src/content/site.ts.
const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * True only in the STRICT release build (PS_STRICT=1, the only build deploy.yml runs). Every other build (developer, CI, the
 * private preview) is not a release: it shows made-up contact details instead of the owner's real ones (owner decision
 * 2026-10-31; the preview is shared on phones and never needs to reach the real number or inbox).
 */
export function isReleaseBuild(): boolean {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return ({ ...meta, ...proc } as Record<string, string | undefined>).PS_STRICT === '1';
}

/** Made-up contact details for every non-release build. None can reach anyone: no Indian mobile starts with 0, and example.com is reserved. */
export const PREVIEW_CONTACT = {
  phone: '+91 00000 00000',
  publicEmail: 'hello@example.com',
  whatsappNumber: '910000000000',
} as const;

export const env = {
  siteUrl: clean(import.meta.env.PUBLIC_SITE_URL),
  // digits with country code, no "+"; outside the release build a set number is replaced by the made-up one (none stays none)
  whatsappNumber: ((n: string | null) => (n === null || isReleaseBuild() ? n : PREVIEW_CONTACT.whatsappNumber))(clean(import.meta.env.PUBLIC_WHATSAPP_NUMBER)),
  turnstileSiteKey: clean(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY),
  supabaseUrl: clean(import.meta.env.PUBLIC_SUPABASE_URL),
  supabasePublishableKey: clean(import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  /**
   * Hard rule 9: every page is noindex (and robots.txt disallows everything) unless PUBLIC_ALLOW_INDEXING is EXACTLY "true".
   * Set it only at the G1 go-live, in the deploy workflow. Any other value, or none, keeps the site out of search.
   */
  allowIndexing: import.meta.env.PUBLIC_ALLOW_INDEXING === 'true',
} as const;
