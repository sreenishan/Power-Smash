// Minimal PostgREST client over `fetch` for Worker endpoints (D-005): the SECRET key goes in the `apikey` header only
// (Supabase docs: "send publishable and secret keys on the apikey header, not on Authorization: Bearer", checked
// 2026-10-21, https://supabase.com/docs/guides/api/api-keys). Private tables are reachable only this way: they have no
// grants for anon or authenticated (supabase/migrations/0001_*).
//
// Errors NEVER carry the response body: PostgREST unique-violation `details` echo the conflicting values (phones,
// emails). Only the HTTP status, the Postgres error code and the constraint name are kept.

export class SupabaseError extends Error {
  readonly status: number;
  readonly pgCode: string | null;
  readonly constraint: string | null;
  constructor(status: number, pgCode: string | null, constraint: string | null) {
    super(`supabase_${status}${pgCode ? `_${pgCode}` : ''}`);
    this.name = 'SupabaseError';
    this.status = status;
    this.pgCode = pgCode;
    this.constraint = constraint;
  }
  get isUniqueViolation(): boolean {
    return this.pgCode === '23505';
  }
}

export interface SupabaseRestOptions {
  url: string;
  secretKey: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  /** Local development only (SUPABASE_ALLOW_LOCAL_URL=true): also accept http(s)://localhost, 127.0.0.1 or [::1]. */
  allowLocalUrl?: boolean;
}

/**
 * S-17: the SECRET key is sent to this URL, so it must be the project's own host: https and `<ref>.supabase.co` (one label),
 * no user info, no odd port, no path, no query. A typo such as http://<ref>.supabase.co or a look-alike host is refused.
 * With the explicit local-development override only, a loopback host over http or https is accepted too.
 */
export function isAcceptableSupabaseUrl(raw: string, allowLocal = false): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '' || (u.pathname !== '/' && u.pathname !== '')) return false;
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'https:' && (u.port === '' || u.port === '443') && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/.test(host)) return true;
  return allowLocal && (u.protocol === 'http:' || u.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
}

export type Row = Record<string, unknown>;

export interface InsertOptions {
  /** `on_conflict` columns together with `ignoreDuplicates` turn a unique violation into a silent skip. */
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

export interface SupabaseRest {
  insert(table: string, rows: Row | Row[], options?: InsertOptions): Promise<void>;
  select<T = Row>(table: string, query: string): Promise<T[]>;
  count(table: string, query: string): Promise<number>;
  update(table: string, query: string, patch: Row): Promise<void>;
  remove(table: string, query: string): Promise<void>;
  /**
   * Call a SQL function (`POST /rest/v1/rpc/<fn>`). The secret key goes in the `apikey` header only, the arguments are a JSON body.
   * A set-returning function is capped by PostgREST at 1,000 rows per response (max-rows): page inside the function when more are needed.
   * An empty response body returns null. Errors carry only status and Postgres code, never the body.
   */
  rpc<T = unknown>(fn: string, args?: Row, options?: { schema?: string }): Promise<T | null>;
}

const RPC_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function constraintFrom(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const m = /unique constraint "([^"]{1,80})"/.exec(message);
  return m ? (m[1] as string) : null;
}

export function createSupabaseRest(opts: SupabaseRestOptions): SupabaseRest {
  // The message names no value: a refused URL may hold a typo of the project host, never echo it.
  if (!isAcceptableSupabaseUrl(opts.url, opts.allowLocalUrl === true)) throw new Error('supabase_url_refused');
  const base = `${opts.url.replace(/\/+$/, '')}/rest/v1`;
  const timeoutMs = opts.timeoutMs ?? 6000;

  async function call(path: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: opts.secretKey,
      'content-type': 'application/json',
      accept: 'application/json',
      ...init.headers,
    };
    let res: Response;
    try {
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined;
      res = await opts.fetch(`${base}/${path}`, { method: init.method, headers, body: init.body, signal });
    } catch {
      throw new SupabaseError(0, null, null); // network failure or timeout
    }
    if (res.ok) return res;
    let pgCode: string | null = null;
    let constraint: string | null = null;
    try {
      const body = (await res.json()) as { code?: unknown; message?: unknown };
      pgCode = typeof body.code === 'string' ? body.code.slice(0, 12) : null;
      constraint = constraintFrom(body.message);
    } catch {
      // not JSON
    }
    throw new SupabaseError(res.status, pgCode, constraint);
  }

  return {
    async insert(table, rows, options) {
      const prefer = ['return=minimal'];
      let path = table;
      if (options?.onConflict) {
        path += `?on_conflict=${encodeURIComponent(options.onConflict)}`;
        prefer.push(options.ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates');
      }
      await call(path, { method: 'POST', headers: { prefer: prefer.join(',') }, body: JSON.stringify(rows) });
    },
    async select<T = Row>(table: string, query: string) {
      const res = await call(`${table}?${query}`, { method: 'GET' });
      return (await res.json()) as T[];
    },
    async count(table, query) {
      const res = await call(`${table}?${query}`, { method: 'HEAD', headers: { prefer: 'count=exact' } });
      const range = res.headers.get('content-range') ?? '';
      const m = /\/(\d+)$/.exec(range);
      return m ? Number(m[1]) : 0;
    },
    async update(table, query, patch) {
      await call(`${table}?${query}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    },
    async remove(table, query) {
      await call(`${table}?${query}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
    },
    async rpc<T = unknown>(fn: string, args: Row = {}, options?: { schema?: string }) {
      if (!RPC_NAME.test(fn)) throw new Error('supabase_rpc_name_refused');
      const schema = options?.schema ?? 'public';
      if (!RPC_NAME.test(schema)) throw new Error('supabase_rpc_schema_refused');
      const res = await call(`rpc/${fn}`, { method: 'POST', headers: { 'content-profile': schema, 'accept-profile': schema }, body: JSON.stringify(args) });
      const text = await res.text();
      if (text === '') return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
  };
}
