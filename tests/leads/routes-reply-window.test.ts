// R-ACK-PROMISE: when the owner HAS supplied site.replyTimePromise, the route passes it to the acknowledgement email. The site
// module is replaced here (a separate file, so the other route tests keep the real, still-empty owner value).
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() })); // after-response.ts calls waitUntil from @vercel/functions
import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { env as mockEnv } from '../mocks/runtime-env';

vi.mock('../../src/content/site', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/content/site')>();
  return { ...real, site: { ...real.site, replyTimePromise: '2 working days' } };
});

import { POST as leadPost } from '../../src/pages/api/lead';
import { coverageBody, createWorld, fakeEnv, FAKE, leadRequest } from './helpers';

afterEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  vi.unstubAllGlobals();
});

describe('the lead route passes the owner-supplied reply time to the acknowledgement email', () => {
  it('says "We will reply within 2 working days." and nothing about 24 hours', async () => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    Object.assign(mockEnv, fakeEnv({ EMAIL_ENABLED: 'true', RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail }));
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const waitUntil = vi.mocked(vercelWaitUntil);
    waitUntil.mockClear();
    const res = await leadPost({ request: leadRequest(coverageBody({ email: 'ravi@example.test' })) } as never);
    expect(res.status).toBe(201);
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
    const ack = world.resendMails().find((m) => m.to === 'ravi@example.test');
    expect(ack?.text).toContain('We will reply within 2 working days.');
    expect(ack?.text).not.toContain('24 hours');
    expect(ack?.text).not.toContain('as soon as we can');
  });
});
