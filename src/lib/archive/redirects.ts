// Redirect rules for the archive (review C2-1, D-009, SA-M32). A static page that is gone simply 404s, so moved, merged, protected and
// removed addresses must be answered by a rule. On Vercel the rules become `routes` entries in .vercel/output/config.json
// (src/lib/infra/vercel-routes.ts buildRedirectRoutes; scripts/finalize-headers.ts inserts them). Every route counts towards Vercel's
// 2,048 per deployment (header rules take about 10), so the D-009 release line of 1,800 stays. Statuses allowed: 301, 302, 303, 307, 308:
// there is NO 410. So "gone" is a 301 to the neutral page /matches/gone/ (noindex, no names), the closest a static build can get to
// removal; a true 410 needs an on-demand route (open owner/lead decision, docs/m2/schema-notes.md).
//
// Safety rules (D-012):
//  - this is a PURE function; the build step scripts/write-archive-redirects.mjs writes its output to tmp/archive-redirects.json (never served);
//    the rules end up in config.json routes, which are not a public file, so an old protected slug in a rule is not listed anywhere;
//  - a rule target is always a page that exists in THIS build (or the gone page): a protected player is only ever the opaque slug;
//  - chains are flattened, loops and self-redirects dropped, a target that is not a live page becomes the gone page.
import type { PublicArchive } from './model';
import type { RawArchive } from './provider';

export const GONE_PATH = '/matches/gone/';
export const REDIRECTS_MAX_LINES = 1800; // D-009 release line; Vercel's cap is 2,048 routes per deployment, shared with the header rules
export const REDIRECTS_HARD_STATIC = 2048;
export const REDIRECT_MAX_LINE = 1000;

export interface RedirectRule {
  from: string;
  to: string;
  status: 301;
}

export interface RedirectsResult {
  rules: RedirectRule[];
  text: string;
  /** Rules dropped on purpose (invalid path, loop, duplicate), as plain sentences. */
  skipped: string[];
  /** Errors that must fail the build (over a limit). */
  errors: string[];
}

const SAFE_PATH = /^\/[a-z0-9][a-z0-9/_-]*\/$/;

/** Every page path of this build that a redirect may point at. */
export function livePaths(archive: Pick<PublicArchive, 'matches' | 'players' | 'minimalPlayers' | 'tournaments'>, tournamentPagesBuilt = false): Set<string> {
  const live = new Set<string>([GONE_PATH, '/', '/matches/', '/players/', '/tournaments/']);
  for (const m of archive.matches) live.add(`/matches/${m.slug}/`);
  for (const p of archive.players) live.add(`/players/${p.slug}/`);
  for (const p of archive.minimalPlayers) live.add(`/players/${p.slug}/`);
  if (tournamentPagesBuilt) for (const t of archive.tournaments) live.add(`/tournaments/${t.slug}/`);
  return live;
}

export function buildRedirects(
  archive: PublicArchive,
  raw: Pick<RawArchive, 'redirects' | 'gonePaths'>,
  options: { tournamentPagesBuilt?: boolean } = {},
): RedirectsResult {
  const live = livePaths(archive, options.tournamentPagesBuilt ?? false);
  const skipped: string[] = [];
  // 1) the raw edges: provider 301 rows, superseded stored slugs, private gone paths.
  const edges = new Map<string, string | null>();
  const add = (from: string, to: string | null) => {
    if (!SAFE_PATH.test(from)) {
      skipped.push(`Skipped a source that is not a plain page path.`);
      return;
    }
    if (to !== null && !SAFE_PATH.test(to) && to !== '/') {
      skipped.push(`Skipped ${from}: its target is not a plain page path.`);
      to = null;
    }
    if (!edges.has(from)) edges.set(from, to);
  };
  for (const r of raw.redirects ?? []) add(r.from, r.to);
  for (const s of archive.superseded) add(s.from, s.to);
  for (const g of raw.gonePaths ?? []) add(g, null);

  // 2) flatten: follow to a live page; anything else (null, loop, dead end) means gone.
  const resolve = (from: string): string => {
    const seen = new Set<string>([from]);
    let at = edges.get(from) ?? null;
    while (at !== null) {
      if (live.has(at) && !edges.has(at)) return at; // a live page that is not itself a source
      if (seen.has(at)) return GONE_PATH; // loop
      seen.add(at);
      if (!edges.has(at)) return GONE_PATH; // a dead end that is not a live page
      at = edges.get(at) ?? null;
    }
    return GONE_PATH;
  };
  const rules: RedirectRule[] = [];
  for (const from of [...edges.keys()].sort()) {
    // A live page is never redirected away (a stale row must not take a real page down).
    if (live.has(from)) {
      skipped.push(`Skipped ${from}: a live page already has this address.`);
      continue;
    }
    const to = resolve(from);
    if (to === from) continue;
    rules.push({ from, to, status: 301 });
  }

  const lines = rules.map((r) => `${r.from} ${r.to} ${r.status}`);
  const errors: string[] = [];
  if (lines.length > REDIRECTS_MAX_LINES) errors.push(`Redirects would hold ${lines.length} rules; the release limit is ${REDIRECTS_MAX_LINES} (Vercel allows ${REDIRECTS_HARD_STATIC} routes per deployment, header rules included). Move the oldest rules to an on-demand lookup.`);
  if (lines.some((l) => l.length > REDIRECT_MAX_LINE)) errors.push(`A redirect line is longer than ${REDIRECT_MAX_LINE} characters.`);
  const header = '# Generated by scripts/write-archive-redirects.mjs. Do not edit.\n';
  return { rules, skipped, errors, text: lines.length === 0 ? header : `${header}${lines.join('\n')}\n` };
}
