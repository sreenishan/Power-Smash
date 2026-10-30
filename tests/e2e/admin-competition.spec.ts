// Smoke tests for the Competitions area of the admin (D-108 to D-114). The admin runs in PREVIEW mode (no Supabase build variables): an
// in-memory store with FICTIONAL data (the Demo Open Cup with a men's singles knockout and a women's singles league), no network.
// Chromium at 360 and 390 px. No trace or screenshot is kept. Every page load starts from the same fictional seed.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// fictional seed ids (src/lib/admin/memory-store.ts SEED.t1, src/lib/admin/competition/memory-backend.ts COMP_SEED)
const TOURNAMENT = '20000000-0000-4000-8000-000000000001';
const EVENT_MS = '81000000-0000-4000-8000-000000000001';
const EVENT_WS = '81000000-0000-4000-8000-000000000002';

async function open(page: Page, hash: string): Promise<string[]> {
  const stray: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost') stray.push(r.url());
  });
  await page.goto(`/admin/${hash}`);
  await expect(page.getByText('Preview with made-up data')).toBeVisible();
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

async function makeAndPublishMsDraw(page: Page): Promise<void> {
  await page.goto(`/admin/#/competitions/event/${EVENT_MS}/draw`);
  const form = page.getByRole('form', { name: 'Make the draw' });
  await form.getByLabel('Draw number (optional)').fill('42');
  await form.getByRole('button', { name: 'Make the draw' }).click();
  await expect(page.getByText('Draw number 42', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish the draw' }).click();
  const dlg = page.getByRole('alertdialog', { name: 'Publish this draw?' });
  await expect(dlg.getByText('A published draw cannot be changed or made again.')).toBeVisible();
  await dlg.getByRole('button', { name: 'Publish the draw' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draw published.' })).toBeVisible();
}

test.describe('Competitions: events and entries', () => {
  test('reached from More; the sample tournament lists its events; a new event shows its scoring rules in words', async ({ page }) => {
    const stray = await open(page, '#/more');
    await page.getByRole('link', { name: /Competitions/ }).click();
    const card = page.getByRole('article', { name: 'Demo Open Cup' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: /Men's singles/ })).toBeVisible();
    await expect(page.getByText(/public competition pages are switched off/)).toBeVisible();
    await noHorizontalScroll(page);

    await card.getByRole('link', { name: 'Add an event' }).click();
    const form = page.getByRole('form', { name: /Add an event to Demo Open Cup/ });
    await expect(form.locator('#ev-ruleset-words')).toContainText('Best of 3 games (the first to win 2 wins the match), each to 21 points');
    await form.getByLabel('Category').selectOption('WD');
    await form.getByLabel('Age group').selectOption('U15');
    await expect(form.getByText(/This is a junior event/)).toBeVisible();
    await form.getByLabel('One game to 21').check();
    await expect(form.locator('#ev-ruleset-words')).toContainText('One game, each to 21 points');
    await form.getByLabel('Number of places').fill('abc');
    await form.getByRole('button', { name: 'Add the event' }).click();
    await expect(form.getByText(/Type the number of places/)).toBeVisible();
    await form.getByLabel('Number of places').fill('16');
    await form.getByRole('button', { name: 'Add the event' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Event added.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Women's doubles U15/ })).toBeVisible();
    await noHorizontalScroll(page);
    expect(stray).toEqual([]);
  });

  test('the owner sees the unknown-age player by name, marked as "Protected player" on the site; withdrawing needs a reason', async ({ page }) => {
    await open(page, `#/competitions/event/${EVENT_WS}/entries`);
    const entry = page.getByRole('article', { name: 'Entry Demo Meena Samplestone' });
    await expect(entry).toBeVisible();
    await expect(entry.getByText('On the site: Protected player')).toBeVisible();
    await noHorizontalScroll(page);

    await entry.getByRole('button', { name: 'Withdraw' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Withdraw Demo Meena Samplestone?' });
    await dlg.getByRole('button', { name: 'Withdraw' }).click();
    await expect(dlg.getByText(/at least 3 letters/)).toBeVisible();
    await dlg.getByLabel('Why are they withdrawing?').fill('Injured before the event');
    await dlg.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Withdrawn.' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Entry Demo Meena Samplestone' })).toHaveCount(0);
  });

  test('add a singles entry by finding a player', async ({ page }) => {
    await open(page, `#/competitions/event/${EVENT_WS}/entries`);
    const form = page.getByRole('form', { name: 'Add an entry' });
    await form.getByLabel('Find a player').fill('Kiran Placeholder');
    await form.getByRole('button', { name: 'Choose Demo Kiran Placeholder' }).click();
    await expect(form.getByRole('list', { name: 'Chosen players' })).toContainText('Demo Kiran Placeholder');
    await form.getByRole('button', { name: 'Add the entry' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Entry added.' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Entry Demo Kiran Placeholder' })).toBeVisible();
  });

  test('axe: no critical or serious violation on the entries screen', async ({ page }) => {
    await open(page, `#/competitions/event/${EVENT_WS}/entries`);
    await expect(page.getByRole('article', { name: 'Entry Demo Meena Samplestone' })).toBeVisible();
    await axeClean(page);
  });
});

test.describe('Competitions: draw', () => {
  test('a league draw: the website view says "Protected player" and never the name; it can be made again with a recorded number', async ({ page }) => {
    const stray = await open(page, `#/competitions/event/${EVENT_WS}/draw`);
    const form = page.getByRole('form', { name: 'Make the draw' });
    await form.getByRole('button', { name: 'Make the draw' }).click();
    await expect(page.getByText(/^Draw number \d+$/)).toBeVisible();
    await expect(page.getByTestId('draw-preview-owner')).toContainText('Demo Meena Samplestone');
    await page.getByLabel('What the website will show').check();
    const pub = page.getByTestId('draw-preview-public');
    await expect(pub).toContainText('Protected player');
    await expect(pub).not.toContainText('Meena');
    await noHorizontalScroll(page);

    const again = page.getByRole('form', { name: 'Make the draw again' });
    await again.getByLabel('Draw number (optional)').fill('7');
    await again.getByRole('button', { name: 'Make the draw again' }).click();
    await expect(page.getByText('Draw number 7', { exact: true })).toBeVisible();

    // A real draw number is a full 32-bit number (often 10 digits): typing one back in must be accepted, not refused.
    await again.getByLabel('Draw number (optional)').fill('4294967295');
    await again.getByRole('button', { name: 'Make the draw again' }).click();
    await expect(page.getByText('Draw number 4294967295', { exact: true })).toBeVisible();
    await again.getByLabel('Draw number (optional)').fill('4294967296');
    await again.getByRole('button', { name: 'Make the draw again' }).click();
    await expect(page.getByText(/from 0 to 4294967295/).first()).toBeVisible();
    expect(stray).toEqual([]);
  });

  test('publishing asks first and warns it cannot be changed; afterwards the draw cannot be made again', async ({ page }) => {
    await open(page, '#/competitions');
    await makeAndPublishMsDraw(page);
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
    await expect(page.getByRole('form', { name: /Make the draw/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Update matches' })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('axe: no critical or serious violation with a draft draw showing', async ({ page }) => {
    await open(page, `#/competitions/event/${EVENT_MS}/draw`);
    await page.getByRole('form', { name: 'Make the draw' }).getByRole('button', { name: 'Make the draw' }).click();
    await expect(page.getByRole('button', { name: 'Publish the draw' })).toBeVisible();
    await axeClean(page);
  });
});

test.describe('Competitions: results', () => {
  test('a result is checked as it is typed, saved, then confirmed after a warning', async ({ page }) => {
    await open(page, '#/competitions');
    await makeAndPublishMsDraw(page);
    await page.goto(`/admin/#/competitions/event/${EVENT_MS}/matches`);
    const card = page.getByRole('article', { name: 'Match MS SF match 1' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Confirm result' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Record result' }).click();
    const form = card.getByRole('form', { name: 'Result of MS SF match 1' });
    const boxes = form.getByLabel(/: points$/);
    await expect(boxes).toHaveCount(4);
    await boxes.nth(0).fill('21');
    await boxes.nth(1).fill('20');
    await expect(form.getByText(/21-20/)).toBeVisible();
    await boxes.nth(1).fill('15');
    await boxes.nth(2).fill('21');
    await boxes.nth(3).fill('10');
    await expect(form.getByText(/Looks right/)).toBeVisible();
    await noHorizontalScroll(page);

    // a walkover hides the games and needs the side that goes through
    await form.getByLabel('Walkover').check();
    await expect(form.getByLabel(/: points$/)).toHaveCount(0);
    await expect(form.getByText(/Say which side received the walkover/)).toBeVisible();
    await form.getByLabel('Played to the end').check();
    await form.getByLabel(/: points$/).nth(0).fill('21');
    await form.getByLabel(/: points$/).nth(1).fill('15');
    await form.getByRole('button', { name: 'Add a game' }).click();
    await form.getByLabel(/: points$/).nth(2).fill('21');
    await form.getByLabel(/: points$/).nth(3).fill('10');
    await expect(form.getByText(/Looks right/)).toBeVisible();
    await form.getByRole('button', { name: 'Save the result' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Result saved.' })).toBeVisible();

    await card.getByRole('button', { name: 'Confirm result' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Confirm the result of MS SF match 1?' });
    await expect(dlg.getByText('A confirmed result cannot be changed.')).toBeVisible();
    await dlg.getByRole('button', { name: 'Confirm result' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Result confirmed.' })).toBeVisible();
    await expect(card.getByText('Result confirmed', { exact: true })).toBeVisible();
  });

  test('axe: no critical or serious violation with the result form open', async ({ page }) => {
    await open(page, '#/competitions');
    await makeAndPublishMsDraw(page);
    await page.goto(`/admin/#/competitions/event/${EVENT_MS}/matches`);
    const card = page.getByRole('article', { name: 'Match MS SF match 1' });
    await card.getByRole('button', { name: 'Record result' }).click();
    await expect(card.getByRole('form', { name: 'Result of MS SF match 1' })).toBeVisible();
    await axeClean(page);
  });
});

test.describe('Competitions: courts and schedule', () => {
  test('a plan is previewed first (nothing saved), then saved after a confirm step', async ({ page }) => {
    await open(page, '#/competitions');
    await makeAndPublishMsDraw(page);
    await page.goto(`/admin/#/competitions/tournament/${TOURNAMENT}`);
    await expect(page.getByRole('list', { name: 'Courts of this tournament' })).toContainText('Court 1');
    const form = page.getByRole('form', { name: 'Plan the order of play' });
    await form.getByRole('button', { name: 'See the plan' }).click();
    await expect(form.getByText(/Type how long one match takes/)).toBeVisible();
    await form.getByLabel('Day 1: date').fill('2026-11-14');
    await form.getByLabel('From').fill('09:00');
    await form.getByLabel('Until').fill('18:00');
    await form.getByLabel('One match takes (minutes)').fill('30');
    await form.getByLabel(/Rest between/).fill('20');
    await form.getByRole('button', { name: 'See the plan' }).click();
    const preview = page.getByRole('region', { name: 'Plan preview' });
    await expect(preview.getByText('Preview: nothing saved yet')).toBeVisible();
    await expect(preview.getByRole('listitem').filter({ hasText: 'MS SF match 1' }).first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Save this plan' }).click();
    await page.getByRole('alertdialog', { name: 'Save this plan?' }).getByRole('button', { name: 'Save this plan' }).click();
    await expect(page.getByRole('status').filter({ hasText: /given a time and court/ })).toBeVisible();
  });

  test('a court is added with a name', async ({ page }) => {
    await open(page, `#/competitions/tournament/${TOURNAMENT}`);
    const form = page.getByRole('form', { name: 'Add a court' });
    await form.getByLabel('Court name').fill('Court 3');
    await form.getByRole('button', { name: 'Add the court' }).click();
    await expect(page.getByRole('list', { name: 'Courts of this tournament' })).toContainText('Court 3');
  });
});

test.describe('Competitions: rankings', () => {
  test('without an approved points table the ranking is refused in plain words', async ({ page }) => {
    const stray = await open(page, '#/competitions/rankings');
    await expect(page.getByText('Not approved yet')).toBeVisible();
    const form = page.getByRole('form', { name: 'Work out a ranking' });
    await form.getByLabel('Name').fill('Demo ranking');
    await form.getByRole('button', { name: 'Work out the ranking' }).click();
    await expect(form.getByText(/No ranking points table is approved yet/)).toBeVisible();
    await noHorizontalScroll(page);
    expect(stray).toEqual([]);
  });

  test('approving the points table asks first and says saving is the approval', async ({ page }) => {
    await open(page, '#/competitions/rankings');
    await page.getByRole('button', { name: 'Enter the points table' }).click();
    const form = page.getByRole('form', { name: 'Ranking points table' });
    await form.getByRole('button', { name: 'Review and approve' }).click();
    await expect(form.getByText(/Give the table a name/)).toBeVisible();
    await form.getByLabel('Name of the table').fill('Demo points');
    await form.getByLabel(/Results from the last/).fill('364');
    await form.getByLabel(/Best results that count/).fill('4');
    await form.getByText('District tournaments').click();
    await form.getByLabel('Winner').first().fill('100');
    await form.getByRole('button', { name: 'Review and approve' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Approve this points table?' });
    await expect(dlg.getByText(/Saving it counts as your approval/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Approve the points table' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Points table approved.' })).toBeVisible();
  });

  test('axe: no critical or serious violation', async ({ page }) => {
    await open(page, '#/competitions/rankings');
    await expect(page.getByRole('form', { name: 'Work out a ranking' })).toBeVisible();
    await axeClean(page);
  });
});
