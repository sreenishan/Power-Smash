#!/usr/bin/env node
// G0 measurement helper (DECISIONS D-003): run a command, sample the WORKING SET of the whole
// process tree (node, workerd, esbuild, ...) about once a second, and report wall time and peak RAM.
// Nothing is guessed: every figure comes from `wmic process` samples taken while the command runs.
//
// Usage:
//   node scripts/g0-measure.mjs --label build-8000-node --env PS_G0_PAGES=8000 --env PS_PRERENDER_ENV=node -- npx astro build
//
// Writes spike/g0-measure-<label>.json (full timeline) and spike/g0-<label>.log (child output),
// prints a one-line JSON summary, and exits with the child's exit code.
// Windows-only sampler (wmic ships with Windows 10). Also exports startSampler() for g0-dev-check.mjs.

import { execFile, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MB = 1024 * 1024;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const spikeDir = path.join(root, 'spike');

function listProcesses() {
  return new Promise((resolve) => {
    execFile(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount', '/format:csv'],
      { maxBuffer: 64 * MB, windowsHide: true },
      (err, out) => {
        if (err || !out) return resolve([]);
        const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const header = lines.shift()?.split(',') ?? [];
        const idx = Object.fromEntries(header.map((h, i) => [h, i]));
        const rows = [];
        for (const line of lines) {
          const f = line.split(',');
          // process names never contain commas on Windows; guard anyway
          if (f.length !== header.length) continue;
          rows.push({
            name: f[idx.Name],
            pid: Number(f[idx.ProcessId]),
            ppid: Number(f[idx.ParentProcessId]),
            ws: Number(f[idx.WorkingSetSize]) || 0,
            priv: Number(f[idx.PrivatePageCount]) || 0,
          });
        }
        resolve(rows);
      },
    );
  });
}

/** Start sampling the process tree rooted at rootPid. Call stop() for the summary. */
export function startSampler(rootPid, { intervalMs = 1000 } = {}) {
  const tracked = new Set([rootPid]);
  const timeline = [];
  const t0 = performance.now();
  let running = true;
  let peakWs = 0;
  let peakPriv = 0;
  let minFreeMb = Infinity;
  const peakSingleByName = {}; // largest single process working set per image name
  const peakSumByName = {}; // largest sum of working sets per image name
  const seenNames = new Set();

  const loop = (async () => {
    while (running) {
      const started = performance.now();
      const rows = await listProcesses();
      if (rows.length) {
        let grew = true;
        while (grew) {
          grew = false;
          for (const r of rows) {
            if (!tracked.has(r.pid) && tracked.has(r.ppid) && r.pid !== r.ppid) {
              tracked.add(r.pid);
              grew = true;
            }
          }
        }
        // forget PIDs that no longer exist so a recycled PID is never mistaken for a member of the tree
        const present = new Set(rows.map((r) => r.pid));
        for (const pid of tracked) if (pid !== rootPid && !present.has(pid)) tracked.delete(pid);
        const alive = rows.filter((r) => tracked.has(r.pid));
        const sumWs = alive.reduce((s, r) => s + r.ws, 0);
        const sumPriv = alive.reduce((s, r) => s + r.priv, 0);
        const byName = {};
        for (const r of alive) {
          const n = r.name.toLowerCase();
          seenNames.add(n);
          byName[n] = (byName[n] ?? 0) + r.ws;
          peakSingleByName[n] = Math.max(peakSingleByName[n] ?? 0, r.ws);
        }
        for (const [n, v] of Object.entries(byName)) peakSumByName[n] = Math.max(peakSumByName[n] ?? 0, v);
        peakWs = Math.max(peakWs, sumWs);
        peakPriv = Math.max(peakPriv, sumPriv);
        const freeMb = os.freemem() / MB;
        minFreeMb = Math.min(minFreeMb, freeMb);
        timeline.push({
          t: Number(((performance.now() - t0) / 1000).toFixed(1)),
          procs: alive.length,
          treeWsMB: Math.round(sumWs / MB),
          treePrivMB: Math.round(sumPriv / MB),
          freeMemMB: Math.round(freeMb),
        });
      }
      const wait = intervalMs - (performance.now() - started);
      if (wait > 0 && running) await new Promise((r) => setTimeout(r, wait));
    }
  })();

  return {
    async stop() {
      running = false;
      await loop;
      const toMb = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / MB)]));
      const span = timeline.length > 1 ? timeline[timeline.length - 1].t - timeline[0].t : 0;
      return {
        samples: timeline.length,
        avgSampleIntervalSec: timeline.length > 1 ? Number((span / (timeline.length - 1)).toFixed(2)) : null,
        peakTreeWorkingSetMB: Math.round(peakWs / MB),
        peakTreePrivateMB: Math.round(peakPriv / MB),
        peakSingleProcessWorkingSetMB: toMb(peakSingleByName),
        peakSumWorkingSetByImageMB: toMb(peakSumByName),
        imagesSeen: [...seenNames].sort(),
        minSystemFreeMemMB: Number.isFinite(minFreeMb) ? Math.round(minFreeMb) : null,
        timeline,
      };
    },
  };
}

/** Kill a whole process tree on Windows. */
export function killTree(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  if (sep === -1 || sep === argv.length - 1) {
    console.error('usage: node scripts/g0-measure.mjs --label NAME [--env K=V ...] [--timeout-min N] -- <command ...>');
    process.exit(2);
  }
  const opts = argv.slice(0, sep);
  const cmd = argv.slice(sep + 1);
  let label = 'run';
  let timeoutMin = 40;
  const env = { ...process.env };
  const envSet = {};
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] === '--label') label = opts[++i];
    else if (opts[i] === '--timeout-min') timeoutMin = Number(opts[++i]);
    else if (opts[i] === '--env') {
      const [k, ...v] = opts[++i].split('=');
      env[k] = v.join('=');
      envSet[k] = v.join('=');
    }
  }
  mkdirSync(spikeDir, { recursive: true });
  const logPath = path.join(spikeDir, `g0-${label}.log`);
  const log = createWriteStream(logPath);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const child = spawn(cmd[0], cmd.slice(1), { cwd: root, env, shell: true, windowsHide: true });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const sampler = startSampler(child.pid);
  let timedOut = false;
  const timer = setTimeout(async () => {
    timedOut = true;
    await killTree(child.pid);
  }, timeoutMin * 60_000);
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? -1)));
  clearTimeout(timer);
  const wallSeconds = Number(((performance.now() - t0) / 1000).toFixed(1));
  const memory = await sampler.stop();
  log.end();
  const summary = {
    label,
    command: cmd.join(' '),
    envSet,
    nodeOptions: env.NODE_OPTIONS ?? null,
    startedAt,
    exitCode,
    timedOut,
    wallSeconds,
    ...memory,
    logFile: path.relative(root, logPath),
  };
  writeFileSync(path.join(spikeDir, `g0-measure-${label}.json`), JSON.stringify(summary, null, 2));
  const { timeline, ...short } = summary;
  console.log(JSON.stringify(short, null, 2));
  process.exit(exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
