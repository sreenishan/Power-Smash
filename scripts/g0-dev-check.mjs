#!/usr/bin/env node
// G0 step 2: start `astro dev`, fetch the hello page, a generated page and the API route over HTTP,
// keep it up for at least --hold seconds (default 60) re-checking every 5 s, then stop it and
// confirm no stray node/workerd process of the tree is left. Records time-to-ready and RAM.
// Usage: node scripts/g0-dev-check.mjs [--mode dev|preview] [--hold 60] [--port 4321] [--label NAME]
// (preview needs a finished `astro build` first; it serves dist/ through workerd)
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killTree, spikeDir, startSampler } from './g0-measure.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const hold = Number(opt('--hold', '60'));
const port = Number(opt('--port', '4321'));
const mode = opt('--mode', 'dev');
const label = opt('--label', mode === 'dev' ? 'dev-check' : `${mode}-check`);
const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(spikeDir, { recursive: true });
const log = createWriteStream(path.join(spikeDir, `g0-${label}-server.log`));
const t0 = performance.now();
const since = () => Number(((performance.now() - t0) / 1000).toFixed(1));

const child = spawn('npx', ['astro', mode, '--port', String(port)], {
  cwd: root,
  env: { ...process.env, NO_COLOR: '1' },
  shell: true,
  windowsHide: true,
});
let output = '';
const onData = (b) => {
  output += b.toString();
  log.write(b);
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
let exited = null;
child.on('close', (code) => {
  exited = { code, atSec: since() };
});
const sampler = startSampler(child.pid);

async function get(pathname) {
  const started = performance.now();
  try {
    const res = await fetch(base + pathname, { signal: AbortSignal.timeout(60_000) });
    const body = await res.text();
    return { path: pathname, status: res.status, ms: Math.round(performance.now() - started), bytes: body.length, body };
  } catch (e) {
    return { path: pathname, status: 0, ms: Math.round(performance.now() - started), error: String(e.cause?.code ?? e.message) };
  }
}

/** @type {Record<string, any>} */
const result = { startedAt: new Date().toISOString(), mode, port, holdSeconds: hold, attempts: [], checks: [] };
let readyAtSec = null;

// 1. wait until the hello page answers 200 (give up after 5 minutes)
while (since() < 300 && !exited) {
  const r = await get('/');
  result.attempts.push({ atSec: since(), status: r.status, ms: r.ms, error: r.error });
  if (r.status === 200) {
    readyAtSec = since();
    break;
  }
  await sleep(2000);
}
result.readyAtSec = readyAtSec;
result.serverBannerSeen = /astro\s+v?\d/i.test(output);

if (readyAtSec !== null) {
  // 2. first full check
  for (const p of ['/', '/g0/1/', '/api/health']) {
    const r = await get(p);
    const { body, ...rest } = r;
    result.checks.push({ atSec: since(), ...rest, bodySample: body?.slice(0, 120) });
  }
  // 3. keep it up for `hold` seconds, re-check every 5 s
  const holdStart = performance.now();
  while ((performance.now() - holdStart) / 1000 < hold && !exited) {
    await sleep(5000);
    for (const p of ['/', '/api/health']) {
      const r = await get(p);
      const { body, ...rest } = r;
      result.checks.push({ atSec: since(), ...rest });
    }
  }
  result.heldSeconds = Number(((performance.now() - holdStart) / 1000).toFixed(1));
  const final = await get('/api/health');
  result.finalHealth = { status: final.status, body: final.body };
}

result.serverExitedEarly = exited; // captured BEFORE we kill it, so a crash is distinguishable from our stop
const exitedEarly = exited !== null;
await killTree(child.pid);
await sleep(1500);
const memory = await sampler.stop();
log.end();
const failures = result.checks.filter((c) => c.status !== 200);
result.allChecksOk = readyAtSec !== null && failures.length === 0 && !exitedEarly;
result.failedChecks = failures;
result.totalSeconds = since();
result.memory = { ...memory, timeline: undefined };
writeFileSync(path.join(spikeDir, `g0-${label}.json`), JSON.stringify({ ...result, memory }, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.allChecksOk ? 0 : 1);
