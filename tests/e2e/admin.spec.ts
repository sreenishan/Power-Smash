// Smoke tests for the admin screens added for Mark paid, video submissions and Title check. The admin runs in PREVIEW mode (no Supabase
// build variables): an in-memory store with FICTIONAL data, no network. Chromium at 360 and 390 px (and one check at 1280 by 800). No trace
// or screenshot is kept.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

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

test.describe('Mark paid on an enquiry', () => {
  test('records a payment after a confirm step and the enquiry becomes Won', async ({ page }) => {
    const stray = await open(page, '#/inbox');
    const card = page.getByRole('article', { name: 'Enquiry PS-2026-DEMK01' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Record payment' }).click();
    const form = page.getByRole('form', { name: /Record a payment for PS-2026-DEMK01/ });
    await expect(form).toBeVisible();
    await noHorizontalScroll(page);

    // nothing is filled in for the owner
    await expect(form.getByLabel('Amount received, in rupees')).toHaveValue('');
    await expect(form.getByLabel('Gateway fee (rupees)')).toHaveValue('');
    await expect(form.getByLabel('How was it paid?')).toHaveValue('');

    // plain-English errors first
    await form.getByRole('button', { name: 'Review the payment' }).click();
    await expect(form.getByText('Type the amount you received.')).toBeVisible();
    await expect(form.getByText('Choose how it was paid.')).toBeVisible();

    await form.getByLabel('How was it paid?').selectOption('upi_manual');
    await form.getByLabel('Payment id or bank reference (UTR)').fill('UTR1234567890');
    await form.getByLabel('Amount received, in rupees').fill('5,000');
    await form.getByRole('button', { name: 'Review the payment' }).click();

    const confirm = page.getByRole('alertdialog', { name: 'Record this payment?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('₹5,000').first()).toBeVisible();
    await confirm.getByRole('button', { name: 'Record payment' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Payment recorded. The enquiry is won.' })).toBeVisible();
    await expect(card.getByText('Won', { exact: true })).toBeVisible();
    expect(stray).toEqual([]);
  });

  test('a fee without the GST on it and a document that needs GST are refused in words', async ({ page }) => {
    await open(page, '#/inbox');
    const card = page.getByRole('article', { name: 'Enquiry PS-2026-DEMK01' });
    await card.getByRole('button', { name: 'Record payment' }).click();
    const form = page.getByRole('form', { name: /Record a payment/ });
    await form.getByLabel('How was it paid?').selectOption('razorpay');
    await form.getByLabel('Payment id or bank reference (UTR)').fill('pay_FAKE123456');
    await form.getByLabel('Amount received, in rupees').fill('1000');
    await form.getByLabel('Gateway fee (rupees)').fill('23.60');
    await form.getByRole('button', { name: 'Review the payment' }).click();
    await expect(form.getByText(/Enter the GST on the fee/)).toBeVisible();
    // with GST not set the only document offered is the payment receipt
    await expect(form.getByLabel('Document to issue').locator('option')).toHaveCount(1);
  });

  test('axe: no critical or serious violation with the form open', async ({ page }) => {
    await open(page, '#/inbox');
    await page.getByRole('article', { name: 'Enquiry PS-2026-DEMK01' }).getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('form', { name: /Record a payment/ })).toBeVisible();
    await axeClean(page);
  });
});

test.describe('Video submissions', () => {
  test('shows the link as text and the rights confirmations, then approve and mark uploaded with an 11-character id', async ({ page }) => {
    const stray = await open(page, '#/submissions');
    const card = page.getByRole('article', { name: 'Submission PS-2026-DEMK03' });
    await expect(card).toBeVisible();
    await noHorizontalScroll(page);

    // the link is text; the page loads nothing from it (no frame, no image, no request to its host)
    await expect(card.getByTestId('video-link')).toHaveText('https://video.example.test/watch/demo-clip');
    await expect(page.locator('iframe, video, embed, object')).toHaveCount(0);
    const link = card.getByRole('link', { name: /Open the link in a new tab/ });
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /nofollow/);

    // four rights confirmations with their versions
    const rights = card.getByRole('list', { name: 'Rights confirmations' });
    await expect(rights.getByRole('listitem')).toHaveCount(4);
    await expect(rights.getByText(/Wording version/).first()).toBeVisible();

    // cannot mark uploaded before approval: the button is not offered
    await expect(card.getByRole('button', { name: /Mark uploaded/ })).toHaveCount(0);
    await card.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('alertdialog', { name: 'Approve this video?' }).getByRole('button', { name: 'Approve' }).click();
    await expect(card.getByText('Approved', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: /Mark uploaded with YouTube video id/ }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Mark as uploaded?' });
    await dlg.getByLabel('YouTube video id').fill('nope');
    await dlg.getByRole('button', { name: 'Mark uploaded' }).click();
    await expect(dlg.getByText(/exactly 11/)).toBeVisible();
    await dlg.getByLabel('YouTube video id').fill('dQw4w9WgXcQ');
    await dlg.getByRole('button', { name: 'Mark uploaded' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Marked as uploaded.' })).toBeVisible();
    await page.getByRole('button', { name: 'Uploaded' }).click();
    await expect(page.getByRole('article', { name: 'Submission PS-2026-DEMK03' }).getByText('dQw4w9WgXcQ')).toBeVisible();
    expect(stray).toEqual([]);
  });

  test('reject needs a reason', async ({ page }) => {
    await open(page, '#/submissions');
    const card = page.getByRole('article', { name: 'Submission PS-2026-DEMK03' });
    await card.getByRole('button', { name: 'Reject' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Reject this video?' });
    await dlg.getByRole('button', { name: 'Reject' }).click();
    await expect(dlg.getByText(/Say why/)).toBeVisible();
    await dlg.getByLabel(/Why\?/).fill('Rights are unclear');
    await dlg.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rejected.' })).toBeVisible();
  });

  test('axe: no critical or serious violation', async ({ page }) => {
    await open(page, '#/submissions');
    await expect(page.getByRole('article', { name: 'Submission PS-2026-DEMK03' })).toBeVisible();
    await axeClean(page);
  });
});

test.describe('Title check', () => {
  test('a bracketed age warns; a clean title auto-accepts; a cleaner title can be copied', async ({ page }) => {
    const stray = await open(page, '#/videos');
    await page.getByRole('tab', { name: 'Title check' }).click();
    const box = page.getByLabel('Planned YouTube title');
    await expect(box).toBeVisible();
    await noHorizontalScroll(page);

    await box.fill('Arun Kumar vs Bala Murugan (U15) || MS Final || State Cup 2026');
    await expect(page.getByRole('alert').filter({ hasText: /under 18/ })).toBeVisible();
    await expect(page.getByText('Will need review', { exact: true })).toBeVisible();

    await box.fill('Demo Karthik vs Sample Arul || MS Final || Demo District Open 2026');
    await expect(page.getByText('Will auto-accept')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /under 18/ })).toHaveCount(0);
    await expect(page.getByText('This title follows the convention.')).toBeVisible();

    await box.fill('Demo Karthik vs Sample Arul MS Final Demo District Open 2026');
    await expect(page.getByText(/double pipe/)).toBeVisible();
    expect(stray).toEqual([]);
  });

  test('axe: no critical or serious violation with a result showing', async ({ page }) => {
    await open(page, '#/videos');
    await page.getByRole('tab', { name: 'Title check' }).click();
    await page.getByLabel('Planned YouTube title').fill('Arun Kumar vs Bala Murugan (U15) || MS Final || State Cup 2026');
    await expect(page.getByRole('alert').filter({ hasText: /under 18/ })).toBeVisible();
    await axeClean(page);
  });
});

// An open message box (role status or alert) must never hide the end of a screen. Scrolled to the very end, `last` (the screen's last card)
// sits fully above the box and the tab bar, and a tap on the middle of `tap` reaches it. The box itself stays where it always was: bottom
// edge 80 px above the screen bottom, min(page width, 576 px) wide, at the top of the page as at the end (if a wrapper with overflow ever
// stops it from sticking, the top check fails). Retried briefly: a list reloads after every action.
async function expectEndClear(page: Page, notice: Locator, last: Locator, tap: Locator): Promise<void> {
  const tabBar = page.getByRole('navigation', { name: 'Admin sections' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(async () => {
    // on a screen that fits the viewport the old box and the new one sit in the same place, so the screen must really scroll
    const spare = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(spare, 'the screen is longer than the viewport, so its end is really tested').toBeGreaterThan(100);
    for (const where of ['top', 'end'] as const) {
      const { width, height } = await page.evaluate((w) => {
        window.scrollTo(0, w === 'top' ? 0 : document.documentElement.scrollHeight);
        return { width: document.documentElement.clientWidth, height: window.innerHeight };
      }, where);
      const n = await notice.boundingBox();
      if (!n) throw new Error('the message box has no box');
      expect(Math.abs(n.y + n.height - (height - 80)), `${where}: message box bottom 80 px above the screen bottom`).toBeLessThanOrEqual(1);
      expect(Math.abs(n.width - Math.min(width, 576)), `${where}: message box as wide as before`).toBeLessThanOrEqual(1);
    }
    const [row, n, bar] = await Promise.all([last.boundingBox(), notice.boundingBox(), tabBar.boundingBox()]);
    if (!row || !n || !bar) throw new Error('the last card, the message box or the tab bar has no box');
    expect(row.y + row.height, 'last card bottom vs message box top').toBeLessThanOrEqual(n.y);
    expect(row.y + row.height, 'last card bottom vs tab bar top').toBeLessThanOrEqual(bar.y);
    const hit = await tap.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return at !== null && el.contains(at);
    });
    expect(hit, 'a tap on the middle of the last row reaches it').toBe(true);
  }).toPass({ timeout: 5_000 });
}

test.describe('An open message never hides the end of a screen', () => {
  test.describe('at desktop width', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('after Approve, Mark uploaded and then the open dialog scroll clear of "Approved."', async ({ page }) => {
      test.skip(test.info().project.name !== 'mobile-360', 'the viewport is set here, so one project is enough');
      await open(page, '#/submissions');
      const card = page.getByRole('article', { name: 'Submission PS-2026-DEMK03' });
      await card.getByRole('button', { name: 'Approve' }).click();
      await page.getByRole('alertdialog', { name: 'Approve this video?' }).getByRole('button', { name: 'Approve' }).click();
      const notice = page.getByRole('status').filter({ hasText: 'Approved.' });
      await expect(notice).toBeVisible();

      // at this width Mark uploaded and Reject share the card's last row (before the fix: card bottom 688 under the box top 648)
      const upload = card.getByRole('button', { name: /Mark uploaded with YouTube video id/ });
      await expectEndClear(page, notice, card, upload);
      await upload.click({ timeout: 5_000 });

      // the inline dialog opens at the foot of the card, so its buttons become the last row
      const dlg = page.getByRole('alertdialog', { name: 'Mark as uploaded?' });
      await expect(dlg).toBeVisible();
      await expectEndClear(page, notice, card, dlg.getByRole('button', { name: 'Cancel' }));
    });
  });

  test('on a phone a long message with Undo, several lines high, still lets the last player card scroll clear, and a long name wraps inside it', async ({ page }) => {
    await open(page, '#/players');
    await page.getByLabel('Select Demo Arvind Testwell', { exact: true }).check();
    await page.getByLabel('Select Demo Arvind Testwel', { exact: true }).check();
    await page.getByRole('button', { name: 'Confirm as adult' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Confirm 2 players as adults?' });
    await dlg.getByLabel(/How do you know/).fill('Demo evidence for a test');
    await dlg.getByRole('button', { name: 'Confirm as adult' }).click();

    // the first player is already adult: "1 confirmed as adult. 1 skipped (...)" with Undo and Close, 4 or 5 lines at 360 and 390 px
    const notice = page.getByRole('status').filter({ hasText: '1 skipped' });
    await expect(notice.getByRole('button', { name: 'Undo' })).toBeVisible();
    const lastCard = page.locator('#admin-main li').last();
    await expectEndClear(page, notice, lastCard, lastCard.getByRole('button', { name: 'Split into two people' }));
    expect((await notice.boundingBox())?.height ?? 0, 'the message wraps to several lines').toBeGreaterThan(100);

    // A merge message names the players, and a long one-word name has no space to break at: it must wrap inside the box, not push
    // Close off the screen or make the whole page scroll sideways. Only the text is swapped here; it stands for such a merge message.
    const box = page.locator('#admin-main ~ [role="status"]');
    await box.locator('span').first().evaluate((el) => {
      el.textContent = 'Merged "Testplayerverylongnamexx" into "Testplayerverylongnamezz".';
    });
    // compared with the configured screen width: a phone widens innerWidth to fit content that is too wide, so noHorizontalScroll cannot see it
    const screenWidth = page.viewportSize()?.width ?? 0;
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page is no wider than the screen').toBeLessThanOrEqual(screenWidth);
    const close = await box.getByRole('button', { name: 'Close' }).boundingBox();
    expect((close?.x ?? 0) + (close?.width ?? 0), 'Close stays on the screen').toBeLessThanOrEqual(screenWidth);
  });
});

test.describe('Player profile (adults only, D-100)', () => {
  test('an adult gets a Profile form that saves after a confirm step; a protected player gets none', async ({ page }) => {
    const stray = await open(page, '#/players');
    const adult = page.locator('#admin-main li').filter({ hasText: 'Demo Arvind Testwell' }).first();
    const unknown = page.locator('#admin-main li').filter({ hasText: 'Demo Meena Samplestone' }).first();
    await expect(unknown.getByRole('button', { name: 'Profile' })).toHaveCount(0);
    await expect(unknown.getByText('Profile details can only be added after the player is confirmed as an adult.')).toBeVisible();

    await adult.getByRole('button', { name: 'Profile' }).click();
    await adult.getByLabel('District').fill('Demo District');
    await adult.getByLabel('Academy or club').fill('Demo Shuttle Club');
    await adult.getByLabel(/About the player/).fill('A made-up bio for a test.');
    await noHorizontalScroll(page);
    await axeClean(page);
    await adult.getByRole('button', { name: 'Save profile' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Save the profile of Demo Arvind Testwell?' });
    await dlg.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();

    // opening the form again shows what was saved
    await adult.getByRole('button', { name: 'Profile' }).click();
    await expect(adult.getByLabel('Academy or club')).toHaveValue('Demo Shuttle Club');
    expect(stray).toEqual([]);
  });
});
