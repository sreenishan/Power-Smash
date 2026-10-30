import { defineConfig } from 'vitest/config';

// D-002: Vitest has its OWN config and does NOT load the Astro/Vercel Vite plugins.
// Pure-logic tests (parser helpers, formatters) run in plain Node.
//
// `npm test` = every test, including the parser fixtures (fixtures.red.test.ts, real-titles.smoke.test.ts):
// M2b implemented parseTitle, so the RED_TESTS exclude of M0 is gone. vitest.red.config.ts only remains so the
// `test:red` script keeps working until the lead deletes the script (docs/m1/m2b-notes.md).

export default defineConfig({
  // The admin screens (src/admin/**/*.tsx) are React. tsconfig keeps `jsx: preserve` for Astro, so the test transform is told to
  // compile JSX with the automatic React runtime (Vite 8 transforms with oxc). No DOM is installed: render tests use
  // react-dom/server renderToStaticMarkup in plain Node (tests/admin-ui/competition-render.test.ts).
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx,mjs}', 'src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    exclude: ['node_modules/**', 'dist/**', 'spike/**'],
  },
});