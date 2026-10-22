// Helpers for the Vercel header rules: hash the inline scripts and styles of built pages (the CSP needs them) and patch the route
// rules into `.vercel/output/config.json`. The route logic itself is PURE and lives in src/lib/infra/vercel-routes.ts. Replaces the
// Cloudflare `_headers` helpers (Vercel port, area B). Node 24 type stripping: type-annotation-only.
import { createHash } from 'node:crypto';
import { applyManagedRoutes, buildHeaderRoutes, buildRedirectRoutes, managedBlock } from '../../src/lib/infra/vercel-routes.ts';
import type { RedirectLike, VercelConfig } from '../../src/lib/infra/vercel-routes.ts';

export interface FinalizeOptions {
  csp: string;
  allowIndexing: boolean;
  hstsMaxAge: number | null;
  canonicalHost: string | null;
  noindexHostSuffixes: readonly string[];
  redirects?: readonly RedirectLike[];
}

/**
 * Finalise a Build Output config: put the managed header and redirect routes first, replacing an earlier managed block.
 * Idempotent; the result depends only on the options and the adapter's own routes.
 */
export function finalizeConfig(existing: VercelConfig, options: FinalizeOptions): VercelConfig {
  const block = managedBlock(
    buildHeaderRoutes({
      csp: options.csp,
      allowIndexing: options.allowIndexing,
      hstsMaxAge: options.hstsMaxAge,
      canonicalHost: options.canonicalHost,
      noindexHostSuffixes: options.noindexHostSuffixes,
    }),
    buildRedirectRoutes(options.redirects ?? []),
  );
  return applyManagedRoutes(existing, block);
}

// ---- inline code in built pages --------------------------------------------------------------------------------------

/** The CSP hash source for a piece of inline code, exactly as the browser computes it (over the text between the tags). */
export function cspHash(content: string, algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256'): string {
  return `'${algorithm}-${createHash(algorithm).update(content, 'utf8').digest('base64')}'`;
}

const EXECUTABLE_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'importmap']);

export interface InlineCode {
  scripts: string[];
  styles: string[];
  /** Inline event-handler attributes such as onclick: blocked by `script-src-attr 'none'`, so they must not exist. */
  eventHandlerAttributes: number;
  /** style="..." attributes: allowed through `style-src-attr 'unsafe-inline'`. */
  styleAttributes: number;
}

/** The attributes of one start tag as name (lower case) to value. Quoted values are skipped properly, so `data-src="x"` is not `src`. */
export function attributesOf(attrText: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(attrText)) !== null) {
    const name = (a[1] as string).toLowerCase();
    if (!out.has(name)) out.set(name, a[2] ?? a[3] ?? a[4] ?? '');
  }
  return out;
}

/** Inline executable scripts and style blocks of one HTML page (the exact text, for hashing). */
export function inlineCodeOf(html: string): InlineCode {
  const scripts: string[] = [];
  const styles: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = attributesOf(m[1] as string);
    if (attrs.has('src')) continue; // an external script (a data-src attribute is NOT src: review B-17)
    const t = (attrs.get('type') ?? '').trim().toLowerCase();
    if (!EXECUTABLE_SCRIPT_TYPES.has(t)) continue; // JSON-LD and other data blocks never run
    const body = m[2] as string;
    if (body.trim() !== '') scripts.push(body);
  }
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  while ((m = styleRe.exec(html)) !== null) {
    const body = m[1] as string;
    if (body.trim() !== '') styles.push(body);
  }
  const markup = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const eventHandlerAttributes = (markup.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) ?? []).length;
  const styleAttributes = (markup.match(/<[a-z][^>]*\sstyle\s*=/gi) ?? []).length;
  return { scripts, styles, eventHandlerAttributes, styleAttributes };
}
