import { defineConfig } from 'vitest/config';

// D-002: Vitest has its OWN config and does NOT load the Astro/Vercel Vite plugins.
// Pure-logic tests (parser helpers, formatters) run in plain Node.
//
// `npm test` = every test, including the parser fixtures (fixtures.red.test.ts, real-titles.smoke.test.ts):
// M2b implemented parseTitle, so the RED_TESTS exclude of M0 is gone. vitest.red.config.ts only remains so the
// `test:red` script keeps working until the lead deletes the script (docs/m1/m2b-notes.md).

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,mjs}', 'src/**/*.test.ts', 'scripts/**/*.test.{ts,mjs}'],
    exclude: ['node_modules/**', 'dist/**', 'spike/**'],
  },
});