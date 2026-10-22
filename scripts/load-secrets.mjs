// Secrets loader (D-027, docs/SECRETS.md, BUILD_PLAN M1 item 4a). THE OWNER RUNS THIS at the PC. Claude never runs it with real values and
// never opens the file it reads.
//
//   node scripts/load-secrets.mjs --dry-run                 show names and destinations only; nothing is sent
//   node scripts/load-secrets.mjs --repo OWNER/power-smash  send every value to GitHub and to the Vercel project (Production)
//   options: --file <path>        default .secrets.local (one NAME=value per line, never uploaded: it is in .gitignore)
//            --only vercel|github send only to the Vercel project, or only to GitHub (two files let you use two different Supabase keys)
//
// What it does, for each NAME=value line:
//   - refuses the whole run if a name is not in the manifest below, if the file is tracked by git or not ignored, or if a value has the
//     wrong shape for its name (for example a secret key in a public variable). Nothing is sent after a refusal.
//   - sends the value through the vendor's own command, ALWAYS through standard input, never on a command line:
//       GitHub secret    gh secret set NAME --repo OWNER/REPO
//       GitHub variable  gh variable set NAME --repo OWNER/REPO
//       Vercel env       <locked Vercel CLI> env add NAME production --sensitive   (Production environment of the linked Vercel project)
//                        The CLI comes from our lockfile (ci/vercel-cli, installed once with `npm run vercel:install`). It is never fetched
//                        live: if it is missing the loader refuses before sending anything.
//   - stores every Vercel value as SENSITIVE (a "Secret" in the current Vercel dashboard): write-only after saving, so a stolen deploy token
//     cannot read it back with `vercel env pull`. The price: the Vercel dashboard can never show the value again, only replace it (review
//     fix-infra 4). Every name this loader sends to Vercel is a server-side runtime secret (docs/SECRETS.md), so there is no readable option.
//   - prints names and results only. No value, and no part of a value, is ever printed. Output of the vendor tools is passed through a
//     redactor before it is shown.
// Needs: `gh auth login` done once (GitHub CLI), and for the Vercel part `npm run vercel:install`, then `npm run vercel -- login` and
// `npm run vercel -- link`, done once in this folder (the pinned CLI version is VERCEL_CLI_VERSION below). Preview-environment values and anything you prefer to type by
// hand are set in the Vercel dashboard (Project > Settings > Environment Variables) instead; this loader writes Production only.
// After a successful run, DELETE the file.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { parseSecretsText, printableName, realGit, secretsFileProblem } from './lib/secrets-file.mjs';
import { VERCEL_MISSING_TEXT, resolveLockedVercel } from './lib/vercel-cli.mjs';

/** The Vercel CLI version this project uses everywhere (deploy.yml and preview.yml pin the same one). */
export const VERCEL_CLI_VERSION = '64.2.0';

/** Where each value goes. `vercel` = Vercel project env (Production), `github-secret`, `github-variable` (public, not secret). */
const T = { vercel: 'vercel', ghSecret: 'github-secret', ghVar: 'github-variable' };

const looksSecret = (v) => /^(sb_secret_|AGE-SECRET-KEY-|github_pat_|ghp_)/.test(v) || /^eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}$/.test(v);
const isHttpsUrl = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * The allow-list of names (matches the key matrix in docs/SECRETS.md and .env.example). A value check returns an error text or null.
 * Names of switches set by hand on GitHub (DEPLOY_ENABLED, PREVIEW_ENABLED, SYNC_ENABLED, BACKUP_ENABLED, PS_STRICT, BACKUP_TELEGRAM_ALERTS) are deliberately NOT here.
 */
export const MANIFEST = {
  // Vercel project secrets (and, where the sync workflow needs them too, GitHub secrets)
  SUPABASE_SECRET_KEY: { targets: [T.vercel, T.ghSecret], check: (v) => (v.startsWith('sb_secret_') ? null : 'must start with sb_secret_') },
  // Cloudflare's published TEST secrets (1x/2x/3x + zeros + AA) accept or reject EVERY token: never load one as the real secret (review S-1).
  TURNSTILE_SECRET_KEY: { targets: [T.vercel], check: (v) => (/^[123]x0{20,}AA$/.test(v) ? 'is one of Cloudflare\'s published TEST secrets: it lets every submission through. Use the real production secret from your Turnstile widget (OT-41)' : null) },
  RESEND_API_KEY: { targets: [T.vercel, T.ghSecret] },
  EMAIL_FROM: { targets: [T.vercel] },
  OWNER_EMAIL: { targets: [T.vercel] },
  TELEGRAM_BOT_TOKEN: { targets: [T.vercel, T.ghSecret], check: (v) => (/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(v) ? null : 'does not look like a Telegram bot token (digits, a colon, then letters and digits)') },
  TELEGRAM_CHAT_ID: { targets: [T.vercel, T.ghSecret], check: (v) => (/^-?\d{4,}$/.test(v) ? null : 'must be the chat number (digits only)') },
  HMAC_KEY: { targets: [T.vercel], check: (v) => (/^[A-Za-z0-9_-]{1,16}:.{32,}$/.test(v) ? null : 'must look like <key id>:<at least 32 characters>, for example k1:...') },
  YOUTUBE_API_KEY: { targets: [T.vercel, T.ghSecret] },
  REBUILD_DISPATCH_TOKEN: { targets: [T.vercel] },
  CRON_SECRET: { targets: [T.vercel], check: (v) => (v.length >= 16 ? null : 'must be a long random string (at least 16 characters)') },
  // GitHub secrets
  YOUTUBE_CHANNEL_ID: { targets: [T.ghSecret] },
  VERCEL_TOKEN: { targets: [T.ghSecret] },
  VERCEL_ORG_ID: { targets: [T.ghSecret] },
  VERCEL_PROJECT_ID: { targets: [T.ghSecret] },
  SUPABASE_ACCESS_TOKEN: { targets: [T.ghSecret] },
  SUPABASE_PROJECT_REF: { targets: [T.ghSecret] },
  SUPABASE_DB_URL: { targets: [T.ghSecret], check: (v) => (/^postgres(ql)?:\/\//.test(v) ? null : 'must start with postgresql://') },
  AGE_DRILL_KEY: { targets: [T.ghSecret], check: (v) => (/^AGE-SECRET-KEY-1[A-Z0-9]+$/.test(v) ? null : 'must be the single AGE-SECRET-KEY-1... line of the DRILL key') },
  // Phase 2 only (Vercel project secrets)
  RAZORPAY_KEY_ID: { targets: [T.vercel] },
  RAZORPAY_KEY_SECRET: { targets: [T.vercel] },
  RAZORPAY_WEBHOOK_SECRET: { targets: [T.vercel] },
  // GitHub variables (public by design)
  AGE_PUBLIC_KEY: { targets: [T.ghVar], check: (v) => (/^age1[0-9a-z]{58}$/.test(v) ? null : 'must be an age PUBLIC key (age1...), never the private key') },
  AGE_DRILL_PUBLIC_KEY: { targets: [T.ghVar], check: (v) => (/^age1[0-9a-z]{58}$/.test(v) ? null : 'must be an age PUBLIC key (age1...)') },
  PUBLIC_SITE_URL: { targets: [T.ghVar], check: (v) => (isHttpsUrl(v) ? null : 'must be an https address') },
  PUBLIC_SUPABASE_URL: { targets: [T.ghVar], check: (v) => (isHttpsUrl(v) ? null : 'must be an https address') },
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: { targets: [T.ghVar], check: (v) => (v.startsWith('sb_publishable_') ? null : 'must start with sb_publishable_ (never a secret key)') },
  PUBLIC_TURNSTILE_SITE_KEY: { targets: [T.ghVar] },
  PUBLIC_WHATSAPP_NUMBER: { targets: [T.ghVar], check: (v) => (/^\d{8,15}$/.test(v) ? null : 'must be digits with the country code, no plus sign') },
  // DEV Supabase and Turnstile test-widget PUBLIC values for preview.yml only (never production values)
  PREVIEW_PUBLIC_SUPABASE_URL: { targets: [T.ghVar], check: (v) => (isHttpsUrl(v) ? null : 'must be an https address') },
  PREVIEW_PUBLIC_SUPABASE_PUBLISHABLE_KEY: { targets: [T.ghVar], check: (v) => (v.startsWith('sb_publishable_') ? null : 'must start with sb_publishable_ (never a secret key)') },
  PREVIEW_PUBLIC_TURNSTILE_SITE_KEY: { targets: [T.ghVar] },
  PUBLIC_ALLOW_INDEXING: { targets: [T.ghVar], check: (v) => (v === 'true' || v === 'false' ? null : 'must be exactly true or false') },
  PUBLIC_CF_ANALYTICS_TOKEN: { targets: [T.ghVar], check: (v) => (/^[A-Za-z0-9]{16,64}$/.test(v) ? null : 'must be 16 to 64 letters or digits') },
  PUBLIC_HSTS_MAX_AGE: { targets: [T.ghVar], check: (v) => (/^\d{1,10}$/.test(v) ? null : 'must be a whole number of seconds') },
};

const SWITCH_NAMES = new Set(['DEPLOY_ENABLED', 'PREVIEW_ENABLED', 'SYNC_ENABLED', 'BACKUP_ENABLED', 'PS_STRICT', 'BACKUP_TELEGRAM_ALERTS']);

/** The only Vercel environment this loader writes. Preview and Development values are set by hand in the dashboard. */
export const VERCEL_SCOPE = 'production';

/**
 * Vercel environments where `--sensitive` is documented to work in every version of the docs: Production and Preview. Development is left
 * out on purpose: the older docs forbade it and the current docs (2026-08) allow it, and this loader never writes there anyway.
 * Source: https://vercel.com/docs/environment-variables/sensitive-environment-variables and https://vercel.com/docs/cli/env
 */
export const SENSITIVE_SCOPES = new Set(['production', 'preview']);

const DESTINATION_TEXT = { [T.vercel]: 'Vercel env (Production, sensitive)', [T.ghSecret]: 'GitHub secret', [T.ghVar]: 'GitHub variable' };

const SENSITIVE_NOTE =
  'Vercel values are saved as SENSITIVE: the Vercel dashboard can never show them again, it can only replace them (Project > Settings > Environment Variables > Edit, then type the new value).';

/**
 * Check a parsed file against the manifest. Pure.
 * @param {Map<string,{value:string,line:number}>} entries
 * @param {Array<{kind:string,line:number,name?:string}>} parseProblems
 * @param {{ only?: 'vercel' | 'github' | null }} options
 * @returns {{ problems: string[], plan: Array<{ name: string, targets: string[] }>, skippedEmpty: string[] }}
 */
export function buildPlan(entries, parseProblems, options = {}) {
  const problems = [];
  const plan = [];
  const skippedEmpty = [];
  for (const p of parseProblems) {
    if (p.kind === 'bad_line') problems.push(`line ${p.line}: not in the form NAME=value`);
    else problems.push(`${printableName(p.name ?? '') ? p.name : `line ${p.line}`} appears more than once (line ${p.line})`);
  }
  for (const [name, { value, line }] of entries) {
    const label = printableName(name) ? name : `line ${line}`;
    if (SWITCH_NAMES.has(name)) {
      problems.push(`${label}: this is a switch you set by hand on GitHub (Settings, Secrets and variables, Actions, Variables), not here`);
      continue;
    }
    const spec = Object.prototype.hasOwnProperty.call(MANIFEST, name) ? MANIFEST[name] : undefined;
    if (!spec) {
      problems.push(`${label}: not a known name. Check the spelling against docs/SECRETS.md`);
      continue;
    }
    if (value === '') {
      skippedEmpty.push(name);
      continue;
    }
    const why = spec.check ? spec.check(value) : null;
    if (why) {
      problems.push(`${name}: ${why}`);
      continue;
    }
    if (spec.targets.includes(T.ghVar) && looksSecret(value)) {
      problems.push(`${name}: this is a PUBLIC variable but the value looks like a secret`);
      continue;
    }
    let targets = spec.targets;
    if (options.only === 'vercel') targets = targets.filter((t) => t === T.vercel);
    if (options.only === 'github') targets = targets.filter((t) => t !== T.vercel);
    if (targets.length > 0) plan.push({ name, targets });
  }
  return { problems, plan, skippedEmpty };
}

/** Replace every secret value in a text with [hidden]. Short values are ignored (they would blank ordinary words). */
export function redact(text, values) {
  let out = String(text);
  for (const v of values) if (v.length >= 8) out = out.split(v).join('[hidden]');
  return out;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The real command runner: value goes to the child's standard input only. */
export function realRun(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', windowsHide: true, cwd: projectRoot });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.code ?? 'error') : null };
}

/** The arguments of `vercel env add` for one name and one scope: `--sensitive` wherever the docs support it, never a value. */
export function vercelEnvAddArgs(name, scope = VERCEL_SCOPE) {
  return ['env', 'add', name, scope, ...(SENSITIVE_SCOPES.has(scope) ? ['--sensitive'] : [])];
}

function commandFor(target, name, options) {
  const repoArgs = options.repo ? ['--repo', options.repo] : [];
  if (target === T.ghSecret) return { cmd: 'gh', args: ['secret', 'set', name, ...repoArgs] };
  if (target === T.ghVar) return { cmd: 'gh', args: ['variable', 'set', name, ...repoArgs] };
  // The locked CLI only (checked before the first send); never a live `npx` download of the tool that receives the secrets.
  return { cmd: options.vercelCli.cmd, args: [...options.vercelCli.args, ...vercelEnvAddArgs(name)] };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1] ?? null;
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : null;
}

/**
 * Run the loader. Everything outside is injectable so tests use fake files, a fake git and a fake command runner.
 * @returns {Promise<number>} the exit code: 0 done, 1 a send failed, 2 refused before sending
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  const run = deps.run ?? realRun;
  const gitApi = deps.git ?? realGit;
  const exists = deps.exists ?? existsSync;
  const read = deps.read ?? ((p) => readFileSync(p, 'utf8'));
  // The locked Vercel CLI (ci/vercel-cli) or null. `deps.vercelCli` lets tests inject a fake; `null` there means "not installed".
  const vercelCli = deps.vercelCli !== undefined ? deps.vercelCli : resolveLockedVercel();

  const dryRun = argv.includes('--dry-run');
  const file = resolve(argValue(argv, '--file') ?? '.secrets.local');
  const only = argValue(argv, '--only');
  const repo = argValue(argv, '--repo');
  if (only !== null && only !== 'vercel' && only !== 'github') {
    err('load-secrets: --only must be vercel or github.');
    return 2;
  }
  if (repo !== null && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    err('load-secrets: --repo must look like OWNER/NAME.');
    return 2;
  }

  if (!exists(file)) {
    err(`load-secrets: file not found: ${file}\nCreate it with one NAME=value line per secret (see docs/SECRETS.md), then run this again.`);
    return 2;
  }
  const refusal = secretsFileProblem(file, gitApi);
  if (refusal) {
    err(`load-secrets: REFUSED, ${refusal}.`);
    return 2;
  }

  const { entries, problems: parseProblems } = parseSecretsText(read(file));
  const { problems, plan, skippedEmpty } = buildPlan(entries, parseProblems, { only });
  if (problems.length > 0) {
    err(`load-secrets: REFUSED, ${problems.length} problem(s). Nothing was sent:`);
    for (const p of problems) err(`  - ${p}`);
    return 2;
  }
  if (plan.length === 0) {
    err('load-secrets: nothing to send (the file has no values for the chosen destination).');
    return 2;
  }

  log(`load-secrets: ${plan.length} name(s) ${dryRun ? '(dry run: nothing will be sent)' : 'to send'}${repo ? ` to ${repo}` : ''}:`);
  for (const { name, targets } of plan) log(`  ${name}  ->  ${targets.map((t) => DESTINATION_TEXT[t]).join(', ')}`);
  for (const name of skippedEmpty) log(`  ${name}  (empty, skipped)`);
  const sendsToVercel = plan.some((p) => p.targets.includes(T.vercel));
  if (sendsToVercel) log(SENSITIVE_NOTE);
  if (dryRun) {
    if (sendsToVercel) log(vercelCli ? 'Vercel command-line tool: the locked copy is installed.' : `Vercel command-line tool: NOT installed. ${VERCEL_MISSING_TEXT}`);
    log('Dry run finished. Run again without --dry-run to send. Remember to delete the file afterwards.');
    return 0;
  }
  if (sendsToVercel && !vercelCli) {
    // Fail closed before the FIRST send: no value goes to GitHub either, so a re-run starts from a clean state.
    err(`load-secrets: REFUSED. Nothing was sent. ${VERCEL_MISSING_TEXT}`);
    return 2;
  }

  const values = [...entries.values()].map((e) => e.value);
  let failed = 0;
  for (const { name, targets } of plan) {
    const value = entries.get(name).value;
    for (const target of targets) {
      const { cmd, args } = commandFor(target, name, { repo, vercelCli });
      const result = run(cmd, args, `${value}\n`);
      if (result.status === 0) {
        log(`  OK    ${name}  ->  ${DESTINATION_TEXT[target]}`);
      } else {
        failed++;
        const detail = redact(result.error ?? (result.stderr || result.stdout), values).split(/\r?\n/).find((l) => l.trim() !== '') ?? 'no message';
        err(`  FAIL  ${name}  ->  ${DESTINATION_TEXT[target]}: ${detail.slice(0, 200)}`);
      }
    }
  }
  if (failed > 0) {
    err(`load-secrets: ${failed} send(s) failed. Fix the cause (are you logged in to gh and Vercel, and is this folder linked to the Vercel project?) and run again. Sending twice is harmless for GitHub (the value is replaced), but Vercel refuses a name that already exists: the OK lines above show which names are done, and a Vercel value is replaced in the dashboard (Project, Settings, Environment Variables, Edit).`);
    return 1;
  }
  log('load-secrets: all sent. NOW DELETE the secrets file. Do not keep a copy, and never paste it into chat.');
  return 0;
}

if (isMain(import.meta.url)) process.exit(await main());
