// Public competition pages (platform wave 3) on a NON-STRICT build with the FICTIONAL seed (PS_COMPETITION_SOURCE unset). Written
// for the lead to run under the heavy lock after `npm run build` (Chromium, phone sizes from the Playwright config). Checks: the
// sample notice and noindex, protected players never named, the junior event names nobody, no "Live" badge on a static page, India
// times, no horizontal page scroll, no request off the local server, no serious axe finding.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TOURNAMENT = '/competitions/sample-city-open-2026/';
const MS = '/competitions/sample-city-open-2026/ms/';
const BS = '/competitions/sample-city-open-2026/bs-u15/';
const XD = '/competitions/sample-city-open-2026/xd-open/';
const WD = '/competitions/demo-corporate-shuttle-league-2026/wd/';
const RANKINGS = '/competitions/rankings/';
const COLLEGE = '/competitions/trial-college-games-2026/ms/';

async function open(page: Page, url: string): Promise<string[]> {
  const stray: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') stray.push(r.url());
  });
  const res = await page.goto(url);
  expect(res?.status()).toBe(200);
  return stray;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} vs viewport ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}

async function axeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

async function sampleAndNoindex(page: Page): Promise<void> {
  await expect(page.locator('[data-competition-sample]')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
}

test.describe('competition pages with the fictional seed', () => {
  for (const url of ['/competitions/', TOURNAMENT, MS, BS, XD, WD, RANKINGS, COLLEGE]) {
    test(`${url}: sample notice, noindex, no stray request, no horizontal scroll, axe clean`, async ({ page }) => {
      const stray = await open(page, url);
      await sampleAndNoindex(page);
      await noHorizontalScroll(page);
      await axeClean(page);
      await expect(page.locator('[data-status-badge="live"]')).toHaveCount(0);
      expect(stray).toEqual([]);
    });
  }

  test('the list links the tournament, the tournament links its events', async ({ page }) => {
    await open(page, '/competitions/');
    await page.getByRole('link', { name: 'Sample City Open 2026' }).click();
    await expect(page).toHaveURL(new RegExp(`${TOURNAMENT}$`));
    await page.getByRole('link', { name: "Men's singles" }).click();
    await expect(page).toHaveURL(new RegExp(`${MS}$`));
  });

  test("men's singles: the protected player is never named and has no link", async ({ page }) => {
    await open(page, MS);
    const body = page.locator('main');
    await expect(body.getByText('Protected player').first()).toBeVisible();
    await expect(page.locator('a[href*="/players/"]')).toHaveCount(0);
    await expect(body.locator('[data-bracket]')).toContainText('advances without a match');
    await expect(body.locator('[data-awaiting-note]')).toBeVisible();
    // times are India time
    await expect(body.locator('[data-schedule]')).toContainText('IST');
    // a once-per-build snapshot says when it was taken
    await expect(body.locator('[data-updated-note]')).toContainText('Updated');
    await expect(body.locator('[data-updated-note]')).toContainText('India time');
  });

  test('an adult event in a minor-signal tournament names nobody', async ({ page }) => {
    await open(page, COLLEGE);
    await expect(page.locator('[data-junior-note]')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Trial College Leak');
  });

  test('the junior event names nobody', async ({ page }) => {
    await open(page, BS);
    await expect(page.locator('[data-junior-note]')).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toContain('Trial Junior');
    await expect(page.locator('[data-entry-list] tbody th')).toHaveText(Array(4).fill('Protected player'));
    expect(text).toContain('Protected player');
  });

  test('a doubles pair with a protected player is masked as a whole', async ({ page }) => {
    await open(page, XD);
    await expect(page.locator('main')).not.toContainText('Mock Prakash D');
    await expect(page.locator('main')).toContainText('Protected player / Protected player');
    // a group event lists its entries once, in the group tables
    await expect(page.locator('#entries-title')).toHaveCount(0);
  });

  test('rankings carry the not-official label and leave protected players out', async ({ page }) => {
    await open(page, RANKINGS);
    await expect(page.locator('[data-ranking-label]').first()).toHaveText('Local Power Smash ranking, not an official BWF ranking');
    await expect(page.locator('[data-ranking]')).toHaveCount(1);
    await expect(page.locator('main [data-ranking]')).not.toContainText('Protected player');
    await expect(page.locator('main')).not.toContainText('Trial Junior');
  });
});
