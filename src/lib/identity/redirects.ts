// Slug redirects: chain flattening on write and loop rejection (D-032 slug_redirects). PURE.
import type { RedirectType, SlugRedirect } from './types';

export type AddRedirectResult = { ok: true; redirects: SlugRedirect[] } | { ok: false; code: 'REDIRECT_LOOP' | 'SAME_SLUG' };

/**
 * Adds from -> to. Existing redirects that point at `from` are re-pointed at `to` (flattening), an existing entry for
 * `from` is replaced, and a redirect that would create a cycle is refused. `toSlug = null` with type 410 records "gone".
 */
export function addRedirect(existing: readonly SlugRedirect[], fromSlug: string, toSlug: string | null, type: RedirectType): AddRedirectResult {
  if (toSlug === fromSlug) return { ok: false, code: 'SAME_SLUG' };
  let target = toSlug;
  if (type === 301 && toSlug !== null) {
    // follow an existing chain from `to` so we never store a hop
    const seen = new Set<string>([fromSlug]);
    let cursor: string | null = toSlug;
    while (cursor !== null) {
      if (seen.has(cursor)) return { ok: false, code: 'REDIRECT_LOOP' };
      seen.add(cursor);
      const next: SlugRedirect | undefined = existing.find((r) => r.fromSlug === cursor && r.type === 301);
      if (!next) break;
      cursor = next.toSlug;
    }
    target = cursor;
  }
  const out: SlugRedirect[] = [];
  for (const r of existing) {
    if (r.fromSlug === fromSlug) continue;
    if (r.toSlug === fromSlug && r.type === 301) {
      out.push(type === 301 && target !== null ? { ...r, toSlug: target } : { fromSlug: r.fromSlug, toSlug: null, type: 410 });
    } else {
      out.push(r);
    }
  }
  out.push({ fromSlug, toSlug: type === 301 ? target : null, type });
  return { ok: true, redirects: out };
}

/** Emergency hide (D-014): delete the entity's redirect rows (both directions) and serve 410 for its slug. */
export function removeRedirectsFor(existing: readonly SlugRedirect[], slug: string): SlugRedirect[] {
  const kept = existing.filter((r) => r.fromSlug !== slug && r.toSlug !== slug);
  return [...kept, { fromSlug: slug, toSlug: null, type: 410 }];
}
