/**
 * Input readers for the catalogue profiler. Accepted (auto-detected, see docs/PROFILING.md):
 *  1. JSON: an array of strings; an array of objects; or an object with `items` (a YouTube videos.list / playlistItems.list page,
 *     or an array of such pages). Objects may be YouTube-shaped (`snippet.title`, `contentDetails.duration`, `status`,
 *     `liveStreamingDetails`) or the sync's VideoRecord shape (`title_raw`, `duration_s`, `published_at`, `type`), or `{title}`.
 *  2. Plain text: one title per line.
 *  3. CSV (a `.csv` file name): a header row with a column whose name contains "title"; optional columns picked by NAME
 *     (id, duration, publish/published). A one-column CSV without such a header is read as titles.
 *  4. YouTube channel RSS (Atom) XML: the 15 newest videos (`<yt:videoId>`, `<title>`, `<published>`, `/shorts/` link).
 *  5. Google Takeout "videos" CSV: read by the same header-name rule as (3). The exact Takeout column names were NOT verified
 *     against official documentation (no network when this was written); the reader prints the columns it chose, and fails
 *     loudly if it cannot find a title column instead of guessing.
 * Nothing here touches the network.
 */
import { parseIsoDuration } from '../youtube/client';

export type InputItem = {
  id: string | null;
  title: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  playlist: 'UUSH' | 'UULF' | 'UULV' | null;
  rssLinkType: 'shorts' | 'watch' | null;
  liveBroadcastContent: 'none' | 'upcoming' | 'live' | null;
  hasLiveStreamingDetails: boolean;
};

export type InputResult = {
  format: 'json' | 'text' | 'csv' | 'rss';
  items: InputItem[];
  /** Entries skipped (no title, private or retired). */
  skipped: number;
  notes: string[];
};

const blank = (title: string): InputItem => ({
  id: null, title, durationSeconds: null, publishedAt: null, playlist: null, rssLinkType: null, liveBroadcastContent: null, hasLiveStreamingDetails: false,
});

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function fromObject(o: Obj): InputItem | 'skip' {
  const snippet = isObj(o.snippet) ? o.snippet : null;
  const title = str(o.title_raw) ?? str(snippet?.title) ?? str(o.title);
  if (title === null || title === '') return 'skip';
  const status = isObj(o.status) ? o.status : null;
  if (status?.privacyStatus === 'private') return 'skip';
  const item = blank(title);
  const content = isObj(o.contentDetails) ? o.contentDetails : null;
  const resource = snippet !== null && isObj(snippet.resourceId) ? snippet.resourceId : null;
  item.id = str(o.youtube_id) ?? str(o.id) ?? str(content?.videoId) ?? str(resource?.videoId);
  const iso = str(content?.duration);
  item.durationSeconds = num(o.duration_s) ?? (iso !== null ? parseIsoDuration(iso) : null);
  item.publishedAt = str(o.published_at) ?? str(snippet?.publishedAt) ?? str(content?.videoPublishedAt);
  const lbc = str(snippet?.liveBroadcastContent);
  if (lbc === 'none' || lbc === 'live' || lbc === 'upcoming') item.liveBroadcastContent = lbc;
  item.hasLiveStreamingDetails = o.liveStreamingDetails !== undefined || o.was_live === true;
  const type = str(o.type);
  if (type === 'short') item.playlist = 'UUSH';
  else if (type === 'live') item.playlist = 'UULV';
  else if (type === 'match') item.playlist = 'UULF';
  if (str(o.rss_link_type) === 'shorts') item.rssLinkType = 'shorts';
  const ls = str(o.live_status);
  if (ls === 'live' || ls === 'upcoming') item.liveBroadcastContent = ls;
  return item;
}

function walkJson(value: unknown, out: InputItem[], skipped: { n: number }): void {
  if (Array.isArray(value)) {
    for (const v of value) walkJson(v, out, skipped);
    return;
  }
  if (typeof value === 'string') {
    if (value.trim() === '') skipped.n++;
    else out.push(blank(value));
    return;
  }
  if (!isObj(value)) {
    skipped.n++;
    return;
  }
  if (Array.isArray(value.items) && value.snippet === undefined && value.title_raw === undefined) {
    walkJson(value.items, out, skipped);
    return;
  }
  const item = fromObject(value);
  if (item === 'skip') skipped.n++;
  else out.push(item);
}

export function readJson(text: string): InputResult {
  const data: unknown = JSON.parse(text.replace(/^﻿/u, ''));
  const items: InputItem[] = [];
  const skipped = { n: 0 };
  walkJson(data, items, skipped);
  return { format: 'json', items, skipped: skipped.n, notes: [] };
}

export function readLines(text: string): InputResult {
  const lines = text.replace(/^﻿/u, '').split(/\r?\n/u);
  const items = lines.filter((l) => l.trim() !== '').map((l) => blank(l));
  return { format: 'text', items, skipped: 0, notes: [] };
}

/** RFC 4180 CSV reader (quotes, doubled quotes, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/u, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function pickColumn(header: string[], test: (h: string) => boolean, prefer?: (h: string) => number): number {
  const idx = header.map((h, i) => [h.trim().toLowerCase(), i] as const).filter(([h]) => test(h));
  if (idx.length === 0) return -1;
  if (prefer) idx.sort((a, b) => prefer(b[0]) - prefer(a[0]));
  return (idx[0] as readonly [string, number])[1];
}

export function readCsv(text: string): InputResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { format: 'csv', items: [], skipped: 0, notes: ['The CSV file is empty.'] };
  const header = rows[0] as string[];
  const titleCol = pickColumn(header, (h) => h.includes('title') && !h.includes('translated'), (h) => (h.includes('original') ? 2 : 1));
  let titleIdx = titleCol;
  let body = rows.slice(1);
  const notes: string[] = [];
  if (titleIdx < 0) {
    if (header.length === 1) {
      titleIdx = 0;
      body = rows; // no header row
      notes.push('One-column CSV with no "title" header: every row is read as a title.');
    } else {
      throw new Error(
        `No column with "title" in its name. Columns found: ${header.map((h) => `"${h}"`).join(', ')}. Add a "title" header or use a text file.`,
      );
    }
  }
  const idCol = pickColumn(header, (h) => h === 'id' || h === 'video id' || h === 'video_id' || h === 'youtube_id');
  const durCol = pickColumn(header, (h) => h.includes('duration'));
  const pubCol = pickColumn(header, (h) => h.includes('publish') && !h.includes('privacy'));
  const durHeader = durCol >= 0 ? (header[durCol] as string).toLowerCase() : '';
  const msUnit = /\bms\b|millisecond/u.test(durHeader);
  if (titleCol >= 0) {
    notes.push(
      `Columns used: title="${header[titleIdx]}"${idCol >= 0 ? `, id="${header[idCol]}"` : ''}${
        durCol >= 0 ? `, duration="${header[durCol]}" (${msUnit ? 'milliseconds' : 'seconds'})` : ''
      }${pubCol >= 0 ? `, published="${header[pubCol]}"` : ''}.`,
    );
  }
  const items: InputItem[] = [];
  let skipped = 0;
  for (const r of body) {
    const t = r[titleIdx];
    if (t === undefined || t.trim() === '') {
      skipped++;
      continue;
    }
    const item = blank(t);
    if (idCol >= 0) item.id = r[idCol] || null;
    const dur = durCol >= 0 ? r[durCol] : undefined;
    if (dur !== undefined && /^\d+(\.\d+)?$/u.test(dur.trim())) {
      const v = Number(dur);
      item.durationSeconds = Math.round(msUnit ? v / 1000 : v);
    }
    const pub = pubCol >= 0 ? r[pubCol] : undefined;
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) item.publishedAt = d.toISOString();
    }
    items.push(item);
  }
  return { format: 'csv', items, skipped, notes };
}

const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/u, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (m, e: string) => {
      if (e[0] === '#') {
        const cp = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return XML_ENT[e.toLowerCase()] ?? m;
    });
}

/** YouTube channel feed (https://www.youtube.com/feeds/videos.xml?channel_id=...): the 15 newest entries. */
export function readRss(text: string): InputResult {
  const items: InputItem[] = [];
  let skipped = 0;
  for (const m of text.matchAll(/<entry\b[\s\S]*?<\/entry>/gu)) {
    const e = m[0];
    const title = /<title[^>]*>([\s\S]*?)<\/title>/u.exec(e)?.[1];
    if (title === undefined) {
      skipped++;
      continue;
    }
    const item = blank(xmlText(title.trim()));
    item.id = /<yt:videoId>([^<]+)<\/yt:videoId>/u.exec(e)?.[1]?.trim() ?? null;
    item.publishedAt = /<published>([^<]+)<\/published>/u.exec(e)?.[1]?.trim() ?? null;
    const href = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/u.exec(e)?.[1] ?? /<link[^>]*href="([^"]+)"/u.exec(e)?.[1] ?? '';
    item.rssLinkType = href.includes('/shorts/') ? 'shorts' : 'watch';
    items.push(item);
  }
  return { format: 'rss', items, skipped, notes: ['RSS holds only the 15 newest videos: use it for a quick check, not for the DoD 1 number.'] };
}

export function readInput(text: string, fileName = ''): InputResult {
  const head = text.replace(/^﻿/u, '').trimStart();
  if (head.startsWith('<') && /<feed\b/u.test(head)) return readRss(text);
  if (head.startsWith('[') || head.startsWith('{')) return readJson(text);
  if (/\.csv$/iu.test(fileName)) return readCsv(text);
  return readLines(text);
}
