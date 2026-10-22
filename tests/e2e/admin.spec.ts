// Smoke tests for the admin screens added for Mark paid, video submissions and Title check. The admin runs in PREVIEW mode (no Supabase
// build variables): an in-memory store with FICTIONAL data, no network. Chromium at 360 and 390 px. No trace or screenshot is kept.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
