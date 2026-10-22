// Telegram chat-number helper (OT-08, BUILD_PLAN M1 item 4a). THE OWNER RUNS THIS at the PC. Claude never runs it with a real token.
//
//   node scripts/telegram-chat-id.mjs
//
// Before running: in Telegram open your bot (Power Smash Alerts), press Start and send it one message, for example "hi".
// What it does: asks Telegram (getUpdates) which chats have written to the bot and prints, for each chat, the chat number, the chat type
// (private chat or group), and the first name and @username Telegram shows for it, so you can tell YOUR chat from a stranger's: anyone who
// finds the bot's name can message it (review S-9). It never prints the bot token or any message text. The number is not a secret; the
// token is. The token is read from your untracked .secrets.local file (TELEGRAM_BOT_TOKEN=...; same rules as the loader: refused if git
// tracks the file or does not ignore it), or from the environment variable of the same name when a script sets it. It is used for this one
// question only. Do not type the token on a command line: it would stay in the shell history.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMain } from './lib/is-main.mjs';
import { parseSecretsText, realGit, secretsFileProblem } from './lib/secrets-file.mjs';

/** Remove the token (and the bot<token> URL form) from any text before it is shown. */
export function scrub(text, token) {
  let out = String(text);
  if (token) out = out.split(token).join('[token hidden]');
  return out.replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot[token hidden]');
}

/** A name from Telegram made safe to print: control, bidi and zero-width characters removed, spaces collapsed, at most 40 characters. */
export function safeLabel(value) {
  if (typeof value !== 'string') return null;
  let cleaned = '';
  for (const ch of value) {
    const c = ch.codePointAt(0);
    // control characters, soft hyphen, zero-width and bidirectional marks, line and paragraph separators
    const hidden = c < 32 || (c >= 127 && c <= 159) || c === 0xad || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;
    cleaned += hidden ? ' ' : ch;
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  return cleaned.length > 40 ? `${cleaned.slice(0, 39)}...` : cleaned;
}

/**
 * The distinct chats in a getUpdates reply: the number, the chat type, and the first name, @username and group title Telegram shows
 * for the chat (each made printable, or null). Message text is never read.
 */
export function chatsFromUpdates(reply) {
  const seen = new Map();
  const list = Array.isArray(reply?.result) ? reply.result : [];
  for (const update of list) {
    const chat = update?.message?.chat;
    if (chat && Number.isSafeInteger(chat.id) && !seen.has(chat.id)) {
      seen.set(chat.id, {
        id: chat.id,
        type: typeof chat.type === 'string' ? chat.type : 'unknown',
        firstName: safeLabel(chat.first_name),
        username: typeof chat.username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(chat.username) ? chat.username : null,
        title: safeLabel(chat.title),
      });
    }
  }
  return [...seen.values()];
}

/** One printable line per chat. */
export function describeChat(chat) {
  const kind = chat.type === 'private' ? 'private chat' : `${chat.type} (not a private chat: do not use)`;
  const who = [];
  if (chat.firstName) who.push(`first name: ${chat.firstName}`);
  if (chat.username) who.push(`username: @${chat.username}`);
  if (chat.title) who.push(`title: ${chat.title}`);
  if (who.length === 0) who.push('no name shown');
  return `  ${chat.id}   ${kind}   ${who.join('   ')}`;
}

function readTokenFromFile(file, deps) {
  const exists = deps.exists ?? existsSync;
  if (!exists(file)) return { token: null };
  const refusal = secretsFileProblem(file, deps.git ?? realGit);
  if (refusal) return { token: null, refusal };
  const { entries } = parseSecretsText((deps.read ?? ((p) => readFileSync(p, 'utf8')))(file));
  const token = entries.get('TELEGRAM_BOT_TOKEN')?.value ?? null;
  return { token: token && token !== '' ? token : null };
}

/** @returns {Promise<number>} 0 found, 1 nothing found or Telegram refused, 2 cannot start */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;

  let token = (env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (token === '') {
    const i = argv.indexOf('--file');
    const file = resolve(i !== -1 && argv[i + 1] ? argv[i + 1] : '.secrets.local');
    const r = readTokenFromFile(file, deps);
    if (r.refusal) {
      err(`telegram-chat-id: REFUSED to read ${file}: ${r.refusal}.`);
      return 2;
    }
    token = r.token ?? '';
  }
  if (token === '') {
    err('telegram-chat-id: no bot token found. Put TELEGRAM_BOT_TOKEN=... in .secrets.local (never in chat, never on a command line), then run again.');
    return 2;
  }

  let res;
  try {
    res = await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 100, allowed_updates: ['message'] }),
    });
  } catch (e) {
    err(`telegram-chat-id: could not reach Telegram (network problem). ${scrub(e && e.message ? e.message : '', token).slice(0, 120)}`);
    return 1;
  }

  let reply = null;
  try {
    reply = await res.json();
  } catch {
    reply = null;
  }
  if (!res.ok || !reply || reply.ok !== true) {
    const code = reply && Number.isInteger(reply.error_code) ? reply.error_code : res.status;
    if (code === 401) err('telegram-chat-id: Telegram did not accept the token (401). Check it, or make a new one with @BotFather.');
    else if (code === 409) err('telegram-chat-id: this bot has a webhook set (409), so Telegram will not hand out updates this way. Tell Claude.');
    else err(`telegram-chat-id: Telegram answered with an error (${code}).`);
    return 1;
  }

  const chats = chatsFromUpdates(reply);
  if (chats.length === 0) {
    err('telegram-chat-id: no messages found. Open your bot in Telegram, press Start, send it a message such as "hi", then run this again (Telegram keeps messages for 24 hours).');
    return 1;
  }
  log('Chats that have written to the bot (number, type, name as Telegram shows it):');
  for (const chat of chats) log(describeChat(chat));
  const privateChats = chats.filter((c) => c.type === 'private');
  if (privateChats.length > 1) {
    log('');
    log(`WARNING: ${privateChats.length} different private chats have written to the bot. Anyone who finds the bot's name can message it, and the alerts must reach ONLY you.`);
    log('Use the number of the chat whose first name and username are YOURS. If you do not recognise any of them as yours, do not continue: tell Claude.');
  } else if (privateChats.length === 1) {
    log('');
    log('Check that the first name and username above are yours before you use this number.');
  }
  log('Put your private chat number in .secrets.local as TELEGRAM_CHAT_ID=<number>. The alerts must go to a private chat, never a group (OT-08).');
  return 0;
}

if (isMain(import.meta.url)) process.exit(await main());
