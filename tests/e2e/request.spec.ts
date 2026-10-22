// Smoke test for /request/ (profile and content-removal requests). The generic form specs (forms.spec.ts, pages.spec.ts) already cover
// hydration, empty submit, spam-check timing, a full send, the 503 fallback, axe and horizontal scroll for this page; this file checks what
// is specific to it: the type selector decides the lead kind, the request notice is what is sent, the parent or guardian note is on screen,
// and no personal data reaches the WhatsApp fallback. Cloudflare and the lead endpoint are stubbed (helpers.ts); every value is fictional.
import { expect, test } from '@playwright/test';
import { fillWholeForm, form, installStubs, sendButton, waitForHydration } from './helpers';

const NAME = 'Test Person';
const WHAT = 'https://example.org/players/sample-player/';

async function fillRequest(page: import('@playwright/test').Page, typeLabel: RegExp, relationshipLabel: RegExp): Promise<void> {
  await form(page).getByLabel(typeLabel).check();
  await form(page).getByLabel('Link or description of the profile, video or page').fill(WHAT);
  await form(page).getByLabel(relationshipLabel).check();
  await form(page).getByLabel('Your name').fill(NAME);
  await form(page).getByLabel(/Phone or WhatsApp number/).fill('9000000000');
  await form(page).getByLabel(/Anything else we should know/).fill('Details for the sample request.');
}

test.describe('/request/', () => {
  test('says plainly that a parent or guardian check by one-time code is a later step, and promises no time', async ({ page }) => {
    await installStubs(page);
    await page.goto('/request/');
    await waitForHydration(page);
    await expect(form(page).getByText(/one-time code sent to your own phone/)).toBeVisible();
    await expect(form(page).getByText(/not switched on yet/)).toBeVisible();
    await expect(page.getByText('We do not promise a time.')).toBeVisible();
    await expect(form(page).getByText(/within \d|24 hours/)).toHaveCount(0);
  });

  test('"remove a video" is sent as content_removal with the request notice', async ({ page }) => {
    const probe = await installStubs(page, 'ok');
    await page.goto('/request/');
    await waitForHydration(page);
    await fillRequest(page, /Remove a video or other content/, /rights holder/);
    await expect(page.getByText('Spam check passed.')).toBeVisible({ timeout: 15_000 });
    await sendButton(page).click();
    await expect(page.getByRole('heading', { name: 'Thank you. We have received it.' })).toBeVisible({ timeout: 15_000 });

    expect(probe.leadBodies).toHaveLength(1);
    const body = probe.leadBodies[0] as Record<string, any>;
    expect(body.kind).toBe('content_removal');
    expect(body.requestType).toBe('remove_content');
    expect(body.relationship).toBe('rights_holder');
    expect(body.what).toBe(WHAT);
    expect(body.consent.id).toBe('request-notice');
    expect(typeof body.consent.version).toBe('string');
    expect(body).not.toHaveProperty('email');
    expect(probe.strayRequests).toEqual([]);
    // the thank-you screen repeats the later-verification statement
    await expect(page.locator('section[aria-labelledby="ps-confirmation-title"]').getByText(/one-time code sent to your own phone/)).toBeVisible();
  });

  test('a hide request by a parent is sent as profile_request', async ({ page }) => {
    const probe = await installStubs(page, 'ok');
    await page.goto('/request/');
    await waitForHydration(page);
    await fillRequest(page, /Hide a profile/, /parent or guardian of the player/);
    await expect(page.getByText('Spam check passed.')).toBeVisible({ timeout: 15_000 });
    await sendButton(page).click();
    await expect(page.getByRole('heading', { name: 'Thank you. We have received it.' })).toBeVisible({ timeout: 15_000 });
    const body = probe.leadBodies[0] as Record<string, any>;
    expect(body.kind).toBe('profile_request');
    expect(body.requestType).toBe('hide_profile');
    expect(body.relationship).toBe('parent_guardian');
  });

  test('the failure screen offers WhatsApp but the prefilled text holds no name, number, link or details', async ({ page }) => {
    await installStubs(page, 'degraded');
    await page.goto('/request/');
    await waitForHydration(page);
    await fillRequest(page, /Hide a profile/, /parent or guardian of the player/);
    await expect(page.getByText('Spam check passed.')).toBeVisible({ timeout: 15_000 });
    await sendButton(page).click();
    await expect(page.getByRole('heading', { name: /It did not go through/ })).toBeVisible({ timeout: 20_000 });
    const href = await page.locator('#ps-failure-title ~ div a[href^="https://wa.me/"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const text = decodeURIComponent(href!.split('?text=')[1] ?? '');
    expect(text).toContain('Hide a profile');
    for (const secret of [NAME, '9000000000', 'sample-player', 'example.org', 'Details for the sample request']) expect(text).not.toContain(secret);
  });

  test('the generic helper can fill and send it too (every control is reachable)', async ({ page }) => {
    const probe = await installStubs(page, 'ok');
    await page.goto('/request/');
    await waitForHydration(page);
    await fillWholeForm(page);
    await expect(page.getByText('Spam check passed.')).toBeVisible({ timeout: 15_000 });
    await sendButton(page).click();
    await expect(page.getByRole('heading', { name: 'Thank you. We have received it.' })).toBeVisible({ timeout: 15_000 });
    expect(probe.leadBodies).toHaveLength(1);
  });
});
