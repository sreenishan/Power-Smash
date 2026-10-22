import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  enquiryHref,
  enquiryTarget,
  needsInclusionApproval,
  processSteps,
  productBySlug,
  productGroups,
  products,
  productsInGroup,
  promotionSummary,
  publicInclusions,
  type Inclusion,
  type Product,
} from '../../src/content/products';
import { PERIOD_LABEL, sponsorPackages } from '../../src/content/sponsor-packages';
import { site } from '../../src/content/site';
import { priceDisplay } from '../../src/lib/money';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const everything: readonly (Product | (typeof sponsorPackages)[number])[] = [...products, ...sponsorPackages];

// The only digits the spec's Appendix C inclusions contain ("1 camera", "2 cameras", "2-3 minute edit"). Nothing else may carry a number.
const ALLOWED_NUMBER_PHRASES = ['1 camera', '2 cameras', '2-3 minute'];

/** Every text of a product, INCLUDING the deferred inclusions (the data may keep them; the invariants apply to all of it). */
function textOf(p: { name: string; summary: string; inclusions: readonly Inclusion[] }): string[] {
  return [p.name, p.summary, ...p.inclusions.map((i) => i.text)];
}

describe('products data (DRAFT: nothing the owner has not supplied)', () => {
  it('every price is null (no default price anywhere)', () => {
    for (const p of everything) {
      expect(p.pricePaise, p.slug).toBeNull();
    }
  });

  it('inclusions are unapproved, GST is unknown, delivery time is unknown, quote wording is unapproved', () => {
    for (const p of everything) {
      expect(p.inclusionsApproved, p.slug).toBe(false);
      expect(p.gstInclusive, p.slug).toBeNull();
      expect(p.deliveryDays, p.slug).toBeNull();
      expect(p.quoteWordingApproved, p.slug).toBe(false);
    }
  });

  it('price type is one of fixed, starting_from or quote', () => {
    for (const p of everything) {
      expect(['fixed', 'starting_from', 'quote'], p.slug).toContain(p.priceType);
    }
  });

  it('with these data, every PriceTag decision is a Todo (so a strict build fails until the owner supplies prices)', () => {
    for (const p of everything) {
      expect(priceDisplay(p), p.slug).toEqual({ kind: 'todo' });
    }
  });

  it('has unique slugs that are URL-safe', () => {
    const slugs = everything.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('uses the Appendix C names', () => {
    expect(products.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Essential', 'Pro', 'Broadcast', 'Highlight reel', 'HD match file', 'Season pack', 'Custom edit', 'Tournament promotion']),
    );
    expect(sponsorPackages.map((p) => p.name)).toEqual(['Rally Partner', 'Court Partner', 'Coverage Partner', 'Title Partner']);
  });

  it('contains no invented money, tax or time figures', () => {
    for (const p of everything) {
      for (const text of textOf(p)) {
        expect(text, `${p.slug}: ${text}`).not.toMatch(/₹|\bRs\.?\s?\d|\bINR\b|%|\bGST\b|\bper cent\b|\bdiscount\b|\bfree\b/i);
        // every digit must belong to an allowed Appendix C phrase
        let remaining = text;
        for (const phrase of ALLOWED_NUMBER_PHRASES) remaining = remaining.split(phrase).join('');
        expect(remaining, `${p.slug}: ${text}`).not.toMatch(/\d/);
      }
    }
  });

  it('makes no promise about travel policy, delivery times or cancellation', () => {
    for (const p of everything) {
      for (const text of [p.summary, ...p.inclusions.map((i) => i.text)]) {
        expect(text, `${p.slug}: ${text}`).not.toMatch(/within|hours|working days|refund|cancel|guarantee|no travel|travel is included|free travel/i);
      }
    }
  });

  it('the custom edit is the only quote-type product (Appendix C.2)', () => {
    const quotes = products.filter((p) => p.priceType === 'quote').map((p) => p.slug);
    expect(quotes).toEqual(['custom-edit']);
  });

  it('suggests leading with Essential, Tournament promotion and Rally Partner only (D-024)', () => {
    expect(everything.filter((p) => p.suggestedLead).map((p) => p.slug).sort()).toEqual(['essential', 'rally-partner', 'tournament-promotion']);
  });

  it('every sponsor package has a billing period with wording (shown only next to a real price)', () => {
    for (const p of sponsorPackages) {
      expect(p.period, p.slug).not.toBeNull();
      expect(PERIOD_LABEL[p.period!]).toMatch(/^per /);
    }
  });

  it('does not list the Featured academy (it needs the Phase 2 academy directory)', () => {
    expect(everything.some((p) => /academy/i.test(p.name))).toBe(false);
  });
});

describe('product helpers', () => {
  it('groups products', () => {
    expect(productsInGroup('organizers').map((p) => p.slug)).toEqual(['essential', 'pro', 'broadcast']);
    expect(productsInGroup('addons')).toHaveLength(3);
    expect(productsInGroup('players').map((p) => p.slug)).toEqual(['highlight-reel', 'hd-match-file', 'season-pack', 'custom-edit']);
    expect(productsInGroup('promotion').map((p) => p.slug)).toEqual(['tournament-promotion']);
    expect(productGroups.map((g) => g.id)).toEqual(['organizers', 'addons', 'players', 'promotion']);
  });

  it('finds a product by slug', () => {
    expect(productBySlug('pro')?.name).toBe('Pro');
    expect(productBySlug('nope')).toBeUndefined();
  });

  it('flags unapproved inclusions only when a shown product has any PUBLIC ones', () => {
    expect(needsInclusionApproval(products)).toBe(true);
    expect(needsInclusionApproval(productsInGroup('players'))).toBe(false); // no inclusions listed for player products
    expect(needsInclusionApproval([{ inclusions: [{ text: 'x' }], inclusionsApproved: true }])).toBe(false);
    expect(needsInclusionApproval([{ inclusions: [{ text: 'x' }], inclusionsApproved: false }])).toBe(true);
    expect(needsInclusionApproval([{ inclusions: [], inclusionsApproved: false }])).toBe(false);
    // a product whose only inclusions are deferred shows nothing, so it has nothing to approve
    expect(needsInclusionApproval([{ inclusions: [{ text: 'x', availableFrom: 'M2' }], inclusionsApproved: false }])).toBe(false);
  });

  it('builds the enquiry links: coverage /book/?package, sponsors /partner/?package, everything else /contact/?topic (R-TOPIC)', () => {
    expect(enquiryHref({ slug: 'essential', group: 'organizers' })).toBe('/book/?package=essential');
    expect(enquiryHref({ slug: 'rally-partner', group: 'sponsorship' })).toBe('/partner/?package=rally-partner');
    expect(enquiryHref({ slug: 'highlight-reel', group: 'players' })).toBe('/contact/?topic=highlight-reel');
    expect(enquiryHref({ slug: 'tournament-promotion', group: 'promotion' })).toBe('/contact/?topic=tournament-promotion');
    expect(enquiryHref({ slug: 'extra-court', group: 'addons' })).toBe('/contact/?topic=extra-court');
    expect(enquiryTarget({ slug: 'pro', group: 'organizers' })).toEqual({ href: '/book/?package=pro', label: 'Book coverage' });
    expect(enquiryTarget({ slug: 'rally-partner', group: 'sponsorship' })).toEqual({ href: '/partner/?package=rally-partner', label: 'Partner with us' });
    expect(enquiryTarget({ slug: 'season-pack', group: 'players' })).toEqual({ href: '/contact/?topic=season-pack', label: 'Ask for this' });
  });

  it('encodes the key, so a slug can never add a second parameter or break out of the query', () => {
    expect(enquiryHref({ slug: 'a&b=c#d', group: 'players' })).toBe('/contact/?topic=a%26b%3Dc%23d');
  });

  it('keeps the process timeline in the spec order with no payment figures', () => {
    expect(processSteps.map((s) => s.title)).toEqual(['Enquire', 'Quote', 'Advance', 'Coverage day', 'Delivery', 'Balance']);
    for (const s of processSteps) expect(s.text).not.toMatch(/\d|%|₹|\bRs\b/);
  });
});

describe('R-ALLOWED-CLAIMS: public package text promises nothing that does not exist yet (review C-23)', () => {
  const court = sponsorPackages.find((p) => p.slug === 'court-partner')!;
  const title = sponsorPackages.find((p) => p.slug === 'title-partner')!;

  it('keeps the two inclusions in the data with an availableFrom marker', () => {
    const banners = court.inclusions.find((i) => /banners on player and match pages/i.test(i.text));
    const naming = title.inclusions.find((i) => /Power Smash Open naming rights/i.test(i.text));
    expect(banners?.availableFrom).toBe('M2');
    expect(naming?.availableFrom).toBe('Phase 3');
  });

  it('marks nothing else as deferred (so no other claim is dropped by accident)', () => {
    const deferred = everything.flatMap((p) => p.inclusions.filter((i) => i.availableFrom !== undefined).map((i) => i.text));
    expect(deferred.sort()).toEqual(['Banners on player and match pages', 'Power Smash Open naming rights']);
  });

  it('publicInclusions drops every marked line and keeps the rest in order', () => {
    expect(publicInclusions(court)).toEqual(['Everything in Rally Partner', 'Logo on uploads', 'Monthly report']);
    expect(publicInclusions(title)).toEqual(['Everything above', 'Priority placements']);
    expect(publicInclusions({ inclusions: [] })).toEqual([]);
    expect(publicInclusions({ inclusions: [{ text: 'a' }, { text: 'b', availableFrom: 'Phase 3' }, { text: 'c' }] })).toEqual(['a', 'c']);
  });

  it('no public list, summary or name mentions the deferred features', () => {
    for (const p of everything) {
      const publicText = [p.name, p.summary, ...publicInclusions(p)].join(' | ');
      expect(publicText, p.slug).not.toMatch(/banners? on player|match pages|naming rights|Power Smash Open/i);
    }
    expect(court.summary).not.toMatch(/banner/i);
  });

  it('names the WhatsApp Channel in the Tournament promotion summary only when the channel exists', () => {
    expect(promotionSummary(false)).toBe('Your pamphlet shared on the YouTube community tab, Instagram and Facebook, plus a featured listing until the event.');
    expect(promotionSummary(true)).toMatch(/WhatsApp Channel/);
    // the built product follows the owner's input: no channel link today, so no promise
    expect(productBySlug('tournament-promotion')?.summary).toBe(promotionSummary(Boolean(site.whatsappChannelUrl?.trim())));
  });

  it('no page or component reads .inclusions directly: they go through publicInclusions()', () => {
    const offenders: string[] = [];
    // The owner-only admin (src/admin) is not public site text: the price editor must show ALL inclusions, including ones that are
    // not offered yet, so the owner can edit them. Only public pages and components must go through publicInclusions().
    const ADMIN_DIR = join(ROOT, 'src', 'admin');
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (abs === ADMIN_DIR) continue;
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/\.(astro|tsx)$/.test(name)) {
          const text = readFileSync(abs, 'utf8')
            .split(/\r?\n/)
            .filter((line) => !line.trimStart().startsWith('//'))
            .join('\n');
          if (/\.inclusions\b/.test(text)) offenders.push(relative(ROOT, abs).replaceAll('\\', '/'));
        }
      }
    };
    walk(join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
