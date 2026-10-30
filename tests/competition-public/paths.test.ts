import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPETITION_ROUTES,
  RESERVED_COMPETITION_SLUGS,
  competitionEventPath,
  competitionTournamentPath,
  eventCode,
  isCompetitionTournamentSlug,
} from '../../src/lib/competition/public/paths';
import {
  COMPETITION_ROUTES as URL_COMPETITION_ROUTES,
  competitionEventPath as urlEventPath,
  competitionTournamentPath as urlTournamentPath,
  path,
} from '../../src/lib/urls';

describe('competition addresses', () => {
  it('fixed routes are already in the one slash form', () => {
    for (const v of Object.values(COMPETITION_ROUTES)) expect(v).toBe(path(v));
    expect(COMPETITION_ROUTES).toEqual({ index: '/competitions/', rankings: '/competitions/rankings/' });
  });

  it('the addresses live in src/lib/urls.ts and paths.ts only re-exports them', () => {
    expect(COMPETITION_ROUTES).toBe(URL_COMPETITION_ROUTES);
    expect(competitionTournamentPath).toBe(urlTournamentPath);
    expect(competitionEventPath).toBe(urlEventPath);
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'competition', 'public', 'paths.ts'), 'utf8');
    expect(src).not.toMatch(/['`]\/competitions\//);
  });

  it('the tournament and event helpers go through path()', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'urls.ts'), 'utf8');
    expect(src).toContain('competitionTournamentPath = (slug: string): string => path(`/competitions/${slug}/`)');
    expect(src).toContain('competitionEventPath = (slug: string, code: string): string => path(`/competitions/${slug}/${code}/`)');
  });

  it('each fixed competition route has a page: the catch-all route serves both', () => {
    expect(existsSync(join(__dirname, '..', '..', 'src', 'pages', 'competitions', '[...page].astro'))).toBe(true);
    expect(Object.keys(COMPETITION_ROUTES).sort()).toEqual(['index', 'rankings']);
  });

  it('tournament and event paths end with a slash', () => {
    expect(competitionTournamentPath('sample-open-2026')).toBe('/competitions/sample-open-2026/');
    expect(competitionEventPath('sample-open-2026', 'ms-u17')).toBe('/competitions/sample-open-2026/ms-u17/');
  });

  it('event codes come from the category and the age-group vocabulary', () => {
    expect(eventCode('MS', null)).toBe('ms');
    expect(eventCode('MS', 'U17')).toBe('ms-u17');
    expect(eventCode('XD', '35+')).toBe('xd-35plus');
    expect(eventCode('BS', 'sub_junior')).toBe('bs-sub-junior');
    expect(eventCode('WD', 'open')).toBe('wd-open');
  });

  it('a value outside the vocabulary gets no address', () => {
    expect(eventCode('ms', null)).toBeNull();
    expect(eventCode('MS', 'U-17 / boys')).toBeNull();
    expect(eventCode('MSX', null)).toBeNull();
  });

  it('tournament slugs follow the slug rule and avoid reserved words', () => {
    expect(isCompetitionTournamentSlug('sample-open-2026')).toBe(true);
    for (const r of RESERVED_COMPETITION_SLUGS) expect(isCompetitionTournamentSlug(r)).toBe(false);
    for (const bad of ['', 'Sample', 'a--b', '-a', 'a/b', '../x', 'x'.repeat(81), null, 5]) expect(isCompetitionTournamentSlug(bad)).toBe(false);
  });
});
