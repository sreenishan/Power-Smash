// The production entry point exports no fake provider and no scraping code; the FakeProvider stays in tests/.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as providers from '../../src/lib/providers/index';

const SRC = fileURLToPath(new URL('../../src/lib/providers/', import.meta.url));
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

describe('international data: production entry point', () => {
  it('exports no fake or test provider', () => {
    for (const name of Object.keys(providers)) expect(name.toLowerCase()).not.toMatch(/fake|mock|fixture|test/);
  });

  it('no production file imports from tests/ or mentions the FakeProvider', () => {
    for (const f of files) {
      const text = readFileSync(join(SRC, f), 'utf8');
      expect(text).not.toMatch(/from ['"][^'"]*tests\//);
      expect(text).not.toMatch(/FakeProvider/);
    }
  });

  it('no production file fetches anything or names a site to scrape', () => {
    for (const f of files) {
      const code = readFileSync(join(SRC, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/bwfbadminton\.com|tournamentsoftware\.com|https?:\/\//i);
      expect(code).not.toMatch(/Math\.random|Date\.now\(/);
    }
  });

  it('the production registry has no providers', () => {
    expect(providers.createProductionRegistry().ids()).toEqual([]);
  });
});
