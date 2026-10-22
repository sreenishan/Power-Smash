import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { chatsFromUpdates, describeChat, main as telegramMain, safeLabel, scrub } from '../../scripts/telegram-chat-id.mjs';
import { AGE_VERSION, AGE_WINDOWS_ZIP, main as ageMain, missingProgramHelp } from '../../scripts/make-age-keys.mjs';
import { cleanupTemp, fakeAgePrivateKey, fakeAgePublicKey, fakeTelegramToken, ROOT, tempDir } from './helpers';

afterEach(() => {
  cleanupTemp();
  vi.restoreAllMocks();
});

const TOKEN = fakeTelegramToken();
const noGit = { top: () => null, tracked: () => false, ignored: () => true };

function telegramHarness(reply: unknown, over: Record<string, unknown> = {}) {
  const out: string[] = [];
  const errs: string[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const deps = {
    log: (s: string) => out.push(s),
    err: (s: string) => errs.push(s),
    env: { TELEGRAM_BOT_TOKEN: TOKEN },
    git: noGit,
    exists: () => false,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(reply), { status: (reply as { ok?: boolean }).ok === false ? 401 : 200 });
    },
    ...over,
  };
  return { deps, out, errs, calls, all: () => [...out, ...errs].join('\n') };
}

const update = (id: number, type = 'private', first = 'Private Name', username = 'private_user') => ({ update_id: id, message: { message_id: 1, from: { id, first_name: first, username }, chat: { id, type, first_name: first, username }, text: 'secret message text' } });

describe('telegram-chat-id', () => {
  it('prints the chat number, type, first name and username of each chat (S-9), never the token or the message text', async () => {
    const h = telegramHarness({ ok: true, result: [update(123456789), update(123456789), update(-1001234567890, 'supergroup')] });
    const code = await telegramMain([], h.deps);
    expect(code).toBe(0);
    const text = h.all();
    expect(text).toContain('123456789   private chat   first name: Private Name   username: @private_user');
    expect(text).toContain('-1001234567890   supergroup (not a private chat: do not use)');
    expect(text.match(/123456789 /g)).toHaveLength(1); // listed once although two updates came
    for (const secret of [TOKEN, 'secret message text']) expect(text).not.toContain(secret);
    expect(text).toContain('Check that the first name and username above are yours');
  });

  it('S-9: two different private chats give a loud warning that tells the owner to pick their own and never to guess', async () => {
    const h = telegramHarness({ ok: true, result: [update(111, 'private', 'Asha', 'asha_ps'), update(222, 'private', 'Stranger', 'someone_else')] });
    expect(await telegramMain([], h.deps)).toBe(0);
    const text = h.all();
    expect(text).toContain('111   private chat   first name: Asha   username: @asha_ps');
    expect(text).toContain('222   private chat   first name: Stranger   username: @someone_else');
    expect(text).toContain('WARNING: 2 different private chats');
    expect(text).toContain('whose first name and username are YOURS');
    expect(text).not.toContain('use this one');
    expect(text).not.toContain('secret message text');
    expect(text).not.toContain(TOKEN);
  });

  it('S-9: names are made printable (control, bidi and zero-width characters, ANSI escapes, very long names) and bad usernames are dropped', () => {
    expect(safeLabel(`  A${String.fromCharCode(0)}sha${String.fromCharCode(0x200f)}  Rao  `)).toBe('A sha Rao');
    expect(safeLabel(String.fromCharCode(27) + '[31mRED' + String.fromCharCode(27) + '[0m')).toBe('[31mRED [0m');
    expect(safeLabel('x'.repeat(100))).toBe('x'.repeat(39) + '...');
    expect(safeLabel('')).toBeNull();
    expect(safeLabel(42 as unknown as string)).toBeNull();
    const [chat] = chatsFromUpdates({ result: [{ message: { chat: { id: 5, type: 'private', first_name: 'A', username: 'not a name!' } } }] });
    expect(chat).toMatchObject({ id: 5, firstName: 'A', username: null });
    expect(describeChat({ id: 5, type: 'private', firstName: null, username: null, title: null })).toBe('  5   private chat   no name shown');
    expect(describeChat({ id: -9, type: 'group', firstName: null, username: null, title: 'Team' })).toContain('title: Team');
  });

  it('S-9: the missing-token message no longer suggests typing the token into the terminal', async () => {
    const h = telegramHarness({ ok: true, result: [] }, { env: {} });
    await telegramMain([], h.deps);
    expect(h.all()).toContain('.secrets.local');
    expect(h.all()).not.toMatch(/in this terminal/);
  });

  it('asks Telegram with a POST to getUpdates, the token only in the URL path', async () => {
    const h = telegramHarness({ ok: true, result: [update(42424242)] });
    await telegramMain([], h.deps);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(h.calls[0]?.init.method).toBe('POST');
    expect(String(h.calls[0]?.init.body)).not.toContain(TOKEN);
  });

  it('says what to do when nobody has written to the bot yet', async () => {
    const h = telegramHarness({ ok: true, result: [] });
    expect(await telegramMain([], h.deps)).toBe(1);
    expect(h.all()).toContain('press Start');
    expect(h.all()).not.toContain(TOKEN);
  });

  it('a rejected token (401) and a webhook conflict (409) give plain messages without the token', async () => {
    const bad = telegramHarness({ ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` });
    expect(await telegramMain([], bad.deps)).toBe(1);
    expect(bad.all()).toContain('did not accept the token');
    expect(bad.all()).not.toContain(TOKEN);
    const hook = telegramHarness({ ok: false, error_code: 409, description: 'webhook' });
    expect(await telegramMain([], hook.deps)).toBe(1);
    expect(hook.all()).toContain('webhook');
  });

  it('a network failure never prints the token, even if the error text contains the URL', async () => {
    const h = telegramHarness({}, {
      fetch: async () => {
        throw new Error(`fetch failed for https://api.telegram.org/bot${TOKEN}/getUpdates`);
      },
    });
    expect(await telegramMain([], h.deps)).toBe(1);
    expect(h.all()).toContain('network problem');
    expect(h.all()).not.toContain(TOKEN);
    expect(scrub(`x https://api.telegram.org/bot${TOKEN}/getUpdates y`, null)).not.toContain(TOKEN);
    expect(scrub(`token ${TOKEN}`, TOKEN)).toBe('token [token hidden]');
  });

  it('reads the token from .secrets.local when the environment has none, and refuses a tracked file', async () => {
    const file = `# bot\nTELEGRAM_BOT_TOKEN=${TOKEN}\nOTHER=1\n`;
    const ok = telegramHarness({ ok: true, result: [update(555555)] }, { env: {}, exists: () => true, read: () => file });
    expect(await telegramMain([], ok.deps)).toBe(0);
    expect(ok.calls[0]?.url).toContain(TOKEN);
    expect(ok.all()).not.toContain(TOKEN);

    const tracked = telegramHarness({ ok: true, result: [] }, { env: {}, exists: () => true, read: () => file, git: { top: () => '/repo', tracked: () => true, ignored: () => true } });
    expect(await telegramMain(['--file', '/repo/.secrets.local'], tracked.deps)).toBe(2);
    expect(tracked.calls).toEqual([]);
    expect(tracked.all()).toContain('REFUSED');
    expect(tracked.all()).not.toContain(TOKEN);
  });

  it('with no token anywhere it stops and sends nothing', async () => {
    const h = telegramHarness({ ok: true, result: [] }, { env: {} });
    expect(await telegramMain([], h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
  });

  it('chatsFromUpdates ignores updates without a chat and unsafe numbers', () => {
    expect(chatsFromUpdates({ result: [{ update_id: 1 }, { message: { chat: { id: 'x', type: 'private' } } }, { message: { chat: { id: 7, type: 'private' } } }] })).toEqual([{ id: 7, type: 'private', firstName: null, username: null, title: null }]);
    expect(chatsFromUpdates(null)).toEqual([]);
  });
});

// ---- age ---------------------------------------------------------------------------------------------------------------

const PRIVATE_KEY = fakeAgePrivateKey();
const PUBLIC_KEY = fakeAgePublicKey();

function ageHarness(over: Record<string, unknown> = {}) {
  const out: string[] = [];
  const errs: string[] = [];
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const files = new Set<string>();
  const home = tempDir('ps-home-');
  const deps = {
    log: (s: string) => out.push(s),
    err: (s: string) => errs.push(s),
    home,
    platform: 'win32',
    exists: (p: string) => files.has(p),
    mkdir: () => undefined,
    run: (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      if (args[0] === '--version') return { status: 0, stdout: 'v1.3.2', stderr: '', missing: false };
      if (args[0] === '-o') {
        files.add(args[1] as string);
        // The real program writes the private key into the file and prints "Public key: ..." to the screen: it must never be shown.
        return { status: 0, stdout: PRIVATE_KEY, stderr: `Public key: ${PUBLIC_KEY}`, missing: false };
      }
      if (args[0] === '-y') return { status: 0, stdout: `${PUBLIC_KEY}\n`, stderr: '', missing: false };
      return { status: 1, stdout: '', stderr: '', missing: false };
    },
    ...over,
  };
  return { deps, out, errs, calls, files, home, all: () => [...out, ...errs].join('\n') };
}

describe('make-age-keys', () => {
  it('prints only the PUBLIC key and where the private file is; the private key never reaches the screen', () => {
    const h = ageHarness();
    expect(ageMain([], h.deps)).toBe(0);
    const text = h.all();
    expect(text).toContain(PUBLIC_KEY);
    expect(text).toContain('AGE_PUBLIC_KEY');
    expect(text).not.toContain(PRIVATE_KEY);
    expect(text).not.toContain('AGE-SECRET-KEY');
    expect(text).toContain('age-production-key.txt');
  });

  it('writes the private key to a file in the home folder, outside the project', () => {
    const h = ageHarness();
    ageMain([], h.deps);
    const made = h.calls.find((c) => c.args[0] === '-o');
    expect(made?.args[1]).toBe(join(h.home, 'power-smash-keys', 'age-production-key.txt'));
    expect(String(made?.args[1]).startsWith(ROOT)).toBe(false);
  });

  it('--drill makes a separate key with the drill names', () => {
    const h = ageHarness();
    expect(ageMain(['--drill'], h.deps)).toBe(0);
    expect(h.all()).toContain('AGE_DRILL_PUBLIC_KEY');
    expect(h.all()).toContain('AGE_DRILL_KEY');
    expect(h.calls.find((c) => c.args[0] === '-o')?.args[1]).toContain('age-drill-key.txt');
  });

  it('when age-keygen is missing it prints the approved-download instructions and stops: nothing is downloaded or made', () => {
    const h = ageHarness({ run: (cmd: string, args: string[]) => (h.calls.push({ cmd, args }), { status: null, stdout: '', stderr: '', missing: true }) });
    expect(ageMain([], h.deps)).toBe(2);
    const text = h.all();
    expect(text).toContain('Nothing was downloaded');
    expect(text).toContain('yes, download age');
    expect(text).toContain(AGE_WINDOWS_ZIP);
    expect(text).toContain(`v${AGE_VERSION}`);
    expect(h.calls.every((c) => c.args[0] === '--version')).toBe(true); // only the existence probe ran
    expect(h.files.size).toBe(0);
  });

  it('instructions differ by platform and never contain a download command', () => {
    const win = missingProgramHelp('win32').join('\n');
    const linux = missingProgramHelp('linux').join('\n');
    expect(win).toContain('.zip');
    expect(linux).toContain('apt install age');
    for (const t of [win, linux]) expect(t).not.toMatch(/curl|wget|Invoke-WebRequest|iwr /i);
  });

  it('refuses a target inside the project folder', () => {
    const h = ageHarness();
    expect(ageMain(['--out', join(ROOT, 'age-key-prod.txt')], h.deps)).toBe(2);
    expect(h.errs.join('\n')).toContain('inside the project folder');
    expect(h.calls).toEqual([]);
  });

  it('refuses to overwrite an existing file', () => {
    const h = ageHarness();
    const target = join(h.home, 'power-smash-keys', 'age-production-key.txt');
    h.files.add(target);
    expect(ageMain([], h.deps)).toBe(2);
    expect(h.errs.join('\n')).toContain('already exists');
    expect(h.calls).toEqual([]);
  });

  it('a failing age-keygen shows none of its output (it could hold key material)', () => {
    const h = ageHarness({
      run: (_cmd: string, args: string[]) => (args[0] === '--version' ? { status: 0, stdout: 'v1', stderr: '', missing: false } : { status: 1, stdout: PRIVATE_KEY, stderr: PRIVATE_KEY, missing: false }),
    });
    expect(ageMain([], h.deps)).toBe(1);
    expect(h.all()).not.toContain(PRIVATE_KEY);
  });

  it('refuses an unreadable public key instead of printing something wrong', () => {
    const h = ageHarness({
      run: (_cmd: string, args: string[]) => {
        if (args[0] === '--version') return { status: 0, stdout: 'v1', stderr: '', missing: false };
        if (args[0] === '-o') return { status: 0, stdout: '', stderr: '', missing: false };
        return { status: 0, stdout: PRIVATE_KEY, stderr: '', missing: false }; // -y returns garbage
      },
      exists: () => false,
    });
    // the key file does not exist after -o, so the run stops before -y
    expect(ageMain([], h.deps)).toBe(1);
    expect(h.all()).not.toContain(PRIVATE_KEY);
  });
});
