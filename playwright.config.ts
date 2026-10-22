// Playwright (Chromium only) against the ALREADY BUILT site: run `node scripts/with-lock.mjs heavy -- npm run build` first, then
// `node scripts/with-lock.mjs heavy -- npm run e2e`. The web server is scripts/serve-output.mjs serving .vercel/output/static
// (`astro preview` does not work with the Vercel adapter) and applying the header routes from .vercel/output/config.json, so the real CSP
// is enforced. Started and stopped by Playwright, never left running. Cloudflare Turnstile is never called: the tests stub the Turnstile script and /api/* (tests/e2e/helpers.ts).
// No traces, screenshots or videos are recorded (they could hold typed form values). Test data is fictional.
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { STATIC_DIR } from './scripts/lib/output-paths.mjs';

const PORT = 4399;

if (!existsSync(`${STATIC_DIR}/index.html`)) {
  throw new Error(`${STATIC_DIR} is missing: run "npm run build" (under the heavy lock) before "npm run e2e".`);
}

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `node scripts/serve-output.mjs --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
