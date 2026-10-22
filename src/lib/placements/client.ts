// The browser script behind <PlacementSlot> (D-031, spec 8.3). ONE small module, bundled by Astro into a first-party file; it
// replaces any inline script, so the CSP needs no new hash.
//
// What it does: fetch `/api/placements` once, pick the creative for today's date in India with the shared resolver, draw it into
// the reserved box (DOM calls only, never markup built from data), and report an impression when a slot has been at least 50% visible for one second.
// Impressions are queued and sent in ONE batched beacon when the page is hidden or closed. Nothing is stored in the browser, no cookie,
// no identifier; the server derives a daily-salted pseudonym itself.
import { istDateOf, resolveSlot } from './schedule';
import type { Placement } from './schedule';
import { placementsFromPublic } from './public';
import type { PublicSchedule } from './public';
import { MIN_VISIBLE_MS } from './beacon-constants';
import { isSlotKey } from './slots';

export interface BeaconItem {
  id: string;
  slot: string;
  ms: number;
}

/** The JSON body of the beacon (see beacon.ts `beaconSchema`). */
export function buildBeaconBody(token: string, path: string, items: readonly BeaconItem[]): string {
  return JSON.stringify({ v: 1, tok: token, path, items: items.slice(0, 8) });
}

/** The mobile creative below 768 px, else the desktop one; either falls back to the other. */
export function pickCreative(p: Pick<Placement, 'creativeDesktopPath' | 'creativeMobilePath'>, mobile: boolean): string | null {
  return (mobile ? p.creativeMobilePath ?? p.creativeDesktopPath : p.creativeDesktopPath ?? p.creativeMobilePath) ?? null;
}

const isHttps = (u: string | null): u is string => typeof u === 'string' && u.startsWith('https://');

/** Only a well-formed payload is used; anything else shows nothing. */
export function parseSchedule(json: unknown): PublicSchedule | null {
  if (!json || typeof json !== 'object') return null;
  const s = json as Partial<PublicSchedule>;
  if (s.v !== 1 || !Array.isArray(s.placements)) return null;
  const ok = s.placements.filter(
    (p) => p && typeof p.id === 'string' && isSlotKey(p.slot) && typeof p.href === 'string' && /^\/go\/[a-z0-9-]+$/.test(p.href) && typeof p.alt === 'string' && typeof p.start === 'string' && typeof p.end === 'string' && typeof p.priority === 'number',
  );
  return { v: 1, today: String(s.today ?? ''), placements: ok };
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawPlacement(doc: Document, p: Placement, mobile: boolean, form: string): HTMLElement | null {
  const src = pickCreative(p, mobile);
  const a = el(doc, 'a', { href: `/go/${p.goSlug}`, rel: 'sponsored nofollow noopener', target: '_blank', class: 'ps-slot-link' });
  if (form === 'title') {
    a.textContent = p.headline && p.headline !== '' ? p.headline : p.alt;
    return a;
  }
  if (!isHttps(src)) return null;
  a.appendChild(el(doc, 'img', { src, alt: p.alt, loading: 'lazy', decoding: 'async', class: 'ps-slot-img' }));
  a.appendChild(el(doc, 'span', { class: 'sr-only' }, ' (opens in a new tab)'));
  return a;
}

export interface InitOptions {
  doc?: Document;
  fetchFn?: typeof fetch;
  now?: () => Date;
  isMobile?: () => boolean;
}

export async function initPlacementSlots(options: InitOptions = {}): Promise<void> {
  const doc = options.doc ?? document;
  const roots = Array.from(doc.querySelectorAll<HTMLElement>('[data-placement-slot]'));
  if (roots.length === 0) return;
  const now = options.now ?? (() => new Date());
  const mobile = (options.isMobile ?? (() => window.matchMedia('(max-width: 767px)').matches))();
  const token = roots[0]?.dataset.beaconToken ?? '';

  let schedule: Placement[] = [];
  try {
    const res = await (options.fetchFn ?? fetch)('/api/placements', { credentials: 'omit', headers: { accept: 'application/json' } });
    if (res.ok) {
      const parsed = parseSchedule(await res.json());
      if (parsed) schedule = placementsFromPublic(parsed);
    }
  } catch {
    // no schedule: every slot shows its empty state
  }
  const today = istDateOf(now());

  const pending: BeaconItem[] = [];
  const queued = new Set<string>();
  let sent = false;
  const flush = (): void => {
    if (sent || pending.length === 0 || token === '') return;
    sent = true;
    const body = buildBeaconBody(token, window.location.pathname, pending);
    try {
      if (!navigator.sendBeacon('/api/placement-beacon', new Blob([body], { type: 'text/plain' }))) throw new Error('beacon refused');
    } catch {
      void fetch('/api/placement-beacon', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' }, credentials: 'omit' }).catch(() => undefined);
    }
  };
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const node = entry.target as HTMLElement;
              const timer = (node as HTMLElement & { _psTimer?: number })._psTimer;
              if (timer !== undefined) {
                window.clearTimeout(timer);
                (node as HTMLElement & { _psTimer?: number })._psTimer = undefined;
              }
              if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
              (node as HTMLElement & { _psTimer?: number })._psTimer = window.setTimeout(() => {
                const ids = (node.dataset.placementIds ?? '').split(',').filter(Boolean);
                for (const id of ids) {
                  if (queued.has(id)) continue;
                  queued.add(id);
                  pending.push({ id, slot: node.dataset.placementSlot ?? '', ms: MIN_VISIBLE_MS });
                }
                observer?.unobserve(node);
              }, MIN_VISIBLE_MS);
            }
          },
          { threshold: [0.5] },
        )
      : null;

  for (const root of roots) {
    const slot = root.dataset.placementSlot ?? '';
    const form = root.dataset.slotForm ?? 'banner';
    const holder = root.querySelector<HTMLElement>('[data-slot-content]') ?? root;
    if (!isSlotKey(slot)) continue;
    const chosen = resolveSlot(schedule, { slot, date: today, scopeKey: root.dataset.scope || null });
    const drawn: Placement[] = [];
    holder.textContent = '';
    for (const p of chosen) {
      const node = drawPlacement(doc, p, mobile, form);
      if (!node) continue;
      if (form === 'strip') {
        const li = el(doc, 'li', { class: 'ps-slot-item' });
        li.appendChild(node);
        holder.appendChild(li);
      } else {
        holder.appendChild(node);
      }
      drawn.push(p);
    }
    if (drawn.length === 0) {
      root.dataset.state = 'empty';
      if (form === 'banner') {
        const href = root.dataset.houseHref ?? '';
        if (href.startsWith('/')) holder.appendChild(el(doc, 'a', { href, class: 'ps-slot-house' }, 'Partner with Power Smash'));
      } else {
        root.hidden = true;
      }
      continue;
    }
    root.dataset.state = 'filled';
    root.dataset.placementIds = drawn.map((p) => p.id).join(',');
    const label = root.querySelector<HTMLElement>('[data-slot-label]');
    if (label) {
      // Always labelled (spec 15.5): a strip says "Partners" unless every logo is a paid "Sponsored" one.
      const allSponsored = drawn.every((p) => p.label === 'Sponsored');
      label.textContent = form === 'strip' ? (allSponsored ? 'Sponsored' : 'Partners') : (drawn[0]?.label ?? 'Sponsored');
      label.hidden = false;
    }
    observer?.observe(root);
  }
}
