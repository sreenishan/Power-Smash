// Typed access to PUBLIC_* build variables (D-027). Missing values are `null`, never a made-up default:
// a section that needs a missing owner input is hidden (D-034 hide-section rule), see src/content/site.ts.
const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export const env = {
  siteUrl: clean(import.meta.env.PUBLIC_SITE_URL),
  whatsappNumber: clean(import.meta.env.PUBLIC_WHATSAPP_NUMBER), // digits with country code, no "+"
  turnstileSiteKey: clean(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY),
  supabaseUrl: clean(import.meta.env.PUBLIC_SUPABASE_URL),
  supabasePublishableKey: clean(import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  /**
   * Hard rule 9: every page is noindex (and robots.txt disallows everything) unless PUBLIC_ALLOW_INDEXING is EXACTLY "true".
   * Set it only at the G1 go-live, in the deploy workflow. Any other value, or none, keeps the site out of search.
   */
  allowIndexing: import.meta.env.PUBLIC_ALLOW_INDEXING === 'true',
} as const;
