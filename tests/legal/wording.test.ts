// Legal pages are drafts for a lawyer: they must never claim legal compliance, certification or approval, and must stay in plain
// English. These checks read every sentence we wrote.
import { describe, expect, it } from 'vitest';
import { docWording } from '../../src/content/legal/model';
import { CONSENT } from '../../src/content/consent';
import { ALL_ON, DOC_ENTRIES, entriesFor } from './helpers';

/** The pages as rendered now, plus the widest wording they can ever show (every later feature on). */
const WIDE_ENTRIES = [...DOC_ENTRIES.map(([k, d]) => [`${k} (now)`, d] as const), ...entriesFor(ALL_ON).map(([k, d]) => [`${k} (all features on)`, d] as const)];

const CLAIMS: [RegExp, string][] = [
  [/\b(fully |completely )?compliant\b/i, 'claims compliance'],
  [/\bwe comply\b|\bcomplies with\b|\bin compliance with\b/i, 'claims compliance'],
  [/\bcertified\b|\bcertification\b|\bcertificate\b/i, 'claims certification'],
  [/\bapproved by\b|\bendorsed by\b|\bauthori[sz]ed by\b/i, 'claims approval'],
  [/\bGDPR\b|\bISO ?27001\b|\bSOC ?2\b|\bPCI\b/i, 'names a standard we have not been audited against'],
  [/\b100%|\bguaranteed? (to be )?(safe|secure|private)\b/i, 'over-promises'],
  [/\bbank-?grade\b|\bmilitary-?grade\b|\bunhackable\b/i, 'over-promises'],
  [/\blegal advice\b(?!.*\bnot\b)/i, 'mentions legal advice outside "not legal advice"'],
];

describe('no claims of compliance, certification or approval', () => {
  it.each(WIDE_ENTRIES)('%s', (key, doc) => {
    for (const text of docWording(doc)) {
      for (const [re, why] of CLAIMS) {
        // The "not legal advice" disclaimer is the draft notice (a component), not page wording.
        expect(text, `${key} ${why}: "${text.slice(0, 90)}"`).not.toMatch(re);
      }
    }
  });

  it('consent texts make no such claims either', () => {
    for (const c of Object.values(CONSENT)) for (const [re, why] of CLAIMS) expect(c.text, `${c.id} ${why}`).not.toMatch(re);
  });

  it('the dark-pattern "self-audit" is described as our own check, not a certificate', () => {
    const disc = docWording(DOC_ENTRIES.find(([k]) => k === 'disclosures')![1]).join('\n');
    expect(disc).toMatch(/We last checked this website/);
  });
});

describe('plain English', () => {
  it.each(WIDE_ENTRIES)('%s: sentences are short enough to read on a phone', (key, doc) => {
    for (const text of docWording(doc)) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const words = sentence.trim().split(/\s+/).filter(Boolean).length;
        expect(words, `${key}: a sentence has ${words} words: "${sentence.slice(0, 80)}..."`).toBeLessThanOrEqual(75);
      }
    }
  });

  it('uses no raw legal Latin or heavy jargon in headings', () => {
    for (const [, doc] of DOC_ENTRIES) {
      const headings = [doc.title, ...doc.sections.map((s) => s.heading)].join('\n');
      expect(headings).not.toMatch(/\b(hereinafter|whereas|indemnif|jurisprudence|notwithstanding)\b/i);
    }
  });

  it('the words that tell people a Todo or a draft is pending are never hard-coded in the wording', () => {
    for (const [, doc] of DOC_ENTRIES) for (const text of docWording(doc)) expect(text).not.toMatch(/TODO\(owner\)/);
  });
});

describe('privacy for children is stated in plain words (D-012)', () => {
  it('no page asks a child to use a form, and none promises to market to minors', () => {
    for (const [, doc] of DOC_ENTRIES) {
      const text = docWording(doc).join('\n');
      expect(text).not.toMatch(/\b(kids?|children) can (use|fill|submit)\b/i);
      expect(text).not.toMatch(/\bmarket(ing)? to (kids|children|minors)\b(?!.*not)/i);
    }
  });
});

// B-9 and C-7 (R-ACK-PROMISE): no page may promise how fast we reply to an ENQUIRY. Only the owner's `replyTimePromise` in
// src/content/site.ts may do that, and it is shown on the confirmation screen and in the acknowledgement email, never here.
// Timelines for a complaint, a data request, a removal request or a legal order are different and are allow-listed in numbers.test.ts.
describe('no reply-time promise for enquiries (R-ACK-PROMISE)', () => {
  const REPLY = /(reply|replies|respond|answer|get back to you|come back to you)[^.]{0,60}\b(within|in|inside)\s+(\d+|one|two|three|a|an|the next)\s+(hours?|days?|business days?)/i;
  const OTHER_CONTEXT = /complain|grievance|request|removal|court|order|notice|acknowledge/i;

  it.each(WIDE_ENTRIES)('%s: no sentence promises a reply or an answer to an enquiry within a time', (key, doc) => {
    for (const text of docWording(doc)) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (REPLY.test(sentence) && !OTHER_CONTEXT.test(sentence)) expect.fail(`${key}: "${sentence.slice(0, 100)}" promises a reply time`);
      }
    }
  });

  it('no consent text promises one either', () => {
    for (const c of Object.values(CONSENT)) expect(c.text, c.id).not.toMatch(REPLY);
  });

  it('the guard catches a real promise', () => {
    expect(REPLY.test('We will reply within 24 hours.')).toBe(true);
    expect(REPLY.test('We reply to every enquiry in two days.')).toBe(true);
    expect(REPLY.test('We will get back to you as soon as we can.')).toBe(false);
  });
});
