// Review finding S-8: the secrets loader must ask GIT whether a file is tracked or ignored, not compare path strings.
// Real git repositories in temp folders; junctions and symbolic links as far as Windows allows (a junction needs no privilege, a file
// symbolic link may; those tests skip themselves when the PC refuses).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { realGit, secretsFileProblem } from '../../scripts/lib/secrets-file.mjs';
import { insideProject, realPathOfNearest } from '../../scripts/make-age-keys.mjs';
import { cleanupTemp, ROOT, tempDir } from './helpers';

afterEach(cleanupTemp);
// Many short git processes (and PowerShell for the short-name case): slow on a busy Windows PC.
vi.setConfig({ testTimeout: 90_000 });

const haveGit = spawnSync('git', ['--version']).status === 0;
const it_ = haveGit ? it : it.skip;
const TRACKED = /TRACKED by git/;
const NOT_IGNORED = /not listed in \.gitignore/;
const SECRETS_MODULE = pathToFileURL(join(ROOT, 'scripts', 'lib', 'secrets-file.mjs')).href;

/** A temp git repository with a tracked file, an ignored file and an untracked, not ignored file. */
function makeRepo(): string {
  const repo = tempDir('ps-s8-');
  const run = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  run('init', '-q');
  writeFileSync(join(repo, '.gitignore'), '.secrets.local\n');
  writeFileSync(join(repo, 'secrets.txt'), 'x');
  writeFileSync(join(repo, '.secrets.local'), 'x');
  writeFileSync(join(repo, 'plain.txt'), 'x');
  mkdirSync(join(repo, 'sub'));
  writeFileSync(join(repo, 'sub', 'tracked-in-sub.txt'), 'x');
  run('add', 'secrets.txt', '.gitignore', 'sub/tracked-in-sub.txt');
  return repo;
}

/** A junction (or null when the PC will not make one). Removed with the temp folder: the junction is deleted FIRST so rm never follows it. */
function makeJunction(target: string): string | null {
  const link = tempDir('ps-s8-link-') + '-j';
  try {
    symlinkSync(target, link, 'junction');
    return link;
  } catch {
    return null;
  }
}

const runRelative = (cwd: string, relative: string): string => {
  const code = `import { secretsFileProblem } from ${JSON.stringify(SECRETS_MODULE)}; console.log(JSON.stringify(secretsFileProblem(${JSON.stringify(relative)})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8' });
  return r.stdout.trim();
};

describe('secretsFileProblem asks git from the file\'s own folder', () => {
  it_('control: a direct path to a tracked, an ignored and a plain file', () => {
    const repo = makeRepo();
    expect(secretsFileProblem(join(repo, 'secrets.txt'))).toMatch(TRACKED);
    expect(secretsFileProblem(join(repo, '.secrets.local'))).toBeNull();
    expect(secretsFileProblem(join(repo, 'plain.txt'))).toMatch(NOT_IGNORED);
    expect(secretsFileProblem(join(repo, 'sub', 'tracked-in-sub.txt'))).toMatch(TRACKED);
  });

  it_('a junction into the repository does not hide a tracked file (the original bypass)', () => {
    const repo = makeRepo();
    const link = makeJunction(repo);
    if (link === null) return;
    try {
      expect(secretsFileProblem(join(link, 'secrets.txt'))).toMatch(TRACKED);
      expect(secretsFileProblem(join(link, 'plain.txt'))).toMatch(NOT_IGNORED);
      expect(secretsFileProblem(join(link, '.secrets.local'))).toBeNull();
      expect(secretsFileProblem(join(link, 'sub', 'tracked-in-sub.txt'))).toMatch(TRACKED);
    } finally {
      rmSync(link, { recursive: true, force: false }); // removes the junction only
    }
  });

  it_('documents the cause: through the junction a string comparison of the paths says "outside the repository"', () => {
    const repo = makeRepo();
    const link = makeJunction(repo);
    if (link === null) return;
    try {
      const viaJunction = join(link, 'secrets.txt');
      const top = realGit.top(link) as string;
      expect(resolve(top)).not.toBe(resolve(link)); // git reports the REAL root, the path we hold is the junction
      expect(viaJunction.startsWith(top)).toBe(false);
    } finally {
      rmSync(link, { recursive: true, force: false });
    }
  });

  it_('a relative path, with or without .. segments, is judged by git from where it points', () => {
    const repo = makeRepo();
    expect(runRelative(repo, 'secrets.txt')).toMatch(TRACKED);
    expect(runRelative(repo, './plain.txt')).toMatch(NOT_IGNORED);
    expect(runRelative(repo, '.secrets.local')).toBe('null');
    expect(runRelative(join(repo, 'sub'), '../secrets.txt')).toMatch(TRACKED);
    expect(runRelative(join(repo, 'sub'), 'tracked-in-sub.txt')).toMatch(TRACKED);
    expect(runRelative(join(repo, 'sub'), '../sub/../plain.txt')).toMatch(NOT_IGNORED);
  });

  it_('a file symbolic link outside the repository that points at a tracked file is refused (real path is checked too)', () => {
    const repo = makeRepo();
    const outside = tempDir('ps-s8-out-');
    const link = join(outside, 'innocent.txt');
    try {
      symlinkSync(join(repo, 'secrets.txt'), link, 'file');
    } catch {
      return; // creating file symbolic links needs a privilege this PC does not give
    }
    expect(secretsFileProblem(link)).toMatch(TRACKED);
  });

  it_('a Windows short (8.3) name of the repository folder does not hide a tracked file', () => {
    if (process.platform !== 'win32') return;
    const repo = makeRepo();
    // the path travels in an environment variable, so no quoting can mangle it
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:PS_TARGET).ShortPath'], {
      encoding: 'utf8',
      env: { ...process.env, PS_TARGET: repo },
    });
    const shortFolder = r.stdout.trim();
    if (r.status !== 0 || shortFolder === '' || shortFolder.toLowerCase() === repo.toLowerCase()) return; // 8.3 names are switched off on this volume
    expect(secretsFileProblem(join(shortFolder, 'secrets.txt'))).toMatch(TRACKED);
    expect(secretsFileProblem(join(shortFolder, 'plain.txt'))).toMatch(NOT_IGNORED);
  });

  it_('a folder that is not a repository is allowed, and so is a file that does not exist yet', () => {
    const plain = tempDir('ps-s8-plain-');
    writeFileSync(join(plain, 's.txt'), 'x');
    expect(secretsFileProblem(join(plain, 's.txt'))).toBeNull();
  });

  it('the injected git functions get the file\'s folder and bare name, not a repository root and a relative path', () => {
    const calls: unknown[][] = [];
    const git = {
      top: (dir: string) => {
        calls.push(['top', dir]);
        return '/repo';
      },
      tracked: (dir: string, name: string) => {
        calls.push(['tracked', dir, name]);
        return false;
      },
      ignored: (dir: string, name: string) => {
        calls.push(['ignored', dir, name]);
        return true;
      },
    };
    expect(secretsFileProblem(join(resolve('/repo/deep'), '.secrets.local'), git, { realpath: () => { throw new Error('x'); } })).toBeNull();
    expect(calls).toEqual([
      ['top', resolve('/repo/deep')],
      ['tracked', resolve('/repo/deep'), '.secrets.local'],
      ['ignored', resolve('/repo/deep'), '.secrets.local'],
    ]);
  });

  it('fails closed: when git cannot answer (null), the file is refused with a plain message', () => {
    const noAnswer = { top: () => '/repo', tracked: () => null, ignored: () => true };
    expect(secretsFileProblem('/repo/.secrets.local', noAnswer as never, { realpath: () => '/repo/.secrets.local' })).toMatch(/could not say/);
    const noIgnoreAnswer = { top: () => '/repo', tracked: () => false, ignored: () => null };
    expect(secretsFileProblem('/repo/.secrets.local', noIgnoreAnswer as never, { realpath: () => '/repo/.secrets.local' })).toMatch(/could not say/);
  });

  it('both the given path and its real path are checked: a problem on either one refuses the file', () => {
    const git = {
      top: () => '/r',
      tracked: (dir: string) => dir.includes('real'),
      ignored: () => true,
    };
    expect(secretsFileProblem('/link/.secrets.local', git as never, { realpath: () => '/real/.secrets.local' })).toMatch(TRACKED);
    expect(secretsFileProblem('/link/.secrets.local', git as never, { realpath: () => '/link/.secrets.local' })).toBeNull();
  });
});

describe('make-age-keys: the project folder is recognised by real path', () => {
  it('a path inside the project is inside, a path outside is not, a missing deeper path is judged through its nearest existing parent', () => {
    const root = tempDir('ps-s8-proj-');
    mkdirSync(join(root, 'keys'));
    const sibling = root + '-other';
    mkdirSync(sibling);
    try {
      expect(insideProject(join(root, 'keys', 'age.txt'), root)).toBe(true);
      expect(insideProject(join(root, 'not', 'yet', 'made', 'age.txt'), root)).toBe(true);
      expect(insideProject(root, root)).toBe(true);
      expect(insideProject(join(sibling, 'age.txt'), root)).toBe(false);
      expect(insideProject(join(root, '..', 'elsewhere', 'age.txt'), root)).toBe(false);
      mkdirSync(join(root, '..keys'));
      expect(insideProject(join(root, '..keys', 'age.txt'), root)).toBe(true); // a folder whose name merely starts with two dots
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('a junction that leads into the project is inside the project (it used to look outside)', () => {
    const root = tempDir('ps-s8-proj2-');
    mkdirSync(join(root, 'keys'));
    const link = makeJunction(root);
    if (link === null) return;
    try {
      expect(insideProject(join(link, 'keys', 'age.txt'), root)).toBe(true);
      expect(insideProject(join(link, 'new', 'age.txt'), root)).toBe(true);
      expect(realPathOfNearest(join(link, 'keys', 'age.txt')).toLowerCase()).toBe(join(realPathOfNearest(root), 'keys', 'age.txt').toLowerCase());
    } finally {
      rmSync(link, { recursive: true, force: false });
    }
  });

  it('the real project folder: a key file inside it is refused, one in the home folder is not', () => {
    expect(insideProject(join(ROOT, 'age-key.txt'))).toBe(true);
    expect(insideProject(join(tempDir('ps-s8-home-'), 'age-key.txt'))).toBe(false);
  });
});
