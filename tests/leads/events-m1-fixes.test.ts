// Regression tests for the M1 review-fix wave in POST /api/event: S-3 (the byte cap is enforced while the stream is read),
// S-17 (the secret key only goes to an acceptable Supabase URL).
import { describe, expect, it } from 'vitest';
import { createEventHandler, createEventState, EVENT_BODY_MAX_BYTES } from '../../src/lib/leads/event-handler';
import { createWorld, FAKE, fakeConfig, NOW, seqRandom } from './helpers';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';

function setup(envOverrides: Record<string, string | undefined> = {}) {
  const world = createWorld();
  const handler = createEventHandler({ config: fakeConfig(envOverrides), fetch: world.fetch, now: () => NOW, randomBytes: seqRandom(9), log: () => undefined }, createEventState());
  return { world, handler };
}

function chunkedRequest(chunkBytes: number, chunks: number, contentType = 'text/plain') {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      if (state.pulled > chunks) return controller.close();
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
  });
  const request = new Request(`${FAKE.origin}/api/event`, {
    method: 'POST',
    headers: { 'content-type': contentType, origin: FAKE.origin, 'user-agent': UA, 'x-vercel-forwarded-for': FAKE.ip },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  return { state, request };
}

describe('S-3: POST /api/event reads the stream with a byte limit', () => {
  it('a chunked 50 MiB upload with no Content-Length is refused after the first chunk past the 2 KB cap', async () => {
    const { handler, world } = setup();
    const { state, request } = chunkedRequest(1024 * 1024, 50);
    const res = await handler(request);
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThanOrEqual(3); // before the fix all 50 MiB were pulled
    expect(world.calls).toHaveLength(0);
  });

  it('many small chunks that add up past the cap are cut off too', async () => {
    const { handler } = setup();
    const { state, request } = chunkedRequest(512, 1000);
    expect((await handler(request)).status).toBe(413);
    expect(state.pulled).toBeLessThanOrEqual(Math.ceil(EVENT_BODY_MAX_BYTES / 512) + 3);
  });

  it('a lying Content-Length (small header, big body) does not help', async () => {
    const { handler } = setup();
    const big = JSON.stringify({ name: 'form_start', props: { form: 'x'.repeat(5000) } });
    const res = await handler(
      new Request(`${FAKE.origin}/api/event`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FAKE.origin, 'content-length': '20', 'x-vercel-forwarded-for': FAKE.ip }, body: big }),
    );
    expect(res.status).toBe(413);
  });

  it('a body of exactly the cap or less is still accepted; invalid UTF-8 is a 400, not a crash', async () => {
    const { handler, world } = setup();
    const ok = JSON.stringify({ name: 'form_start', path: '/book/', props: { form: 'book' } });
    expect(ok.length).toBeLessThan(EVENT_BODY_MAX_BYTES);
    const res = await handler(new Request(`${FAKE.origin}/api/event`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FAKE.origin, 'user-agent': UA, 'x-vercel-forwarded-for': FAKE.ip }, body: ok }));
    expect(res.status).toBe(204);
    expect(world.events).toHaveLength(1);
    const bad = new Request(`${FAKE.origin}/api/event`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FAKE.origin, 'x-vercel-forwarded-for': FAKE.ip }, body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) });
    expect((await handler(bad)).status).toBe(400);
  });
});

describe('S-17 for the analytics endpoint: a refused Supabase URL means no database call at all', () => {
  it('http, a foreign host or a look-alike host: 503 unconfigured, nothing is sent anywhere', async () => {
    for (const url of ['http://fakeref.supabase.co', 'https://evil.example', 'https://fakeref.supabase.co.evil.example', 'https://user:pw@fakeref.supabase.co']) {
      const { handler, world } = setup({ SUPABASE_URL: url });
      const ok = JSON.stringify({ name: 'form_start' });
      const res = await handler(new Request(`${FAKE.origin}/api/event`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FAKE.origin, 'x-vercel-forwarded-for': FAKE.ip }, body: ok }));
      expect(res.status, url).toBe(503);
      expect(world.calls, url).toHaveLength(0);
    }
  });
});
