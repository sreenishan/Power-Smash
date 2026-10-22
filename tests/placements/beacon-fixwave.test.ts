import { describe, expect, it, vi } from 'vitest';
import { createBeaconHandler, createBeaconState } from '../../src/lib/placements/beacon';
import type { BeaconDeps } from '../../src/lib/placements/beacon';
import type { ImpressionBatch } from '../../src/lib/placements/store';
import { placement } from './helpers';

const TOKEN = 'build-token-0001';
const NOW = new Date('2026-11-10T04:00:00Z');
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function setup(over: Partial<BeaconDeps> = {}) {
  const banner = placement({ slot: 'player_page_banner' });
  const strip = placement({ slot: 'footer_partner_strip' });
  const batches: ImpressionBatch[] = [];
  const deps: BeaconDeps = {
    tokens: [TOKEN],
    now: () => NOW,
    loadSchedule: vi.fn(async () => [banner, strip]),
    store: { record: async (b) => (batches.push(b), b.items.length) },
    getSalt: async () => 'daily-salt-for-tests',
    hmacKey: ['k1', 'x'.repeat(40)].join(':'),
    siteOrigin: 'https://powersmash.example',
    log: () => undefined,
    ...over,
  };
  const handler = createBeaconHandler(deps, createBeaconState());
  const send = (id: string, slot: string, path: string, ua = UA, ip = '203.0.113.9') =>
    handler(
      new Request('https://powersmash.example/api/placement-beacon', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'user-agent': ua, 'x-vercel-forwarded-for': ip },
        body: JSON.stringify({ v: 1, tok: TOKEN, path, items: [{ id, slot, ms: 1000 }] }),
      }),
    );
  return { banner, strip, batches, send };
}

describe('S2-4: dedupe cannot be bypassed by varying the user agent', () => {
  it('25 different user agents from one connection count once per placement per day per page class', async () => {
    const t = setup();
    for (let i = 0; i < 25; i += 1) await t.send(t.banner.id, 'player_page_banner', '/players/fictional-player/', `Mozilla/5.0 (Linux; Android 14) Chrome/130.${i} Mobile Safari/537.36`);
    expect(t.batches).toHaveLength(1);
  });

  it('the session hash ignores the user agent, depends on the connection, and differs by page class', async () => {
    const a = setup();
    await a.send(a.strip.id, 'footer_partner_strip', '/players/fictional-player/', `${UA} A`);
    const b = setup();
    await b.send(b.strip.id, 'footer_partner_strip', '/players/fictional-player/', `${UA} B`);
    expect(a.batches[0]?.sessionHash).toBe(b.batches[0]?.sessionHash);
    await b.send(b.strip.id, 'footer_partner_strip', '/tournaments/');
    expect(b.batches).toHaveLength(2);
    expect(b.batches[1]?.sessionHash).not.toBe(b.batches[0]?.sessionHash);
    const c = setup();
    await c.send(c.strip.id, 'footer_partner_strip', '/players/fictional-player/', UA, '203.0.113.77');
    expect(c.batches[0]?.sessionHash).not.toBe(a.batches[0]?.sessionHash);
  });
});

describe('S2-3: protected, minimal and unknown pages are refused and never stored', () => {
  it('a path the allow-list does not vouch for counts nothing, and a failing lookup fails closed', async () => {
    const allow = new Set(['/players/fictional-player/']);
    const t = setup({ isPathPublic: async (p) => allow.has(p) });
    expect((await t.send(t.banner.id, 'player_page_banner', '/players/hidden-minor/')).status).toBe(204);
    expect((await t.send(t.banner.id, 'player_page_banner', '/players/anything/')).status).toBe(204);
    expect(t.batches).toHaveLength(0);
    expect((await t.send(t.banner.id, 'player_page_banner', '/players/fictional-player/')).status).toBe(204);
    expect(t.batches).toHaveLength(1);
    const broken = setup({
      isPathPublic: async () => {
        throw new Error('down');
      },
    });
    await broken.send(broken.banner.id, 'player_page_banner', '/players/fictional-player/');
    expect(broken.batches).toHaveLength(0);
  });
});
