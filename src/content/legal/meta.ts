// Shared facts for all legal pages.

/**
 * "Last updated" date shown on every legal page (ISO calendar date, read as Asia/Kolkata). Change it whenever any legal text
 * changes. Format for display with formatDate() from src/lib/dates.ts.
 */
export const lastUpdated = '2026-10-21';

/**
 * The only external hosts a legal page may link to (tests/legal/links.test.ts). Each is an official source verified on
 * 2026-10-21 (see docs/m1/legal-notes.md). WhatsApp links are never written here: they come from waLink() at render time.
 */
export const ALLOWED_LINK_HOSTS: readonly string[] = [
  'www.youtube.com', // YouTube Terms of Service (https://www.youtube.com/t/terms) and the channel
  'policies.google.com', // Google Privacy Policy
  'www.cloudflare.com', // Cloudflare Privacy Policy (Turnstile and Web Analytics are Cloudflare's)
  'consumerhelpline.gov.in', // National Consumer Helpline (official)
  'www.ascionline.in', // ASCI influencer guidelines (official)
];

/** Internal paths a legal page may link to (the six legal pages plus pages other workers build). */
export const ALLOWED_INTERNAL_PATHS: readonly string[] = [
  '/privacy',
  '/terms',
  '/refunds',
  '/delivery',
  '/disclosures',
  '/content-removal',
  '/contact',
  '/pricing',
  '/request',
];

/** The official links the policies quote. Kept as constants so every page uses the same URL. */
export const LINKS = {
  youtubeTerms: 'https://www.youtube.com/t/terms',
  googlePrivacy: 'https://policies.google.com/privacy',
  cloudflarePrivacy: 'https://www.cloudflare.com/privacypolicy/',
  consumerHelpline: 'https://consumerhelpline.gov.in/',
  asciGuidelines: 'https://www.ascionline.in/social/wp-content/uploads/2025/04/ASCI-Influencer-Guidelines.pdf',
} as const;
