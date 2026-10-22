// Shared helpers for the browser tests. Fictional data only. Cloudflare is never contacted: the Turnstile script is answered by a
// local stub, and /api/lead and /api/event are answered by route handlers (nothing reaches the preview server's endpoints).
import { expect, type Page, type Route } from '@playwright/test';

export const FORM_PAGES = ['/book/', '/partner/', '/contact/', '/tournaments/submit/', '/submit-video/', '/alerts/', '/request/'] as const;
export const OTHER_PAGES = ['/', '/services/', '/pricing/', '/privacy/'] as const;

export const TURNSTILE_URL_PATTERN = /^https:\/\/challenges\.cloudflare\.com\//;
export const ORIGIN_HOST = 'localhost:4399';

export interface Probe {
  /** Every request whose URL is on challenges.cloudflare.com (answered by the stub, never sent on). */
  turnstileRequests: string[];
  /** Bodies POSTed to /api/lead. */
  leadBodies: unknown[];
  /** Any request to a host that is not the preview server or the stubbed Cloudflare script. */
  strayRequests: string[];
}

export type LeadMode = 'ok' | 'degraded';

const STUB_TOKEN = 'XXXX.STUB.TOKEN';

/** The stand-in for Cloudflare's api.js: defines window.turnstile and calls the `onload` function named in the query. */
function turnstileStub(onload: string | null): string {
  return `
(function () {
  var n = 0;
  window.turnstile = {
    render: function (container, opts) {
      n += 1;
      setTimeout(function () { if (opts && typeof opts.callback === 'function') opts.callback(${JSON.stringify(STUB_TOKEN)}); }, 30);
      return 'stub-' + n;
    },
    reset: function () {},
    remove: function () {},
    getResponse: function () { return ${JSON.stringify(STUB_TOKEN)}; }
  };
  ${onload ? `if (typeof window[${JSON.stringify(onload)}] === 'function') window[${JSON.stringify(onload)}]();` : ''}
})();
`;
}

/** Installs the stubs and returns what was requested. Call before page.goto. */
export async function installStubs(page: Page, leadMode: LeadMode = 'ok'): Promise<Probe> {
  const probe: Probe = { turnstileRequests: [], leadBodies: [], strayRequests: [] };

  await page.route(TURNSTILE_URL_PATTERN, async (route: Route) => {
    const url = new URL(route.request().url());
    probe.turnstileRequests.push(url.toString());
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: turnstileStub(url.searchParams.get('onload')),
    });
  });

  await page.route('**/api/lead', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fulfill({ status: 405, body: '' });
    probe.leadBodies.push(req.postDataJSON());
    if (leadMode === 'degraded') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'degraded', message: 'We could not save it just now.', correlationId: 'c-test0001' }),
      });
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ref: 'PS-2026-7K3QDM', waLink: 'https://wa.me/910000000000?text=PS-2026-7K3QDM', replay: false }),
    });
  });

  await page.route('**/api/event', (route) => route.fulfill({ status: 204, body: '' }));

  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const host = new URL(url).host;
    if (host !== ORIGIN_HOST && host !== 'challenges.cloudflare.com') probe.strayRequests.push(url);
  });
  return probe;
}

export function form(page: Page) {
  return page.locator('form[novalidate]').first();
}

/**
 * Waits until the island has hydrated: the outer fieldset loses its `disabled` attribute and the first control can be used.
 * The island is `client:visible`, so on a page whose form is below the fold it only hydrates once it is scrolled into view.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await form(page).scrollIntoViewIfNeeded();
  await expect(form(page).locator('fieldset').first()).not.toHaveAttribute('disabled', /.*/, { timeout: 25_000 });
  await expect(form(page).locator('input:not([name=website]), textarea').first()).toBeEnabled();
}

function isoDateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Fills every visible control of the current step with fictional values. */
export async function fillCurrentStep(page: Page): Promise<void> {
  const f = form(page);

  const inputs = f.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([name=website]), textarea');
  for (let i = 0; i < (await inputs.count()); i++) {
    const el = inputs.nth(i);
    if (!(await el.isVisible())) continue;
    const type = (await el.getAttribute('type')) ?? (await el.evaluate((n) => n.tagName.toLowerCase()));
    const name = (await el.getAttribute('name')) ?? '';
    let value: string;
    if (type === 'tel') value = '9000000000';
    else if (type === 'email') value = 'test.person@example.com';
    else if (type === 'url') value = 'https://example.com/watch/test-video';
    else if (type === 'date') value = isoDateInDays(30);
    else if (type === 'month') value = isoDateInDays(30).slice(0, 7);
    else if (type === 'number') value = '8';
    else if (/name/i.test(name)) value = 'Test Person';
    else if (type === 'textarea') value = 'This is a test message from an automated browser check.';
    else value = 'Sample test value';
    await el.fill(value);
  }

  const selects = f.locator('select');
  for (let i = 0; i < (await selects.count()); i++) {
    const el = selects.nth(i);
    if (!(await el.isVisible())) continue;
    const values = await el.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (values.length > 0) await el.selectOption(values[0]!);
  }

  const groups = f.locator('[role=radiogroup]');
  for (let i = 0; i < (await groups.count()); i++) {
    const group = groups.nth(i);
    if (!(await group.isVisible())) continue;
    if ((await group.locator('input[type=radio]:checked').count()) === 0) await group.locator('label').first().click();
  }

  // Single tick boxes (confirmations); the add-on groups (names ending in []) stay untouched.
  const singles = f.locator('input[type=checkbox][name]:not([name$="[]"])');
  for (let i = 0; i < (await singles.count()); i++) {
    const el = singles.nth(i);
    if ((await el.isVisible()) && !(await el.isChecked())) await el.check();
  }
}

/** The spam-check box only exists on the last step. */
export function spamBox(page: Page) {
  return page.locator('[aria-label="Spam check"]').first();
}

/** Fills each step and presses Next until the last step; returns with the Send button ready. */
export async function fillWholeForm(page: Page): Promise<void> {
  for (let guard = 0; guard < 6; guard++) {
    await fillCurrentStep(page);
    if (await spamBox(page).isVisible()) break;
    const heading = form(page).locator('h2').first();
    const before = (await heading.textContent()) ?? '';
    await form(page).getByRole('button', { name: /^Next/ }).click();
    await expect(heading).not.toHaveText(before, { timeout: 10_000 });
  }
  await expect(spamBox(page)).toBeVisible();
}

export function sendButton(page: Page) {
  return form(page).locator('button[type=submit]');
}
