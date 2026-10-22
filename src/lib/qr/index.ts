// QR posters (spec 9.4, M3): PURE functions. A target URL with UTM tags, and an SVG QR code of it. No network, no DOM, no canvas.
//
//   buildQrTarget(...)   -> `https://site/tournaments/<slug>/?utm_source=qr&utm_medium=venue&utm_campaign=<slug>`, or null
//   qrMatrix(text)       -> the module matrix at error correction level M (about 15% of the code can be damaged and still scan)
//   qrSvg(text, options) -> a self-contained SVG string: a white background and one black path, no script, no external reference
//
// The slug is an allow-list value (lowercase letters, digits, hyphens; the tournament slug rule of spec 6.3), so nothing the owner
// types can add a parameter, a path or a fragment to the address in the QR code. The UTM values are built with URLSearchParams.
import { create } from 'qrcode/lib/core/qrcode.js';
import { POSTER_SLUG_PATTERN, absoluteUrl } from '../urls';

export const QR_ERROR_CORRECTION = 'M' as const;
/** Quiet zone in modules. The QR specification asks for 4; scanners need it. */
export const QR_QUIET_ZONE = 4;
export const QR_UTM = { source: 'qr', medium: 'venue' } as const;
/** The slug of the generic channel poster. A tournament may not use it. */
export const CHANNEL_POSTER_SLUG = 'channel';

/** True for a slug that may become a poster address and a utm_campaign value. */
export function isPosterSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && POSTER_SLUG_PATTERN.test(value);
}

export type SiteOriginCheck =
  | { ok: true; origin: string; local: boolean }
  | { ok: false; reason: 'missing' | 'invalid' | 'not-https' | 'has-path' };

/** Hosts that mean "this computer": a QR printed with one of them could never work for anybody else. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h === '::1' || h.endsWith('.local');
}

/**
 * The origin to put in a QR code, from PUBLIC_SITE_URL. https only, no path, query, fragment or login. `local` is true for a
 * local address (allowed to PREVIEW a poster in the developer build, never to print: the strict build treats it as missing).
 * `allowLocalHttp` lets the developer build use http://localhost.
 */
export function checkSiteOrigin(raw: string | null | undefined, options: { allowLocalHttp?: boolean } = {}): SiteOriginCheck {
  const text = (raw ?? '').trim();
  if (text === '') return { ok: false, reason: 'missing' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const local = isLocalHost(url.hostname);
  if (url.protocol !== 'https:' && !(options.allowLocalHttp && local && url.protocol === 'http:')) return { ok: false, reason: 'not-https' };
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '/' && url.pathname !== '')) {
    return { ok: false, reason: 'has-path' };
  }
  return { ok: true, origin: url.origin, local };
}

/** Which page the QR code opens. */
export type QrDestination = { kind: 'tournament'; slug: string } | { kind: 'channel' };

/**
 * `https://<origin>/tournaments/<slug>/?utm_source=qr&utm_medium=venue&utm_campaign=<slug>` (or the home page for the channel
 * poster, campaign `channel`). Null when the origin or the slug is not acceptable. The path goes through absoluteUrl() (R-LINKS).
 */
export function buildQrTarget(origin: string, destination: QrDestination): string | null {
  const campaign = destination.kind === 'channel' ? CHANNEL_POSTER_SLUG : destination.slug;
  if (!isPosterSlug(campaign)) return null;
  const check = checkSiteOrigin(origin, { allowLocalHttp: true });
  if (!check.ok) return null;
  const page = destination.kind === 'channel' ? '/' : `/tournaments/${campaign}/`;
  const url = new URL(absoluteUrl(page, check.origin));
  url.searchParams.set('utm_source', QR_UTM.source);
  url.searchParams.set('utm_medium', QR_UTM.medium);
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}

export interface QrMatrix {
  readonly size: number;
  readonly version: number;
  readonly ecLevel: typeof QR_ERROR_CORRECTION;
  /** true = dark module. rows[y][x]. */
  readonly rows: readonly (readonly boolean[])[];
}

/** The module matrix of `text` at error correction level M. Throws when the text does not fit (about 2,300 bytes at level M). */
export function qrMatrix(text: string): QrMatrix {
  const symbol = create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const size = symbol.modules.size;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x += 1) row.push(symbol.modules.get(y, x) === 1);
    rows.push(row);
  }
  return { size, version: symbol.version, ecLevel: QR_ERROR_CORRECTION, rows };
}

export interface QrSvgOptions {
  /** Accessible name (an SVG <title> and aria-label). Letters, digits, spaces and basic punctuation only; anything else is dropped. */
  label?: string;
  /** Quiet zone in modules (default 4). */
  quietZone?: number;
}

const LABEL_SAFE = /[^\p{L}\p{N} .,:'()-]/gu;
const cleanLabel = (raw: string): string => raw.replace(LABEL_SAFE, '').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * The SVG for a matrix: viewBox in module units (so it scales to any print size), `shape-rendering="crispEdges"`, a white background
 * and ONE black path made of horizontal runs ("M x y h w v1 h-w z"). Pure data: no script, no style, no link, no font.
 */
export function svgFromMatrix(matrix: QrMatrix, options: QrSvgOptions = {}): string {
  const quiet = Math.max(0, Math.floor(options.quietZone ?? QR_QUIET_ZONE));
  const total = matrix.size + quiet * 2;
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y += 1) {
    const row = matrix.rows[y]!;
    let x = 0;
    while (x < matrix.size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < matrix.size && row[end]) end += 1;
      parts.push(`M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  }
  const label = cleanLabel(options.label ?? 'QR code');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<title>${label}</title>` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${parts.join('')}"/>` +
    `</svg>`
  );
}

/** SVG QR code for `text` (error correction level M). */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
  return svgFromMatrix(qrMatrix(text), options);
}

/** Read an SVG made by svgFromMatrix back into dark/light modules (used by the round-trip test and nothing else). */
export function matrixFromSvg(svg: string, size: number, quietZone = QR_QUIET_ZONE): boolean[][] {
  const d = /<path fill="#000000" d="([^"]*)"/.exec(svg)?.[1] ?? '';
  const rows: boolean[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const x = Number(m[1]) - quietZone;
    const y = Number(m[2]) - quietZone;
    for (let i = 0; i < Number(m[3]); i += 1) rows[y]![x + i] = true;
  }
  return rows;
}
