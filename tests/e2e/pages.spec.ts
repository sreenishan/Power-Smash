// Layout and accessibility checks on the money pages and the four form pages: no horizontal scroll (360 and 390 px projects) and
// no critical or serious axe violation (WCAG 2.0/2.1 A and AA rules). Cloudflare is stubbed (helpers.ts).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FORM_PAGES, OTHER_PAGES, installStubs, waitForHydration } from './helpers';

const ALL_PAGES = [...FORM_PAGES, ...OTHER_PAGES];

for (const path of ALL_PAGES) {
  test(`${path} has no horizontal scroll`, async ({ page }) => {
    await installStubs(page);
    await page.goto(path);
    await page.waitForLoadState('load');
    if ((FORM_PAGES as readonly string[]).includes(path)) await waitForHydration(page);
    const { scrollWidth, clientWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `scrollWidth ${scrollWidth} vs viewport ${innerWidth}`).toBeLessThanOrEqual(Math.max(clientWidth, innerWidth));
  });

  test(`${path} has zero critical or serious axe violations`, async ({ page }) => {
    await installStubs(page);
    await page.goto(path);
    await page.waitForLoadState('load');
    if ((FORM_PAGES as readonly string[]).includes(path)) await waitForHydration(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
    expect(summary).toEqual([]);
  });
}
