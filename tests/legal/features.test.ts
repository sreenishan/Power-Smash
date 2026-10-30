// Review finding C-11: a legal page may say only what is TRUE on the day it is published.
//
// Wording about a feature that does not exist at G1 (a one-time code, the YouTube player, player pages, sponsor banners, ...) or
// about a practice the owner has not confirmed lives in a `futureWording` block (privacyFuture, termsFuture, disclosuresFuture,
// contentRemovalFuture) and reaches a page only when its flag in src/content/legal/status.ts is true. These tests prove:
//   1. with every flag off, NONE of the gated words appear on any page or in a consent text shown at G1;
//   2. switching ONE flag on adds exactly its words (and the other flags' words stay out);
//   3. every flag is real, documented, and changes at least one page;
//   4. the Telegram sentence is true for the default (no phone, no email, no free text) and changes only with its flag (S-5, C-4).
import { describe, expect, it } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { contentRemovalFuture } from '../../src/content/legal/contentRemoval';
import { disclosuresFuture } from '../../src/content/legal/disclosures';
import { buildLegalDocs, legalDocs } from '../../src/content/legal';
import { docWording } from '../../src/content/legal/model';
import { privacyFuture } from '../../src/content/legal/privacy';
import { FEATURE_INFO, FEATURE_NAMES, analyticsTokenIsValid, features, type FeatureName, type LegalFeatures } from '../../src/content/legal/status';
import { termsFuture } from '../../src/content/legal/terms';
import { ALL_OFF, ALL_ON, only, readRepoFile } from './helpers';
import { LEGAL_FACT_NAMES } from '../../src/content/legal/facts';

/** Words that must be on a page ONLY while the flag is on. Every flag needs an entry (the type forces it). */
const PROBES: Record<FeatureName, RegExp[]> = {
  youtubeApiData: [/uses YouTube API Services/, /Google Privacy Policy/],
  youtubeEmbeds: [/loads from YouTube only after you tap to play/, /through YouTube's player/, /Video thumbnails come from YouTube/],
  archivePages: [/profile page/, /\bprotected\b/, /Match details by Power Smash/, /player, match and tournament pages/],
  competitionPages: [/"Protected player"/, /draws, order of play and results/, /not official BWF rankings/, /do not count towards our local rankings/, /entered by Power Smash/],
  requestVerification: [/one-time code/],
  ageProofChecks: [/age proof/i],
  emailAlerts: [/email alerts/i, /18 or older/],
  videoSubmissions: [/"send your video" form/, /Send us a video/],
  sponsorBanners: [/beside the video player/],
  sponsorLinkTracking: [/counts the click/, /sponsor or partner links/],
  paymentRecords: [/Payment records from the payment provider/],
  eventDocuments: [/Event documents are deleted 30 days after the event/],
  erasureLog: [/erasure log/],
  offsiteBackupCopy: [/cloud-storage/],
  coverageAgreementRequired: [/We do not start paid coverage without that agreement/],
  healthClaimsRule: [/health, injury-recovery or supplement claims/],
  telegramPhoneLink: [/reply link that contains the phone number/],
  cloudflareWebAnalytics: [/Cloudflare Web Analytics/, /page-view statistics/i],
};

const textOf = (f: LegalFeatures): string =>
  Object.values(buildLegalDocs(f))
    .flatMap((d) => docWording(d))
    .join('\n');

describe('every flag is real and documented', () => {
  it('has a probe, an info entry and a boolean value for every flag, and no extra ones', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...FEATURE_NAMES].sort());
    expect(Object.keys(FEATURE_INFO).sort()).toEqual([...FEATURE_NAMES].sort());
    for (const n of FEATURE_NAMES) {
      expect(typeof features[n]).toBe('boolean');
      expect(FEATURE_INFO[n].arrives.trim()).not.toBe('');
      expect(FEATURE_INFO[n].unlocks.trim()).not.toBe('');
    }
  });

  it('every key of every futureWording block is a real flag', () => {
    for (const block of [privacyFuture, termsFuture, disclosuresFuture, contentRemovalFuture]) {
      for (const key of Object.keys(block)) expect(FEATURE_NAMES, `${key} is not a flag in status.ts`).toContain(key);
    }
  });

  it('every flag changes at least one page when it is switched on', () => {
    const base = textOf(ALL_OFF);
    for (const n of FEATURE_NAMES) expect(textOf(only(n)), `${n} changes nothing`).not.toBe(base);
  });
});

describe('the G1 re-read checklist lists every switch and every optional fact', () => {
  const doc = readRepoFile('docs/legal/G1_REREAD_CHECKLIST.md');

  it.each(FEATURE_NAMES)('switch %s is in docs/legal/G1_REREAD_CHECKLIST.md', (n) => {
    expect(doc).toContain('`' + n + '`');
  });

  it.each(LEGAL_FACT_NAMES)('fact %s is in the checklist section on optional owner text', (n) => {
    expect(doc).toContain(n);
  });
});

describe('with every later feature off, none of their words reach a page (finding C-11)', () => {
  const off = textOf(ALL_OFF);

  it.each(FEATURE_NAMES)('%s: absent', (n) => {
    for (const re of PROBES[n]) expect(off, `"${re}" (flag ${n}) is on a G1 page`).not.toMatch(re);
  });

  it('the one-time code, YouTube API Services, the video player notice and player pages are not mentioned at all', () => {
    for (const re of [/one-time code/i, /YouTube API/i, /tap to play/i, /thumbnail/i, /protected player/i, /profile page/i]) {
      expect(off).not.toMatch(re);
    }
  });

  it('the consent texts shown at G1 mention none of the gated features either', () => {
    for (const c of [CONSENT.leadNotice, CONSENT.tournamentPublicContact]) {
      for (const n of FEATURE_NAMES) for (const re of PROBES[n]) expect(c.text, `${c.id} mentions ${n}`).not.toMatch(re);
    }
  });
});

describe('the pages as rendered now follow the flags in status.ts', () => {
  const now = Object.values(legalDocs)
    .flatMap((d) => docWording(d))
    .join('\n');

  it.each(FEATURE_NAMES)('%s: its words are on the live pages exactly when the flag is true', (n) => {
    for (const re of PROBES[n]) {
      if (features[n]) expect(now, `flag ${n} is on but "${re}" is missing`).toMatch(re);
      else expect(now, `flag ${n} is off but "${re}" is on a page`).not.toMatch(re);
    }
  });

  it('only the build-driven flag may be on today (every other flag is switched by the lead with the feature)', () => {
    for (const n of FEATURE_NAMES) {
      if (n === 'cloudflareWebAnalytics') continue;
      expect(features[n], `${n} is on: re-read the page against what is live and update docs/legal/G1_REREAD_CHECKLIST.md`).toBe(false);
    }
  });
});

describe('switching one flag on adds its words and nothing else of the others', () => {
  it.each(FEATURE_NAMES)('%s', (n) => {
    const t = textOf(only(n));
    for (const re of PROBES[n]) expect(t, `flag ${n}: "${re}" missing`).toMatch(re);
    for (const other of FEATURE_NAMES) {
      if (other === n) continue;
      for (const re of PROBES[other]) {
        // some phrases are legitimately shared (a link text appears under two flags); only flag a phrase no probe of `n` covers
        if (PROBES[n].some((p) => p.source === re.source)) continue;
        if (re.test(t)) {
          // allowed overlaps, written down on purpose
          const OVERLAP: Partial<Record<FeatureName, FeatureName[]>> = {
            youtubeEmbeds: ['youtubeApiData'], // both name the YouTube Terms and the Google Privacy Policy
            youtubeApiData: ['youtubeEmbeds'],
          };
          expect(OVERLAP[n] ?? [], `flag ${n} also brings in the words of ${other}: "${re}"`).toContain(other);
        }
      }
    }
  });

  it('the "YouTube views" sentence needs both the API flag and the archive flag', () => {
    const views = /"YouTube views"/;
    expect(textOf(only('youtubeApiData'))).not.toMatch(views);
    expect(textOf(only('archivePages'))).not.toMatch(views);
    expect(textOf({ ...ALL_OFF, youtubeApiData: true, archivePages: true })).toMatch(views);
  });

  it('either YouTube flag brings in the Terms sentence that users agree to be bound by the YouTube Terms of Service (III.A.1)', () => {
    const terms = (f: LegalFeatures) => docWording(buildLegalDocs(f).terms).join('\n');
    const bound = /agree to be bound by the YouTube Terms of Service/;
    expect(terms(ALL_OFF)).not.toMatch(bound);
    expect(terms(only('youtubeApiData'))).toMatch(bound);
    expect(terms(only('youtubeEmbeds'))).toMatch(bound);
  });

  it('every flag on together still reads as one plain document set', () => {
    const t = textOf(ALL_ON);
    for (const n of FEATURE_NAMES) for (const re of PROBES[n]) expect(t, `${n}: "${re}"`).toMatch(re);
  });
});

describe('the owner alert sentence is true for the default (R-TELEGRAM-PHONE, S-5, C-4)', () => {
  const privacy = (f: LegalFeatures) => docWording(buildLegalDocs(f).privacy).join('\n');

  it('by default an alert carries no phone number, no email address and no free text', () => {
    const t = privacy(ALL_OFF);
    expect(t).toMatch(/An alert carries the kind of enquiry, a reference code, a first name or initial and the page you used\./);
    expect(t).toMatch(/It does not carry your phone number, email address or the text you typed\./);
    expect(t).not.toMatch(/district/i); // the default alert no longer names a district
    expect(t).not.toMatch(/reply link/i);
  });

  it('the reply-link sentence appears only behind features.telegramPhoneLink', () => {
    const t = privacy(only('telegramPhoneLink'));
    expect(t).toMatch(/a reply link that contains the phone number you gave us/);
    expect(t).toMatch(/does not carry your email address or the text you typed/);
    expect(t).not.toMatch(/It does not carry your phone number/);
  });

  it('the flag is off in the repository', () => {
    expect(features.telegramPhoneLink).toBe(false);
  });
});

describe('page-view statistics follow the build (analytics token)', () => {
  it('analyticsTokenIsValid is the same test as the beacon component', () => {
    expect(analyticsTokenIsValid('abcdefghij0123456789')).toBe(true);
    expect(analyticsTokenIsValid('  abcdefghij0123456789  ')).toBe(true);
    expect(analyticsTokenIsValid('short')).toBe(false);
    expect(analyticsTokenIsValid('abcdefghij012345678"><script>')).toBe(false);
    expect(analyticsTokenIsValid('a'.repeat(65))).toBe(false);
    expect(analyticsTokenIsValid(undefined)).toBe(false);
    expect(analyticsTokenIsValid(null)).toBe(false);
  });

  it('the Privacy Policy mentions page-view statistics only when the flag is on', () => {
    const text = (f: LegalFeatures) => docWording(buildLegalDocs(f).privacy).join('\n');
    expect(text(ALL_OFF)).not.toMatch(/Cloudflare Web Analytics|page-view statistics|count page views/i);
    expect(text(only('cloudflareWebAnalytics'))).toMatch(/We count page views with Cloudflare Web Analytics/);
  });
});
