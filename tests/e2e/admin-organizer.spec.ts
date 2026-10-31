// Smoke tests for the organizer and scorer screens (D-108, D-117, D-122, migration 0024). The admin runs in PREVIEW mode (no Supabase
// build variables) with `?preview-as=organizer` or `?preview-as=scorer`: the in-memory store with FICTIONAL data answers as the admin
// function does for that role (the made-up account is given the Demo Open Cup). No network. Chromium at 360 and 390 px. No trace or
// screenshot is kept. Every page load starts from the same fictional seed.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// fictional seed ids (src/lib/admin/memory-store.ts SEED.t1, src/lib/admin/competition/memory-backend.ts COMP_SEED)
const TOURNAMENT = '20000000-0000-4000-8000-000000000001';
const EVENT_MS = '81000000-0000-4000-8000-000000000001';
const EVENT_WS = '81000000-0000-4000-8000-000000000002';

async function open(page: Page, role: 'organizer' | 'scorer', hash: string): Promise<string[]> {
  const stray: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost') stray.push(r.url());
  });
  await page.goto(`/admin/?preview-as=${role}${hash}`);
  await expect(page.getByText('Preview with made-up data')).toBeVisible();
  await expect(page.getByText(role === 'organizer' ? 'You are seeing what an organizer sees.' : 'You are seeing what a scorer sees.')).toBeVisible();
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

test.describe('organizer', () => {
  test('sees only Competitions and Scoring; no rankings link but a plain sentence; event setup and courts are there', async ({ page }) => {
    const stray = await open(page, 'organizer', '#/competitions');
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav.getByRole('link')).toHaveCount(2);
    await expect(nav.getByRole('link', { name: 'Competitions' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Scoring' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Rankings and points table/ })).toHaveCount(0);
    await expect(page.getByText("Rankings and the points table are the owner's job.")).toBeVisible();
    const card = page.getByRole('article', { name: 'Demo Open Cup' });
    await expect(card.getByRole('link', { name: 'Add an event' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Courts and schedule' })).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);
    expect(stray).toEqual([]);
  });

  test('an owner-only address shows a plain sentence, and other areas fall back to Competitions', async ({ page }) => {
    await open(page, 'organizer', '#/competitions/rankings');
    await expect(page.getByText("Rankings and the points table are the owner's job.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Work out the ranking' })).toHaveCount(0);
    for (const area of ['#/accounts', '#/prices', '#/settings', '#/videos', '#/registrations', '#/notices', '#/more']) {
      await page.goto(`/admin/?preview-as=organizer${area}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Competitions');
    }
  });

  test('the "On the site" preview tells the truth: only the unknown-age player is shown as protected', async ({ page }) => {
    await open(page, 'organizer', `#/competitions/event/${EVENT_WS}/entries`);
    await expect(page.getByRole('article', { name: 'Entry Demo Meena Samplestone' }).getByText('On the site: Protected player')).toBeVisible();
    await expect(page.getByText('On the site: Protected player')).toHaveCount(1);
  });

  test('finds a player with their own search (3 letters, id and name only) and adds a new player when no name matches exactly', async ({ page }) => {
    const stray = await open(page, 'organizer', `#/competitions/event/${EVENT_MS}/entries`);
    const form = page.getByRole('form', { name: 'Add an entry' });
    await expect(form.getByText('Type at least 3 letters of the name.')).toBeVisible();
    await expect(form.getByText(/Players screen/)).toHaveCount(0);
    await form.getByLabel('Find a player').fill('Samplestone');
    const found = form.getByRole('list', { name: 'Players found' });
    // the name is shown once on screen; the Choose button repeats it for screen readers only
    await expect(found.getByRole('listitem').filter({ hasText: 'Demo Meena Samplestone' })).toBeVisible();
    await expect(found.getByRole('button', { name: 'Choose Demo Meena Samplestone' })).toBeVisible();
    // no age label and no naming flag reach an organizer's search (D-012); the entry card shows the badge once entered
    await expect(found.getByText(/Unknown age|Adult|On the site/)).toHaveCount(0);

    await form.getByLabel('Find a player').fill('Demo Newcomer Fakely');
    await expect(form.getByText(/Not in the list\? You can add them/)).toBeVisible();
    await expect(form.getByLabel("New player's full name")).toHaveValue('Demo Newcomer Fakely');
    await form.getByRole('button', { name: 'Add as a new player' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Add Demo Newcomer Fakely as a new player?' });
    await expect(dlg.getByText(/cannot be renamed or removed by you/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Add the player' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Demo Newcomer Fakely added as a new player.' })).toBeVisible();
    await expect(form.getByRole('list', { name: 'Chosen players' }).getByRole('listitem').filter({ hasText: 'Demo Newcomer Fakely' })).toBeVisible();
    await form.getByLabel('Status').selectOption('pending');
    await form.getByRole('button', { name: 'Add the entry' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Entry added.' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Entry Demo Newcomer Fakely' }).getByText('On the site: Protected player')).toBeVisible();

    // a phone number is not a name
    await form.getByLabel('Find a player').fill('Demo 910000000000');
    await form.getByLabel("New player's full name").fill('Demo 910000000000');
    await form.getByRole('button', { name: 'Add as a new player' }).click();
    await expect(form.getByText("Type the player's name only, no phone number or email.").first()).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);
    expect(stray).toEqual([]);
  });

  test('courts: adds a court; venues are the owner\'s job', async ({ page }) => {
    await open(page, 'organizer', `#/competitions/tournament/${TOURNAMENT}`);
    await expect(page.getByRole('form', { name: 'Add a court' })).toBeVisible();
    await expect(page.getByText('Add a venue')).toHaveCount(0);
    await expect(page.getByText(/only the owner adds them/)).toBeVisible();
    await noHorizontalScroll(page);
  });
});

test.describe('scorer', () => {
  test('lands on the scoring console; Competitions shows matches only, without event setup, courts, entries or the draw', async ({ page }) => {
    const stray = await open(page, 'scorer', '');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live scoring');
    await expect(page.getByText("Whether the website shows live scores is the owner's choice, not yours.")).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav.getByRole('link')).toHaveCount(2);
    await nav.getByRole('link', { name: 'Competitions' }).click();
    const card = page.getByRole('article', { name: 'Demo Open Cup' });
    await expect(card.getByRole('link', { name: 'Add an event' })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Courts and schedule' })).toHaveCount(0);
    await card.getByRole('link', { name: /Men's singles/ }).click();
    await expect(page.getByRole('navigation', { name: 'Parts of this event' })).toHaveCount(0);
    await expect(page.getByText('Change the event details')).toHaveCount(0);
    await expect(page.getByText(/They appear here when the organizer publishes the draw/)).toBeVisible();
    await noHorizontalScroll(page);
    await axeClean(page);
    expect(stray).toEqual([]);
  });

  test('an entries or draw address shows the matches instead; the courts address shows a plain sentence', async ({ page }) => {
    await open(page, 'scorer', `#/competitions/event/${EVENT_MS}/entries`);
    await expect(page.getByRole('form', { name: 'Add an entry' })).toHaveCount(0);
    await page.goto(`/admin/?preview-as=scorer#/competitions/event/${EVENT_MS}/draw`);
    await expect(page.getByRole('button', { name: 'Make the draw' })).toHaveCount(0);
    await page.goto(`/admin/?preview-as=scorer#/competitions/tournament/${TOURNAMENT}`);
    await expect(page.getByText(/Courts and the order of play are set by the tournament organizer or the owner/)).toBeVisible();
  });
});
