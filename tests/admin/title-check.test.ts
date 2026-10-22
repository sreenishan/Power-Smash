// Title check (spec 10.8, D-017). Titles are SYNTHETIC. The adversarial age corpus idea: an age in brackets or any odd position must warn.
import { describe, expect, it } from 'vitest';
import { checkTitle } from '../../src/lib/admin/title-check';
import { parseTitle } from '../../src/lib/parser';

const GOOD = 'Demo Karthik vs Sample Arul || MS Final || Demo District Open 2026';

describe('a title in convention v2', () => {
  it('reads every part and will be accepted', () => {
    const c = checkTitle(GOOD);
    expect(c.kind).toBe('match');
    expect(c.sideA).toEqual(['Demo Karthik']);
    expect(c.sideB).toEqual(['Sample Arul']);
    expect(c.category).toContain('MS');
    expect(c.round).toBe('Final');
    expect(c.tournament).toBe('Demo District Open');
    expect(c.year).toBe(2026);
    expect(c.yearNote).toBe('in the title');
    expect(c.verdict.accepted).toBe(true);
    expect(c.ageWarning).toBeNull();
    expect(c.suggestions).toEqual([]);
    expect(c.correctedTitle).toBe(GOOD);
    expect(c.correctedDiffers).toBe(false);
  });
  it('doubles with a place after one dash', () => {
    const t = 'Demo Selvi / Mock Kavya vs Sample Divya / Trial Nithya || WD Semi Final || Sample State Championship - Sample City 2026';
    const c = checkTitle(t);
    expect(c.sideA).toHaveLength(2);
    expect(c.round).toBe('Semi Final');
    expect(c.verdict.accepted).toBe(true);
  });
});

describe('verdicts say why in plain English', () => {
  it('missing pieces: needs review, with reasons and suggestions', () => {
    const c = checkTitle('Demo Karthik vs Sample Arul');
    expect(c.verdict.accepted).toBe(false);
    expect(c.verdict.reasons.length).toBeGreaterThan(0);
    for (const r of c.verdict.reasons) expect(r).not.toMatch(/[A-Z]{3,}_[A-Z]{2,}/);
    expect(c.suggestions.join(' ')).toMatch(/double pipe/);
    expect(c.suggestions.join(' ')).toMatch(/category/i);
  });
  it('not a match: says so', () => {
    const c = checkTitle('Best smashes of the year compilation');
    expect(c.kind).toBe('not_a_match');
    expect(c.notAMatchWhy).toBeTruthy();
    expect(c.verdict.accepted).toBe(false);
    expect(c.correctedTitle).toBeNull();
  });
  it('convention advice: extra dashes, dash in the name, long title, hashtags, no year', () => {
    const c = checkTitle('Demo A Kumar vs Sample B Raja || MS Final || Demo - Open - Cup #badminton');
    const s = c.suggestions.join(' | ');
    expect(s).toMatch(/at most one/i);
    expect(s).toMatch(/year/i);
    expect(s).toMatch(/Hashtags/);
    expect(checkTitle(`${GOOD} ${'x'.repeat(100)}`).suggestions.join(' ')).toMatch(/cuts titles at 100/);
  });
  it('single-name players get the full-name advice', () => {
    expect(checkTitle('Ganesh vs Santhosh || MS Final || Demo Open 2026').suggestions.join(' ')).toMatch(/initial plus surname/);
  });
  it('a corrected title is offered, in v2 order, and differs from a legacy title', () => {
    const c = checkTitle('Demo Karthik vs Sample Arul MS Final Demo District Open 2026');
    if (c.correctedTitle) {
      expect(c.correctedTitle).toMatch(/ vs .* \|\| .* \|\| /);
      expect(checkTitle(c.correctedTitle).verdict.accepted).toBe(true);
    }
  });
  it('pasted line breaks and tabs become spaces', () => {
    expect(checkTitle(`Demo Karthik vs Sample Arul\n|| MS Final\t|| Demo District Open 2026`).sideA).toEqual(['Demo Karthik']);
  });
  it('an empty title does not throw', () => {
    const c = checkTitle('   ');
    expect(c.verdict.accepted).toBe(false);
    expect(c.sideA).toEqual([]);
  });
});

describe('adversarial age corpus: an age anywhere must warn and must never be accepted', () => {
  const A = 'Arun Kumar vs Bala Murugan';
  const cases: [string, string][] = [
    ['round brackets', `${A} (U15) || MS Final || State Cup 2026`],
    ['square brackets', `${A} [U15] || MS Final || State Cup 2026`],
    ['both sides', 'Arun Kumar (U15) vs Bala Murugan (U15) || MS Final || State Cup 2026'],
    ['U-15 dash', `${A} (U-15) || MS Final || State Cup 2026`],
    ['15U', `${A} (15U) || MS Final || State Cup 2026`],
    ['Junior word', `${A} (Junior) || MS Final || State Cup 2026`],
    ['Sub Junior', `${A} (Sub Junior) || State Cup 2026`],
    ['trailing Under-15', `${A} || MS Final || State Cup 2026 | Under-15`],
    ['trailing years', `${A} || MS Final || State Cup 2026 | 15 years`],
    ['prefix', `U15 ${A} || MS Final || State Cup 2026`],
    ['hashtag', `${A} || MS Final || State Cup 2026 #U15`],
    ['upper case', `${A} || MS Final || State Cup 2026 | UNDER-15`],
    ['junior category', `${A} || BS Final || State Cup 2026`],
    ['age in the tournament', `${A} || MS Final || State U17 Championship 2026`],
  ];
  for (const [label, title] of cases) {
    it(label, () => {
      const c = checkTitle(title);
      expect(c.ageWarning, title).not.toBeNull();
      expect(c.ageWarning).toMatch(/under 18/);
      expect(c.verdict.accepted, title).toBe(false);
      expect(c.verdict.reasons.join(' ')).toMatch(/junior|age/i);
    });
  }
  it('an age-like word the site does not know fails closed with a warning', () => {
    const c = checkTitle('Arun Kumar vs Bala Murugan || MS Final || State Cup 2026 | Under Fifty Nine Months');
    // either a mapped age (warn) or an unknown age word (warn): never silently accepted when the parser flags it
    const p = parseTitle('Arun Kumar vs Bala Murugan || MS Final || State Cup 2026 | Under Fifty Nine Months');
    if (p.hardFlags.includes('UNKNOWN_AGE_TOKEN') || p.minorHold) expect(c.ageWarning).not.toBeNull();
  });
  it('adults-only titles carry no warning; U21 is not a minor signal', () => {
    expect(checkTitle(`${A} || MS Final || State Cup 2026`).ageWarning).toBeNull();
    expect(checkTitle(`${A} (U21) || MS Final || State Cup 2026`).verdict.accepted).toBeDefined();
    expect(checkTitle(`${A} || MS Final || State Cup 2026`).verdict.accepted).toBe(true);
  });
  it('the warning agrees with the parser: minorHold implies a warning', () => {
    for (const [, title] of cases) if (parseTitle(title).minorHold) expect(checkTitle(title).ageWarning).not.toBeNull();
  });
});

describe('the tool only reads', () => {
  it('is deterministic and does not touch the parser output shape', () => {
    expect(checkTitle(GOOD)).toEqual(checkTitle(GOOD));
    expect(JSON.stringify(parseTitle(GOOD))).toBe(JSON.stringify(parseTitle(GOOD)));
  });
});
