// Connect-day preflight (docs/CONNECT_DAY.md). Read-only. Default mode contacts NO service.
//
//   node scripts/connect-preflight.mjs            offline: env NAMES, migrations, checks, switches, .env ignored
//   node scripts/connect-preflight.mjs --online   also two harmless GETs: Supabase REST root and YouTube API (1 quota unit)
//
// It never prints a value: only "set"/"unset" and a shape verdict. Exit 1 on any FAIL, 0 otherwise (WARN and SKIP do not fail).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REF = /^[a-z]{20}$/;
const SWITCHES = ['SYNC_ENABLED', 'EMAIL_ENABLED', 'DEPLOY_ENABLED', 'BACKUP_ENABLED', 'CRON_ENABLED', 'TELEGRAM_ALERT_PHONE_LINK', 'TURNSTILE_ALLOW_TEST_KEYS', 'SUPABASE_ALLOW_LOCAL_URL'];

/** Shape verdicts return null (ok) or a short reason. They never echo the value. */
export const SHAPES = {
  PUBLIC_SUPABASE_URL: (v) => {
    let u;
    try {
      u = new URL(v);
    } catch {
      return 'not a URL';
    }
    if (u.protocol !== 'https:') return 'must start with https://';
    const m = /^([a-z0-9]+)\.supabase\.co$/.exec(u.hostname);
    if (!m) return 'host must be <project-ref>.supabase.co';
    return REF.test(m[1]) ? null : 'project ref is not 20 lowercase letters';
  },
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: (v) => (v.startsWith('sb_publishable_') ? null : 'must start with sb_publishable_'),
  SUPABASE_SECRET_KEY: (v) => (v.startsWith('sb_secret_') ? null : 'must start with sb_secret_'),
  SUPABASE_PROJECT_REF: (v) => (REF.test(v) ? null : 'not 20 lowercase letters'),
  YOUTUBE_API_KEY: (v) => (/^AIza[0-9A-Za-z_-]{35}$/.test(v) ? null : 'unexpected shape (Google keys start with AIza, 39 characters)'),
  YOUTUBE_CHANNEL_ID: (v) => (/^UC[0-9A-Za-z_-]{22}$/.test(v) ? null : 'must look like UC + 22 characters'),
  PUBLIC_TURNSTILE_SITE_KEY: (v) => (v.length >= 10 ? null : 'too short'),
};

// [name, needed for]
const NAMES = [
  ['PUBLIC_SUPABASE_URL', 'dev'],
  ['PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'dev'],
  ['PUBLIC_TURNSTILE_SITE_KEY', 'worker'],
  ['TURNSTILE_SECRET_KEY', 'worker'],
  ['SUPABASE_SECRET_KEY', 'worker, sync'],
  ['HMAC_KEY', 'worker'],
  ['YOUTUBE_API_KEY', 'sync'],
  ['YOUTUBE_CHANNEL_ID', 'sync'],
];

const isSet = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';

export function checkEnv(env) {
  const out = [];
  for (const [name, need] of NAMES) {
    if (!isSet(env, name)) {
      out.push({ level: 'WARN', name: `env ${name}`, detail: `unset (needed for: ${need})` });
      continue;
    }
    const bad = SHAPES[name]?.(env[name].trim()) ?? null;
    out.push(bad ? { level: 'FAIL', name: `env ${name}`, detail: `set, but ${bad}` } : { level: 'OK', name: `env ${name}`, detail: 'set, shape ok' });
  }
  if (isSet(env, 'SUPABASE_PROJECT_REF') && isSet(env, 'PUBLIC_SUPABASE_URL')) {
    const ref = env.SUPABASE_PROJECT_REF.trim();
    const bad = SHAPES.SUPABASE_PROJECT_REF(ref);
    let host = '';
    try {
      host = new URL(env.PUBLIC_SUPABASE_URL).hostname;
    } catch {
      /* reported above */
    }
    if (bad) out.push({ level: 'FAIL', name: 'env SUPABASE_PROJECT_REF', detail: `set, but ${bad}` });
    else out.push(host.startsWith(`${ref}.`) ? { level: 'OK', name: 'project ref matches URL', detail: 'yes' } : { level: 'FAIL', name: 'project ref matches URL', detail: 'SUPABASE_PROJECT_REF differs from PUBLIC_SUPABASE_URL: wrong project (dev vs prod)?' });
  }
  if (isSet(env, 'SUPABASE_SECRET_KEY') && !isSet(env, 'SUPABASE_URL') && !isSet(env, 'PUBLIC_SUPABASE_URL')) out.push({ level: 'FAIL', name: 'env SUPABASE_URL', detail: 'secret key set but no Supabase URL' });
  return out;
}

export function checkMigrations(root) {
  const out = [];
  const mdir = join(root, 'supabase', 'migrations');
  const cdir = join(root, 'supabase', 'checks');
  if (!existsSync(mdir)) return [{ level: 'FAIL', name: 'migrations folder', detail: 'missing supabase/migrations' }];
  const nums = readdirSync(mdir)
    .map((f) => /^(\d{4})_.+\.sql$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  if (!nums.length) return [{ level: 'FAIL', name: 'migrations folder', detail: 'no NNNN_name.sql files' }];
  let bad = null;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      bad = i + 1;
      break;
    }
  }
  out.push(bad !== null ? { level: 'FAIL', name: 'migrations contiguous', detail: `gap or duplicate near ${String(bad).padStart(4, '0')}` } : { level: 'OK', name: 'migrations contiguous', detail: `0001..${String(nums[nums.length - 1]).padStart(4, '0')} (${nums.length} files)` });
  const checks = new Set();
  if (existsSync(cdir)) for (const f of readdirSync(cdir)) {
    const m = /^(\d{4})_assertions\.sql$/.exec(f);
    if (m) checks.add(Number(m[1]));
  }
  const missing = nums.filter((n) => !checks.has(n));
  out.push(missing.length ? { level: 'FAIL', name: 'checks exist', detail: `no assertions file for migration(s): ${missing.map((n) => String(n).padStart(4, '0')).join(', ')}` } : { level: 'OK', name: 'checks exist', detail: 'one assertions file per migration' });
  return out;
}

export function checkSwitches(root, env) {
  const out = [];
  const f = join(root, 'src', 'content', 'legal', 'status.ts');
  if (!existsSync(f)) out.push({ level: 'WARN', name: 'archivePages flag', detail: 'src/content/legal/status.ts not found' });
  else {
    const m = /archivePages:\s*(true|false)\s*,/.exec(readFileSync(f, 'utf8'));
    out.push(!m ? { level: 'WARN', name: 'archivePages flag', detail: 'not found' } : m[1] === 'false' ? { level: 'OK', name: 'archivePages flag', detail: 'off' } : { level: 'FAIL', name: 'archivePages flag', detail: 'ON: must stay off until the owner approves (D-012)' });
  }
  let any = false;
  for (const s of SWITCHES) {
    if (env[s] === 'true') {
      any = true;
      out.push({ level: s === 'TURNSTILE_ALLOW_TEST_KEYS' || s === 'SUPABASE_ALLOW_LOCAL_URL' ? 'WARN' : 'FAIL', name: `switch ${s}`, detail: 'is true: dev/PC only, never prod; every other switch must be off on connect day' });
    }
  }
  if (!any) out.push({ level: 'OK', name: 'env switches', detail: 'none is true' });
  return out;
}

export function checkEnvIgnored(root) {
  const f = join(root, '.gitignore');
  if (!existsSync(f)) return [{ level: 'FAIL', name: '.env git-ignored', detail: 'no .gitignore' }];
  const lines = readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim());
  const ok = lines.includes('.env') || lines.includes('.env.*') || lines.includes('.env*');
  return [ok ? { level: 'OK', name: '.env git-ignored', detail: 'yes' } : { level: 'FAIL', name: '.env git-ignored', detail: '.gitignore does not list .env' }];
}

/** Online mode: harmless GETs only. The key is read from env and never logged. */
export async function checkOnline(env, fetchFn) {
  const out = [];
  const url = env.PUBLIC_SUPABASE_URL?.trim();
  if (!url || SHAPES.PUBLIC_SUPABASE_URL(url)) out.push({ level: 'SKIP', name: 'online Supabase REST root', detail: 'URL unset or malformed' });
  else {
    try {
      const headers = isSet(env, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY') ? { apikey: env.PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim() } : {};
      const r = await fetchFn(`${new URL(url).origin}/rest/v1/`, { method: 'GET', headers });
      out.push(r.status < 500 ? { level: 'OK', name: 'online Supabase REST root', detail: `reachable (HTTP ${r.status})` } : { level: 'FAIL', name: 'online Supabase REST root', detail: `HTTP ${r.status}` });
    } catch {
      out.push({ level: 'FAIL', name: 'online Supabase REST root', detail: 'network error' });
    }
  }
  const key = env.YOUTUBE_API_KEY?.trim();
  if (!key) out.push({ level: 'SKIP', name: 'online YouTube API', detail: 'YOUTUBE_API_KEY unset' });
  else {
    try {
      const q = new URLSearchParams({ part: 'id', id: env.YOUTUBE_CHANNEL_ID?.trim() || 'UCRhIwO47uhJIM5Iw4uybcFQ', key });
      const r = await fetchFn(`https://www.googleapis.com/youtube/v3/channels?${q}`, { method: 'GET' });
      out.push(r.status === 200 ? { level: 'OK', name: 'online YouTube API', detail: 'key accepted (1 quota unit)' } : { level: 'FAIL', name: 'online YouTube API', detail: `HTTP ${r.status} (400/403 = key invalid, wrongly restricted, or quota)` });
    } catch {
      out.push({ level: 'FAIL', name: 'online YouTube API', detail: 'network error' });
    }
  }
  return out;
}

export async function runPreflight({ root = resolve('.'), env = process.env, online = false, fetchFn = globalThis.fetch } = {}) {
  const results = [...checkEnv(env), ...checkMigrations(root), ...checkSwitches(root, env), ...checkEnvIgnored(root)];
  if (online) results.push(...(await checkOnline(env, fetchFn)));
  return { results, failed: results.some((r) => r.level === 'FAIL') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const online = process.argv.includes('--online');
  console.log(`Connect-day preflight (${online ? 'ONLINE: two harmless GETs' : 'offline: no service is contacted'}). Values are never printed.`);
  const { results, failed } = await runPreflight({ online });
  for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.name}: ${r.detail}`);
  console.log(failed ? 'RESULT: FAIL. Stop and fix before connecting.' : 'RESULT: no FAIL. WARN/SKIP lines are items still to do.');
  process.exit(failed ? 1 : 0);
}
