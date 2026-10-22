// Reading the owner's untracked `.secrets.local` (docs/SECRETS.md, D-027). Shared by load-secrets.mjs and telegram-chat-id.mjs.
// RULES: nothing in this file ever prints a value. Problems are reported with a line number or a variable NAME only.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const NAME_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Parse dotenv-style text: `NAME=value`, one per line, `#` comment lines, optional `export `, optional matching quotes around the value.
 * A `#` inside a value is part of the value (no inline comments). Multi-line values are not supported.
 * @returns {{ entries: Map<string, { value: string, line: number }>, problems: Array<{ kind: 'bad_line' | 'duplicate', line: number, name?: string }> }}
 */
export function parseSecretsText(text) {
  const entries = new Map();
  const problems = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const m = NAME_LINE.exec(trimmed);
    if (!m) {
      problems.push({ kind: 'bad_line', line });
      return;
    }
    const name = m[1];
    let value = m[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (entries.has(name)) {
      problems.push({ kind: 'duplicate', line, name });
      return;
    }
    entries.set(name, { value, line });
  });
  return { entries, problems };
}

/** A name that is safe to show in a message: looks like a variable name and does not look like a pasted secret. */
export function printableName(name) {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) return false;
  return !/^(SB_SECRET|AIZA|GHP|GITHUB_PAT|AGE_SECRET)/.test(name);
}


const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

/**
 * Real git checks. Injected in tests. Git itself is asked, FROM THE FILE'S OWN FOLDER, with the bare file name: git works out the
 * repository and resolves junctions, symbolic links, subst drives, short (8.3) names and relative paths itself. The loader never
 * compares path strings to decide whether a file is "inside the repository" (review S-8: a junction made that comparison say "outside",
 * so a tracked secrets file was accepted).
 *
 * `top(dir)`: the repository root containing `dir`, or null when `dir` is not in a repository or git is not installed. Any OTHER failure
 *             (for example git refusing the folder as unsafe) is treated as "inside a repository": `tracked`/`ignored` then answer null.
 * `tracked(dir, name)` / `ignored(dir, name)`: true, false, or null when git could not answer (refuse: fail closed).
 */
export const realGit = {
  top(dir) {
    const r = git(['rev-parse', '--show-toplevel'], dir);
    if (r.error) return null; // git is not installed: nothing can be asked, nothing can commit it either
    if (r.status === 0) return resolve(r.stdout.trim());
    if (/not a git repository/i.test(r.stderr ?? '')) return null;
    return resolve(dir); // git answered with some other fatal error: stay careful, let the next questions refuse
  },
  tracked(dir, name) {
    const r = git(['ls-files', '--error-unmatch', '--', name], dir);
    if (r.error) return null;
    if (r.status === 0) return true;
    return r.status === 1 ? false : null;
  },
  ignored(dir, name) {
    const r = git(['check-ignore', '-q', '--', name], dir);
    if (r.error) return null;
    if (r.status === 0) return true;
    return r.status === 1 ? false : null;
  },
};

const defaultFs = { realpath: (p) => realpathSync.native(p) };

const TRACKED_MESSAGE = 'this file is TRACKED by git, so its values could be uploaded. Remove it from git first (git rm --cached) and rotate the keys it holds';
const NOT_IGNORED_MESSAGE = 'this file is not listed in .gitignore, so a commit could pick it up. Use the default name .secrets.local, which is ignored';
const UNKNOWN_MESSAGE = 'git could not say whether this file is tracked or ignored, so it is not safe to use. Run `git status` in the project folder to see what git reports, then try again';

/** The path as given plus, when it differs, its real path (symbolic links and junctions resolved). Both are checked. */
function pathsToCheck(file, fsApi) {
  const abs = resolve(file);
  const out = [abs];
  try {
    const real = fsApi.realpath(abs);
    if (real && !out.includes(real)) out.push(real);
  } catch {
    // the file does not exist (the caller checks that) or cannot be resolved: the given path is still checked
  }
  return out;
}

/**
 * Refuse a secrets file that git knows about or would pick up. A file outside any git repository is fine.
 * @param {string} file
 * @param {typeof realGit} [gitApi]
 * @param {{ realpath: (p: string) => string }} [fsApi]
 * @returns {string | null} the reason to refuse, or null when the file may be used
 */
export function secretsFileProblem(file, gitApi = realGit, fsApi = defaultFs) {
  for (const path of pathsToCheck(file, fsApi)) {
    const dir = dirname(path);
    const name = basename(path);
    if (gitApi.top(dir) === null) continue; // not in a repository: nothing can commit it
    const tracked = gitApi.tracked(dir, name);
    if (tracked === true) return TRACKED_MESSAGE;
    if (tracked === null) return UNKNOWN_MESSAGE;
    const ignored = gitApi.ignored(dir, name);
    if (ignored === null) return UNKNOWN_MESSAGE;
    if (!ignored) return NOT_IGNORED_MESSAGE;
  }
  return null;
}
