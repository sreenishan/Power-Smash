// Near-live scores on an event page (D-113). Written for the lead to run under the heavy lock after `npm run build` (Chromium, the
// phone sizes of the Playwright config); NOT run by the wave 5 agent.
//
// 1. Always: with features.liveScores off (the default) an event page carries no live region and never asks /api/live-scores.
// 2. Only when PS_E2E_LIVE_PAGE names an event page built with features.liveScores on and a real (uuid) event id, for example a
//    private preview build with PS_COMPETITION_SOURCE=supabase: the endpoint is answered by a route stub (fictional names), and the
//    test checks the region appears, the summary is polite, "Protected player" stays masked, the score is a real table, the page
//    asks again after a minute only while it is visible, and a {live:false} answer hides the region again.
import { expect, test, type Route } from '@playwright/test';

const SEED_EVENT = '/competitions/sample-city-open-2026/ms/';
const LIVE_PAGE = process.env.PS_E2E_LIVE_PAGE ?? '';

function liveAnswer(over: Record<string, unknown> = {}) {
  return {
    live: true,
    eventId: '00000000-0000-4000-8000-000000000001',
    windowSeconds: 300,
    checkedAt: '2026-11-07T05:13:00.000Z',
    checkedAtText: '10:43 am IST',
    matches: [
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        label: 'Final · Court 2',
        status: 'live',
        isLive: true,
        statusText: 'Live',
        sideA: 'Demo Arun',
        sideB: 'Protected player',
        games: [{ a: 21, b: 19 }],
        current: { a: 7, b: 5 },
        gameNumber: 2,
        gamesWon: { a: 1, b: 0 },
        server: 'A',
        lastUpdate: '2026-11-07T05:12:00.000Z',
        lastUpdateText: '10:42 am IST',
      },
    ],
    ...over,
  };
}

test('with the switch off an event page has no live region and asks nothing', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/live-scores')) asked.push(r.url());
  });
  const res = await page.goto(SEED_EVENT);
  expect(res?.status()).toBe(200);
  await expect(page.locator('[data-live-scores]')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(asked).toEqual([]);
  await expect(page.locator('[data-status-badge="live"]')).toHaveCount(0);
});

test.describe('with the switch on (needs PS_E2E_LIVE_PAGE)', () => {
  test.skip(LIVE_PAGE === '', 'set PS_E2E_LIVE_PAGE to an event page built with features.liveScores on');

  test('shows the stubbed live match as text, masked, in a table, and stops when nothing is live', async ({ page }) => {
    let calls = 0;
    let answer: unknown = liveAnswer();
    await page.clock.install();
    await page.route('**/api/live-scores/*', async (route: Route) => {
      calls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=15' }, body: JSON.stringify(answer) });
    });
    await page.goto(LIVE_PAGE);
    const region = page.locator('[data-live-scores]');
    await expect(region).toBeVisible();
    await expect(page.locator('[data-live-summary]')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('[data-live-summary]')).toHaveText('Live now: 1 match.');
    await expect(region.locator('h3')).toHaveText('Demo Arun versus Protected player');
    await expect(region.locator('table caption')).toHaveCount(1);
    await expect(region.locator('th[scope="row"]').first()).toContainText('Demo Arun (serving)');
    expect(calls).toBe(1);

    // a minute later it asks again (visible page, a live match)
    await page.clock.runFor(60_000);
    await expect.poll(() => calls).toBe(2);

    // nothing live any more: the region hides and the page stops asking
    answer = { live: false };
    await page.clock.runFor(60_000);
    await expect(region).toBeHidden();
    const after = calls;
    await page.clock.runFor(180_000);
    expect(calls).toBe(after);
  });

  test('no horizontal scroll at phone width with a doubles match', async ({ page }) => {
    await page.route('**/api/live-scores/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(liveAnswer({ matches: [{ ...liveAnswer().matches[0], sideA: 'Demo Arunachalam Venkatesan / Demo Balasubramanian Krishnan', games: [{ a: 21, b: 19 }, { a: 19, b: 21 }], gameNumber: 3 }] })),
      }),
    );
    await page.goto(LIVE_PAGE);
    await expect(page.locator('[data-live-scores]')).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
});
