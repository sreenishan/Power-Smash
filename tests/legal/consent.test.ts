// Consent and notice texts (D-028, spec 15.4): every text has an id and a version, the version changes when the text changes,
// every text is short and plain, nothing is pre-ticked, and no text claims compliance or names a price.
//
// HOW THE PIN WORKS. PINS holds, per key, the version and the SHA-256 of its text. If you edit a text without changing its
// version, the test fails ("bump the version"). If you bump the version, the pin must be updated in the same commit, so the
// change is deliberate and the lawyer's review trail stays honest. To get a new hash run:
//   node -e "const c=require('node:crypto');import('./src/content/consent.ts').then(m=>{for(const[k,v]of Object.entries(m.CONSENT))console.log(k,v.version,c.createHash('sha256').update(v.text,'utf8').digest('hex'))})"
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONSENT, type ConsentKey, type ConsentText } from '../../src/content/consent';
import { CURRENCY, PERCENT, durationsIn } from './helpers';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

export const PINS: Record<ConsentKey, { version: string; sha256: string }> = {
  leadNotice: { version: '2026-10-21-draft2', sha256: 'd9016a54a42716ee67d11ec83bda9558f066d33963341fc1cfb0f47c200a309c' },
  tournamentPublicContact: { version: '2026-10-21-draft2', sha256: '2330b7d1a53cc79eab81c618c4327dfe2063a784606790caaa612858c849fa9d' },
  alertsSignup: { version: '2026-10-21-draft1', sha256: 'd73d2bccf3ea886ecb6ff57853bf9e23b3e3a95e3e1fe3c5639b872d2089faa2' },
  adultConfirmation: { version: '2026-10-21-draft1', sha256: 'e94c9496c680226138dfc24ce854d5923cc2308d44921bee93ae9072204714dd' },
  videoRights: { version: '2026-10-21-draft1', sha256: '899e4f1dfff993496934e5cda8bd05df41e44b9eb8c563c349b3ad02d960cb53' },
  videoLicence: { version: '2026-10-21-draft1', sha256: '3ccb8f056b0c04aa2bd261df69745c70ee096b2a8ac7988954653bafb2525d78' },
  videoRemoval: { version: '2026-10-21-draft1', sha256: 'edd7129a51d4b1c985901f8408edb06b7cf456d5cb8ee3c0ed781e4a4500ade8' },
  requestNotice: { version: '2026-10-21-draft1', sha256: '74df02d3d55f2a37acb1a808223f74bf0a3694bd3282dbb23f805eb111527f3b' },
};

/** Versions that were shown to visitors (or reviewed) and then replaced. A retired version must never come back with other text. */
const RETIRED: Record<string, { key: ConsentKey; version: string; sha256: string }> = {
  'lead-notice@2026-10-21-draft1': {
    key: 'leadNotice',
    version: '2026-10-21-draft1',
    sha256: '1ee382b24c9d26f076ad8ce0a3bdb27cb0c0868b391185366072fc0b2232d51a',
  },
  'tournament-public-contact@2026-10-21-draft1': {
    key: 'tournamentPublicContact',
    version: '2026-10-21-draft1',
    sha256: '44d5ec75954001096454f5f296f4400284575f261869cdbeded43eef8d771776',
  },
};

/** Timelines a consent text may state, with the source. */
const ALLOWED_DURATIONS: Partial<Record<ConsentKey, string[]>> = {
  leadNotice: ['24 months'], // spec 15.4: closed leads anonymised after 24 months
  requestNotice: ['12 months'], // D-028: request records until resolved plus 12 months
};

const ENTRIES = Object.entries(CONSENT) as [ConsentKey, ConsentText][];
const VERSION = /^\d{4}-\d{2}-\d{2}-draft\d+$|^\d{4}-\d{2}-\d{2}$/;
const LEAD_SCHEMA_VERSION = /^[A-Za-z0-9._-]{1,40}$/; // src/lib/contracts/lead.ts accepts only this shape

describe('consent texts have an id and a version', () => {
  it.each(ENTRIES)('%s: id is kebab-case and the version is a dated draft or release', (_key, c) => {
    expect(c.id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    expect(c.version).toMatch(VERSION);
    expect(c.version).toMatch(LEAD_SCHEMA_VERSION);
    expect(c.text.trim()).toBe(c.text);
    expect(c.text.length).toBeGreaterThan(0);
  });

  it('ids are unique', () => {
    const ids = ENTRIES.map(([, c]) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the keys and ids that other code already depends on', () => {
    expect(CONSENT.leadNotice.id).toBe('lead-notice');
    expect(CONSENT.tournamentPublicContact.id).toBe('tournament-public-contact');
  });

  // C-10: consent and notice evidence is "id + version + time" stored with every submission, and the notice text is held in git
  // and pinned by hash. An id is stored forever, so changing one would break the link between an old consent and its wording:
  // every id is pinned here. Add a new key by adding a new line, never by editing an old one.
  it('every key has a stable id: the ids are pinned and never change', () => {
    const IDS: Record<ConsentKey, string> = {
      leadNotice: 'lead-notice',
      tournamentPublicContact: 'tournament-public-contact',
      alertsSignup: 'alerts-signup',
      adultConfirmation: 'adult-confirmation',
      videoRights: 'video-rights',
      videoLicence: 'video-licence',
      videoRemoval: 'video-removal',
      requestNotice: 'request-notice',
    };
    expect(Object.keys(IDS).sort()).toEqual(Object.keys(CONSENT).sort());
    for (const [key, c] of ENTRIES) expect(c.id, `the id of ${key} changed`).toBe(IDS[key]);
  });

  it('every key has a version and a pin, and each text is hashed with SHA-256 over its exact characters', () => {
    for (const [key, c] of ENTRIES) {
      expect(c.version.trim(), `${key} has no version`).not.toBe('');
      expect(PINS[key].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sha(c.text)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('defines the texts for the later forms (alerts, submit-video, request) so the lawyer reviews them together', () => {
    for (const k of ['alertsSignup', 'adultConfirmation', 'videoRights', 'videoLicence', 'videoRemoval', 'requestNotice'] as const) {
      expect(CONSENT[k].id).toBeTruthy();
    }
  });
});

describe('the version changes when the text changes (pinned hash)', () => {
  it('has a pin for every text and no stale pin', () => {
    expect(Object.keys(PINS).sort()).toEqual(Object.keys(CONSENT).sort());
  });

  it.each(ENTRIES)('%s: text and version match the pin', (key, c) => {
    const pin = PINS[key];
    const hash = sha(c.text);
    if (c.version === pin.version) {
      expect(hash, `The text of "${key}" changed but its version is still ${c.version}. Bump the version in src/content/consent.ts, then update PINS.`).toBe(pin.sha256);
    } else {
      expect.fail(`The version of "${key}" is now ${c.version}. Update PINS in tests/legal/consent.test.ts to { version: '${c.version}', sha256: '${hash}' } and record why in the change.`);
    }
  });

  it('a retired version never returns with different text', () => {
    for (const [name, r] of Object.entries(RETIRED)) {
      const now = CONSENT[r.key];
      if (now.version === r.version) expect(sha(now.text), `${name} was retired with other text`).toBe(r.sha256);
      else expect(sha(now.text)).not.toBe(r.sha256); // the text actually changed, not only the version
    }
  });

  it('the two shown-to-users texts moved to draft2 because their wording changed', () => {
    expect(CONSENT.leadNotice.version).toBe('2026-10-21-draft2');
    expect(CONSENT.tournamentPublicContact.version).toBe('2026-10-21-draft2');
  });
});

describe('every text is short, plain and honest', () => {
  it.each(ENTRIES)('%s: short, no price, no percentage, no compliance claim, no implied consent', (key, c) => {
    expect(c.text.length, 'keep it short').toBeLessThanOrEqual(420);
    expect(c.text).not.toMatch(CURRENCY);
    expect(c.text).not.toMatch(PERCENT);
    expect(c.text).not.toMatch(/\bcompl(y|ies|iant|iance)\b|\bcertified\b|\bGDPR\b/i);
    // A consent must be an affirmative statement the visitor ticks, never "by submitting you agree".
    expect(c.text).not.toMatch(/by (submitting|clicking|continuing|using)\b/i);
    expect(c.text).not.toMatch(/\bpre-?ticked\b|\bchecked by default\b/i);
    for (const d of durationsIn(c.text)) expect(ALLOWED_DURATIONS[key] ?? [], `${key} states an unlisted timeline "${d}"`).toContain(d);
  });

  it('the notices mention the Privacy Policy so the form can link it', () => {
    for (const k of ['leadNotice', 'alertsSignup', 'requestNotice'] as const) expect(CONSENT[k].text).toContain('Privacy Policy');
  });

  it('the lead notice says what we do (reply and arrange), who sees it, how long we keep it, and that we never sell it', () => {
    const t = CONSENT.leadNotice.text;
    expect(t).toMatch(/only to reply to this enquiry/);
    expect(t).toMatch(/service providers that run this website/);
    expect(t).toMatch(/24 months/);
    expect(t).toMatch(/never sell/);
    expect(t).toMatch(/correct or delete/);
  });

  it('the tournament contact consent says "tick only if you want this" and that it can be withdrawn', () => {
    expect(CONSENT.tournamentPublicContact.text).toMatch(/Tick only if you want this/);
    expect(CONSENT.tournamentPublicContact.text).toMatch(/ask us to hide it/);
  });

  it('the video licence matches D-019: non-exclusive, publish and earn money on YouTube and the site, life of the video, credit', () => {
    const t = CONSENT.videoLicence.text;
    expect(t).toMatch(/non-exclusive/);
    expect(t).toMatch(/YouTube channel and website/);
    expect(t).toMatch(/earn money/);
    expect(t).toMatch(/anywhere in the world/);
    expect(t).toMatch(/as long as the video stays on the channel/);
    expect(t).toMatch(/credit me by name/);
  });

  it('the submit-video confirmations cover spec 7.12: adult, rights, licence, removal on a valid request', () => {
    expect(CONSENT.adultConfirmation.text).toMatch(/18 or older/);
    expect(CONSENT.videoRights.text).toMatch(/recorded this video myself, or I have the right/);
    expect(CONSENT.videoRemoval.text).toMatch(/valid request/);
  });
});
