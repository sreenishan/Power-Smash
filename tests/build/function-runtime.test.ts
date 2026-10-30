// The Node version of the Vercel FUNCTIONS (/api/*, /go/*, the admin actions) in the BUILT output. @astrojs/vercel writes the runtime
// from the Node major of the machine that builds (getRuntime in the adapter), and every workflow sets that Node up from .nvmrc. This test
// ties the three together: the functions run on the same major as .nvmrc, which is also the major of @types/node (Dependabot ignores
// @types/node majors, D-002). Reads .vercel/output; skipped when there is no build (see ./helpers.ts for how CI runs it after the build).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, hasDist } from './helpers';

const FUNCTIONS = join(ROOT, '.vercel', 'output', 'functions');
const nvmrcMajor = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0];

describe.skipIf(!hasDist || !existsSync(FUNCTIONS))('the Vercel function runtime in the build (.vercel/output/functions)', () => {
  it('every function runs on the Node major in .nvmrc', () => {
    const configs = readdirSync(FUNCTIONS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.vc-config.json'));
    expect(configs.length, 'the build has at least one function').toBeGreaterThan(0);
    for (const f of configs) {
      const { runtime } = JSON.parse(readFileSync(join(FUNCTIONS, f), 'utf8')) as { runtime?: string };
      expect(runtime, f).toBe(`nodejs${nvmrcMajor}.x`);
    }
  });

  it('@types/node is pinned to the same major', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.['@types/node']?.split('.')[0]).toBe(nvmrcMajor);
  });
});
