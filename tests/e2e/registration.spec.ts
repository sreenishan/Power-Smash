// Browser tests for the registration pages (D-111): /register/<tournament>/<event>/, built from the FICTIONAL seeds
// (src/lib/competition/public/seed.ts and src/lib/registration/public/provider.ts) in the developer build. Run with `npm run e2e`
// after `npm run build` (the strict release build carries no registration page while the switches are off). Turnstile and
// /api/register are stubbed; every value typed here is fictional.
import { expect, test, type Page } from '@playwright/test';
import { installStubs, waitForHydration } from './helpers';

const SINGLES = '/register/sample-city-open-2026/ms/';
const DOUBLES = '/register/sample-city-open-2026/xd-open/';
const JUNIOR = '/register/sample-city-open-2026/bs-u15/';

async function stubRegister(page: Page, answer: { status: number; body: unknown }) {
  const bodies: unknown[] = [];
  await page.route('**/api/register', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  return bodies;
}

const regForm = (page: Page) => page.locator('form[aria-label^="Register for"]');

test.describe('registration pages', () => {
  test('singles page: one H1, noindex, the fee and the owner payment texts, no card or UPI credential fields, no age field', async ({ page }) => {
    await installStubs(page);
    await page.goto(SINGLES);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('[data-fee]')).toHaveText('₹500');
    await expect(page.locator('[data-upi-id]')).toHaveText('sample-payee@okdemo');
    await waitForHydration(page);
    const f = regForm(page);
    await expect(f).toBeVisible();
    await expect(f.locator('input[name=player2Name]')).toHaveCount(0);
    await expect(f.locator('input[name=paymentReference]')).toHaveCount(1);
    for (const bad of ['cc-number', 'cc-csc', 'cc-exp']) await expect(f.locator(`[autocomplete=${bad}]`)).toHaveCount(0);
    await expect(f.locator('input[type=password]')).toHaveCount(0);
    await expect(f.getByLabel(/age|date of birth/i)).toHaveCount(0);
  });

  test('doubles page asks for a partner and shows no payment block (no fee set)', async ({ page }) => {
    await installStubs(page);
    await page.goto(DOUBLES);
    await waitForHydration(page);
    await expect(regForm(page).locator('input[name=player2Name]')).toHaveCount(1);
    await expect(page.locator('[data-payment-details]')).toHaveCount(0);
    await expect(regForm(page).locator('input[name=paymentReference]')).toHaveCount(0);
  });

  test('a junior event has no registration page', async ({ page }) => {
    const res = await page.goto(JUNIOR);
    expect(res?.status()).toBe(404);
  });

  test('an empty send shows inline errors linked to their boxes and moves focus to the first', async ({ page }) => {
    await installStubs(page);
    const bodies = await stubRegister(page, { status: 201, body: { ok: true, ref: 'PSR-2026-ABCDEF', feePaise: 50000 } });
    await page.goto(SINGLES);
    await waitForHydration(page);
    await regForm(page).locator('input[name=player1Name]').click();
    await regForm(page).getByRole('button', { name: 'Send registration' }).click();
    const first = regForm(page).locator('[aria-invalid="true"]').first();
    await expect(first).toBeVisible();
    await expect(first).toBeFocused();
    expect(bodies).toHaveLength(0);
  });

  test('a card number typed as the payment reference is refused in the browser and never sent', async ({ page }) => {
    await installStubs(page);
    const bodies = await stubRegister(page, { status: 201, body: { ok: true, ref: 'PSR-2026-ABCDEF', feePaise: 50000 } });
    await page.goto(SINGLES);
    await waitForHydration(page);
    const f = regForm(page);
    await f.locator('input[name=player1Name]').fill('Sample Reg Alpha');
    await f.locator('input[name=phone]').fill('90000 00001');
    await f.locator('input[name=paymentReference]').fill('4111 1111 1111 1111');
    await f.locator('input[data-field=consent]').check();
    await f.getByRole('button', { name: 'Send registration' }).click();
    await expect(f.getByText(/looks like a card number/)).toBeVisible();
    expect(bodies).toHaveLength(0);
  });

  test('a good registration is sent with the notice id and version, and the reference is shown', async ({ page }) => {
    await installStubs(page);
    const bodies = await stubRegister(page, { status: 201, body: { ok: true, ref: 'PSR-2026-ABCDEF', feePaise: 50000, waLink: 'https://wa.me/910000000000?text=PSR-2026-ABCDEF' } });
    await page.goto(DOUBLES);
    await waitForHydration(page);
    const f = regForm(page);
    await f.locator('input[name=player1Name]').fill('Sample Reg Alpha');
    await f.locator('input[name=player2Name]').fill('Sample Reg Bravo');
    await f.locator('input[name=phone]').fill('90000 00001');
    await f.locator('input[data-field=consent]').check();
    // the stubbed spam check solves itself once the widget renders
    await page.waitForTimeout(1200);
    await f.getByRole('button', { name: 'Send registration' }).click();
    await expect(page.getByRole('heading', { name: 'Registration received' })).toBeFocused();
    await expect(page.getByText('PSR-2026-ABCDEF')).toBeVisible();
    expect(bodies).toHaveLength(1);
    const sent = bodies[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ player1Name: 'Sample Reg Alpha', player2Name: 'Sample Reg Bravo', consent: { id: 'registration-notice' } });
    expect(Object.keys(sent)).not.toContain('ageGroup');
  });

  test('"event full" from the server is shown in plain English and the typed values stay', async ({ page }) => {
    await installStubs(page);
    await stubRegister(page, { status: 409, body: { ok: false, code: 'full', message: 'x', correlationId: 'c-test0002' } });
    await page.goto(SINGLES);
    await waitForHydration(page);
    const f = regForm(page);
    await f.locator('input[name=player1Name]').fill('Sample Reg Alpha');
    await f.locator('input[name=phone]').fill('90000 00001');
    await f.locator('input[data-field=consent]').check();
    await page.waitForTimeout(1200);
    await f.getByRole('button', { name: 'Send registration' }).click();
    await expect(page.getByRole('alert')).toContainText('no places left');
    await expect(f.locator('input[name=player1Name]')).toHaveValue('Sample Reg Alpha');
  });
});
