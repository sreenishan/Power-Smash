// The hide-section rule (D-034) and its marker (review findings B-8 and C-3): a hidden section leaves
// <template data-owner-hidden="name"> so the release gate can list it, and EVERY call site passes a unique name.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OWNER_SECTION_NAME, decideOwnerSection, isSupplied } from '../../src/components/site/owner-section';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

describe('isSupplied: what counts as "the owner gave the input"', () => {
  it('treats null, undefined, false, 0, NaN, empty and blank text and empty arrays as NOT supplied', () => {
    for (const value of [null, undefined, false, 0, Number.NaN, '', '   ', '\n\t', []]) {
      expect(isSupplied(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('treats real text, numbers, true, objects and non-empty arrays as supplied', () => {
    for (const value of ['x', ' x ', 1, -1, true, { a: 1 }, ['a'], [0]]) {
      expect(isSupplied(value), JSON.stringify(value)).toBe(true);
    }
  });
});

describe('decideOwnerSection: show the content, or leave the named marker', () => {
  it('shows the content when the input is supplied (the name is not needed)', () => {
    expect(decideOwnerSection('https://example.test/channel', 'whatsapp-channel')).toEqual({ kind: 'show' });
    expect(decideOwnerSection(['a'], 'about-districts')).toEqual({ kind: 'show' });
    expect(decideOwnerSection('text')).toEqual({ kind: 'show' });
  });

  it('hides it and leaves the name as the marker when the input is missing', () => {
    expect(decideOwnerSection(null, 'footer-legal-name')).toEqual({ kind: 'hidden', marker: 'footer-legal-name' });
    expect(decideOwnerSection([], 'about-team')).toEqual({ kind: 'hidden', marker: 'about-team' });
    expect(decideOwnerSection('  ', 'about-story')).toEqual({ kind: 'hidden', marker: 'about-story' });
    expect(decideOwnerSection(undefined, 'a')).toEqual({ kind: 'hidden', marker: 'a' });
  });

  it('a hidden call site with no name still leaves a marker (listed by the gate as "(unnamed)")', () => {
    expect(decideOwnerSection(null)).toEqual({ kind: 'hidden', marker: '' });
    expect(decideOwnerSection(null, '')).toEqual({ kind: 'hidden', marker: '' });
    expect(decideOwnerSection(null, null)).toEqual({ kind: 'hidden', marker: '' });
  });

  it('throws for a name that is not kebab-case, so a typo fails the build instead of hiding silently', () => {
    for (const bad of ['About Story', 'about_story', 'About', '-x', 'x'.repeat(41), 'a"b', 'a b']) {
      expect(() => decideOwnerSection(null, bad), bad).toThrow(/kebab-case/);
    }
    expect(() => decideOwnerSection(null, 'x'.repeat(40))).not.toThrow();
  });

  it('exports the same name rule the release gate relies on', () => {
    expect(OWNER_SECTION_NAME.test('home-whatsapp-channel')).toBe(true);
    expect(OWNER_SECTION_NAME.test('Home')).toBe(false);
  });
});

// ---- source scan: every call site has a unique, valid name ------------------------------------------------------------------
function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...astroFiles(abs));
    else if (name.endsWith('.astro')) out.push(abs);
  }
  return out;
}

interface CallSite {
  file: string;
  tag: string;
  name: string | null;
  /** The name is an expression (a wrapper component passes its own prop). */
  dynamic: boolean;
}

function callSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const abs of astroFiles(join(ROOT, 'src'))) {
    const file = relative(ROOT, abs).replaceAll('\\', '/');
    if (file === 'src/components/site/OwnerSection.astro') continue;
    // drop whole-line // comments (they mention the tag in prose)
    const text = readFileSync(abs, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    for (const m of text.matchAll(/<OwnerSection\b([^>]*)>/g)) {
      const attrs = m[1] ?? '';
      const literal = /\bname="([^"]*)"/.exec(attrs);
      const dynamic = /\bname=\{/.test(attrs);
      sites.push({ file, tag: m[0], name: literal ? (literal[1] as string) : null, dynamic });
    }
  }
  return sites;
}

const sites = callSites();
// The shell group's own files. The other groups' pages are checked in the next test so a failure names its owner.
const SHELL_PAGES = new Set([
  'src/pages/index.astro',
  'src/pages/services.astro',
  'src/pages/pricing.astro',
  'src/pages/support.astro',
  'src/pages/about.astro',
  'src/pages/404.astro',
  'src/pages/500.astro',
]);
const isShell = (file: string): boolean =>
  file.startsWith('src/components/site/') || file.startsWith('src/components/ui/') || file.startsWith('src/layouts/') || SHELL_PAGES.has(file) || file.startsWith('src/pages/tournaments/index') || file.startsWith('src/pages/tournaments/[slug]');

describe('every OwnerSection call site passes a unique kebab-case name', () => {
  it('finds the call sites in the shell files', () => {
    const shell = sites.filter((s) => isShell(s.file));
    expect(shell.length).toBeGreaterThanOrEqual(13);
  });

  it('shell files: each call site has a name (a literal, or a wrapper component passing its own prop)', () => {
    const missing = sites.filter((s) => isShell(s.file) && s.name === null && !s.dynamic);
    expect(missing.map((s) => `${s.file}: ${s.tag}`)).toEqual([]);
  });

  it('other pages and components (contact, partner and any future file): each call site has a name', () => {
    const missing = sites.filter((s) => !isShell(s.file) && s.name === null && !s.dynamic);
    expect(missing.map((s) => `${s.file}: ${s.tag}`)).toEqual([]);
  });

  it('literal names are valid and unique across the whole site', () => {
    const literal = sites.filter((s) => s.name !== null);
    for (const s of literal) expect(OWNER_SECTION_NAME.test(s.name as string), `${s.file}: ${s.name}`).toBe(true);
    const seen = new Map<string, string>();
    const repeats: string[] = [];
    for (const s of literal) {
      const key = s.name as string;
      if (seen.has(key)) repeats.push(`${key} (${seen.get(key)} and ${s.file})`);
      else seen.set(key, s.file);
    }
    expect(repeats).toEqual([]);
  });

  it('the wrapper components take the name from a prop, with a default, so each of THEIR call sites can name itself', () => {
    for (const file of ['src/components/site/SponsorStrip.astro', 'src/components/ui/FaqList.astro']) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text, file).toMatch(/<OwnerSection when=\{shown\} name=\{name\}>/);
      expect(text, file).toMatch(/name = '[a-z-]+'/);
    }
  });

  it('the footer, home and support pages give their WhatsApp Channel sections different names', () => {
    const names = sites.filter((s) => /whatsapp-channel/.test(s.name ?? '')).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['footer-whatsapp-channel', 'home-whatsapp-channel', 'support-whatsapp-channel']));
  });
});
