// Anon-access harness (D-005 item 6, BUILD_PLAN M1 "anon API test on leads").
//
// With ONLY the publishable key, asserts that every private table/view in MANIFEST denies select, insert, update and
// delete through the live REST API, and lists anything else the API exposes. Exit code 1 on any leak.
//
//   PUBLIC_SUPABASE_URL=https://<ref>.supabase.co PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node scripts/anon-harness.mjs
//
// It never uses a secret key and never prints a key. It is meant for the DEV project (not run in M1 until OT-03 exists).
//
// What "denied" means (grant level, not just RLS): PostgREST answers 401/403 (permission denied, 42501) or 404/406 (object
// not exposed to this role). A 200 on select, even with an empty array, means the role still holds a GRANT and only RLS
// hides the rows: that is reported as a leak because D-005 requires `REVOKE ALL`.
// The write probes are built to fail even if a grant exists (nil-uuid / impossible primary keys, rows missing NOT NULL
// columns) and send `Prefer: tx=rollback`, so a leak is detected without keeping data.
import { pathToFileURL } from 'node:url';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Every table and view the harness must see denied (or, for `expectSelect: true`, an `api` view that anon may read).
 * Add every new table here in the same migration that creates it (supabase/README.md). `pk` is a column that exists on the
 * table (used in filters so a missing column cannot mask a permission result); `pkSample` an impossible value for it.
 */
export const MANIFEST = [
  { name: 'leads', pk: 'id', pkSample: NIL_UUID },
  { name: 'lead_events', pk: 'id', pkSample: NIL_UUID },
  { name: 'events', pk: 'id', pkSample: NIL_UUID },
  { name: 'outbound_clicks', pk: 'id', pkSample: NIL_UUID },
  { name: 'rate_limit_hits', pk: 'id', pkSample: NIL_UUID },
  { name: 'daily_salts', pk: 'day', pkSample: '1900-01-01' },
  // 0002_consent_records.sql (C-10)
  { name: 'notice_versions', pk: 'id', pkSample: '__no_such_notice__' },
  { name: 'consent_events', pk: 'id', pkSample: NIL_UUID },
  // 0007_placements.sql (M3, another worker): added here by the SCHEMA worker so the manifest test stays complete; keep or move as that worker prefers
  { name: 'sponsors', pk: 'id', pkSample: NIL_UUID },
  { name: 'placements', pk: 'id', pkSample: NIL_UUID },
  { name: 'placement_stats_daily', pk: 'placement_id', pkSample: NIL_UUID },
  { name: 'placement_page_stats_daily', pk: 'placement_id', pkSample: NIL_UUID },
  { name: 'placement_impression_seen', pk: 'placement_id', pkSample: NIL_UUID },
  // 0011_products.sql (D-099): the owner's prices, denied; the public view is below
  { name: 'products', pk: 'slug', pkSample: '__no_such_product__' },
  // 0004_archive_core.sql, 0005_archive_safety.sql (M2): private archive tables, all denied
  { name: 'videos', pk: 'youtube_id', pkSample: '__no_such_video__' },
  { name: 'video_title_history', pk: 'id', pkSample: '0' },
  { name: 'tournaments', pk: 'id', pkSample: NIL_UUID },
  { name: 'tournament_private', pk: 'tournament_id', pkSample: NIL_UUID },
  { name: 'tournament_aliases', pk: 'id', pkSample: NIL_UUID },
  { name: 'players', pk: 'id', pkSample: NIL_UUID },
  { name: 'player_aliases', pk: 'id', pkSample: NIL_UUID },
  { name: 'matches', pk: 'id', pkSample: NIL_UUID },
  { name: 'match_participants', pk: 'id', pkSample: NIL_UUID },
  { name: 'slug_redirects', pk: 'from_path', pkSample: '/__no_such_path__/' },
  { name: 'sync_runs', pk: 'id', pkSample: NIL_UUID },
  { name: 'archive_settings', pk: 'key', pkSample: '__no_such_key__' },
  { name: 'site_state', pk: 'id', pkSample: '0' },
  { name: 'audit_log', pk: 'id', pkSample: '0' },
  { name: 'suppression', pk: 'id', pkSample: NIL_UUID },
  // 0008_admin_rpcs.sql (M2, ADMIN2): admin identity and review tables, all denied
  { name: 'profiles', pk: 'id', pkSample: NIL_UUID },
  { name: 'profile_requests', pk: 'id', pkSample: NIL_UUID },
  { name: 'player_dup_dismissed', pk: 'player_a', pkSample: NIL_UUID },
  // 0006_archive_api.sql (M2): the public read surface. Select is allowed (2xx), writes are denied. Not tables: the structure test skips entries with a schema.
  { name: 'public_videos', pk: 'youtube_id', pkSample: '__no_such_video__', schema: 'api', expectSelect: true },
  { name: 'public_matches', pk: 'id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
  { name: 'public_match_participants', pk: 'match_id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
  { name: 'public_players', pk: 'id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
  { name: 'public_tournaments', pk: 'id', pkSample: NIL_UUID, schema: 'api', expectSelect: true },
  { name: 'public_products', pk: 'slug', pkSample: '__no_such_product__', schema: 'api', expectSelect: true },
  { name: 'public_slug_redirects', pk: 'from_path', pkSample: '/__no_such_path__/', schema: 'api', expectSelect: true },
  { name: 'public_archive_modes', pk: 'key', pkSample: '__no_such_key__', schema: 'api', expectSelect: true },
  // 0013_live_pin.sql (D-101): the /live pin tables are denied; their two api views allow select only
  { name: 'live_settings', pk: 'id', pkSample: '0' },
  { name: 'live_past_streams', pk: 'video_id', pkSample: '__no_such_video__' },
  // 0015_submitted_tournaments.sql (D-103): the submission link table is denied
  { name: 'tournament_submissions', pk: 'tournament_id', pkSample: NIL_UUID },
  { name: 'public_live_settings', pk: 'pinned_video_id', pkSample: '__no_such_video__', schema: 'api', expectSelect: true },
  { name: 'public_live_past_streams', pk: 'video_id', pkSample: '__no_such_video__', schema: 'api', expectSelect: true },
  // Later milestones add their tables here, for example:
  //   { name: 'players', pk: 'id', pkSample: NIL_UUID }                                  (base table: must be denied)
  //   { name: 'public_players', pk: 'id', pkSample: NIL_UUID, schema: 'api', expectSelect: true }  (api view: select allowed, writes denied)
];

const DENIED_STATUSES = new Set([401, 403, 404, 406]);

/** @param {number} status */
export const isDenied = (status) => DENIED_STATUSES.has(status);

/**
 * @param {{ url: string, key: string, fetch?: typeof fetch, manifest?: typeof MANIFEST, log?: (line: string) => void }} opts
 */
export async function runHarness(opts) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const manifest = opts.manifest ?? MANIFEST;
  const base = opts.url.replace(/\/+$/, '');
  const log = opts.log ?? (() => undefined);
  const results = [];
  const leaks = [];
  const errors = [];

  const call = async (method, path, { body, schema, extraHeaders } = {}) => {
    // The key goes on `apikey` only (Supabase docs: publishable and secret keys are not JWTs).
    const headers = { apikey: opts.key, accept: 'application/json', ...(extraHeaders ?? {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (schema) {
      headers[method === 'GET' || method === 'HEAD' ? 'accept-profile' : 'content-profile'] = schema;
    }
    try {
      const res = await doFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      // The error code of PostgREST/Postgres (for example 42501 permission denied, 55000 view not writable); never the message.
      let code = null;
      if (res.status >= 400) {
        try {
          const j = await res.json();
          code = typeof j?.code === 'string' ? j.code : null;
        } catch {
          code = null;
        }
      }
      return { status: res.status, code };
    } catch {
      return { status: 0, code: null };
    }
  };

  // Postgres error 55000 on a WRITE: the `api` view joins or masks several tables, so it is "not automatically updatable" and the database
  // refuses every insert, update and delete before any grant is even looked at. That is a denial by construction (the SQL check
  // supabase/checks/0006_assertions.sql still proves anon holds no write grant on these views). Any other 5xx stays an error.
  const record = (target, op, status, expectedDenied, code = null) => {
    const notWritable = expectedDenied && op !== 'select' && status === 500 && code === '55000';
    const denied = isDenied(status) || notWritable;
    const unreachable = !notWritable && (status === 0 || status >= 500);
    const ok = unreachable ? false : expectedDenied ? denied : true;
    const entry = { target, op, status, expected: expectedDenied ? 'denied' : 'allowed', ok };
    results.push(entry);
    if (unreachable) errors.push(entry);
    else if (!ok) leaks.push(entry);
    log(`${ok ? 'PASS' : unreachable ? 'ERROR' : 'LEAK '} ${op.padEnd(6)} ${target} -> HTTP ${status} (expected ${entry.expected})${notWritable ? ' view cannot be written at all (not automatically updatable)' : ''}`);
  };

  for (const t of manifest) {
    const rel = `/rest/v1/${encodeURIComponent(t.name)}`;
    const pkFilter = `${encodeURIComponent(t.pk)}=eq.${encodeURIComponent(t.pkSample)}`;
    const pkBody = { [t.pk]: t.pkSample };
    const rollback = { prefer: 'tx=rollback,return=minimal' };

    const sel = await call('GET', `${rel}?select=*&limit=1`, { schema: t.schema });
    record(t.name, 'select', sel.status, !t.expectSelect);
    // For an allowed `api` view, additionally require a 2xx (not a 400 from a broken view).
    if (t.expectSelect && !(sel.status >= 200 && sel.status < 300)) {
      const entry = { target: t.name, op: 'select', status: sel.status, expected: 'allowed (2xx)', ok: false };
      results.push(entry);
      errors.push(entry);
    }
    const ins = await call('POST', rel, { body: pkBody, schema: t.schema, extraHeaders: rollback });
    record(t.name, 'insert', ins.status, true, ins.code);
    const upd = await call('PATCH', `${rel}?${pkFilter}`, { body: pkBody, schema: t.schema, extraHeaders: rollback });
    record(t.name, 'update', upd.status, true, upd.code);
    const del = await call('DELETE', `${rel}?${pkFilter}`, { schema: t.schema, extraHeaders: rollback });
    record(t.name, 'delete', del.status, true, del.code);
  }

  // Discovery: what does the API list for this role? (PostgREST's OpenAPI root. Best effort: some projects hide it.)
  const exposed = [];
  let discovery = 'unavailable';
  try {
    const res = await doFetch(`${base}/rest/v1/`, { method: 'GET', headers: { apikey: opts.key, accept: 'application/openapi+json, application/json' } });
    if (res.ok) {
      const spec = await res.json();
      const allPaths = Object.keys(spec?.paths ?? {});
      const known = new Map(manifest.map((m) => [`/${m.name}`, m]));
      discovery = 'ok';
      for (const p of allPaths) {
        if (p === '/') continue;
        if (p.startsWith('/rpc/')) {
          exposed.push(p.slice(1)); // every RPC must be on an explicit allowlist (D-005 item 6c): none in M1
          continue;
        }
        const m = known.get(p);
        if (!m || !m.expectSelect) exposed.push(p.slice(1));
      }
      for (const name of exposed) {
        const entry = { target: name, op: 'listed', status: 200, expected: 'not listed', ok: false };
        results.push(entry);
        leaks.push(entry);
        log(`LEAK  listed ${name} is exposed to the publishable key`);
      }
    }
  } catch {
    // discovery is best effort
  }

  // Sign-ups must stay disabled (D-005 item 6d, D-006). Read-only: GET the public settings; never POST a sign-up.
  let signups = 'unknown';
  try {
    const res = await doFetch(`${base}/auth/v1/settings`, { method: 'GET', headers: { apikey: opts.key, accept: 'application/json' } });
    if (res.ok) {
      const s = await res.json();
      if (s && typeof s.disable_signup === 'boolean') {
        signups = s.disable_signup ? 'disabled' : 'ENABLED';
        const entry = { target: 'auth', op: 'signup', status: 200, expected: 'disabled', ok: s.disable_signup };
        results.push(entry);
        if (!entry.ok) leaks.push(entry);
        log(`${entry.ok ? 'PASS' : 'LEAK '} auth sign-ups ${signups}`);
      }
    }
  } catch {
    // unknown
  }

  return { results, leaks, errors, exposed, discovery, signups, exitCode: leaks.length > 0 || errors.length > 0 ? 1 : 0 };
}

export async function main(env = process.env, out = console) {
  const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!url || !key) {
    out.error('Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY (publishable key only).');
    return 2;
  }
  if (!/^sb_publishable_/.test(key)) {
    out.error('PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...). Refusing to run with any other key.');
    return 2;
  }
  const report = await runHarness({ url, key, log: (l) => out.log(l) });
  out.log('');
  out.log(`Checked ${MANIFEST.length} tables/views x 4 operations. Leaks: ${report.leaks.length}. Errors: ${report.errors.length}. Discovery: ${report.discovery}. Sign-ups: ${report.signups}.`);
  if (report.exposed.length > 0) out.log(`Exposed to the publishable key: ${report.exposed.join(', ')}`);
  if (report.discovery !== 'ok') out.log('Note: the API did not list its objects for this key; only the manifest was checked.');
  // Plain-language hints for the two setup gaps the first live run found (2026-10-24).
  const notExposed = report.errors.filter((e) => e.op === 'select' && e.status === 406);
  if (notExposed.length > 0) {
    out.log(
      `HINT: ${notExposed.length} public api view(s) answered HTTP 406, so the api schema is not in the project's Exposed schemas. ` +
        'In the Supabase dashboard open Project Settings, Data API, Settings, Exposed schemas, add api next to public, save, and run this again.',
    );
  }
  if (report.signups === 'ENABLED') out.log('HINT: new sign-ups are still switched on. In the Supabase dashboard open Authentication, then Sign In / Providers (older screens: Settings), and switch off Allow new users to sign up, then run this again.');
  out.log(report.exitCode === 0 ? 'RESULT: 0 leaks' : 'RESULT: FAIL');
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
