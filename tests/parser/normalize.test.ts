/**
 * GREEN (M0): the pure text helpers defined by PC-05, PC-07, PC-08 and PC-12.
 * No title segmentation here: that is M2b.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  describeName,
  extractHashtags,
  isInitialToken,
  latinKey,
  mapTamilDigits,
  nameKey,
  normalizeName,
  normalizeTitle,
  preprocessTitle,
  stripEmoji,
  toDisplayName,
} from '../../src/lib/parser/normalize';

describe('normalizeName (PC-05 ordered pipeline)', () => {
  it.each([
    ['S. Karthik', 's karthik'], // spec A.3 example
    ['S.KARTHIK', 's karthik'], // glued initial
    ['KARTHIK S', 'karthik s'],
    ['Karthik.S', 'karthik s'], // dots removed alone would give "karthiks"
    ['V.S. KUMAR', 'v s kumar'],
    ['SANEETH D.S', 'saneeth d s'],
    ['MOHAMED-ALI', 'mohamed ali'], // hyphen to space
    ["D'Souza", 'dsouza'],
    ['D’Souza', 'dsouza'], // curly apostrophe
    ['  Arun   Kumar  ', 'arun kumar'],
    ['ＡＲＵＮ', 'arun'], // full-width capitals fold through NFKC
    ['Kar​thik', 'karthik'], // zero-width space
  ])('%s -> %s', (raw, key) => {
    expect(normalizeName(raw)).toBe(key);
  });

  it('keeps Tamil names (letters and combining marks): they must NOT normalise to an empty string', () => {
    for (const name of ['கார்த்திக்', 'அருண்', 'சென்னை']) {
      const key = normalizeName(name);
      expect(key, name).not.toBeNull();
      expect(key, name).not.toBe('');
      expect(key?.length, name).toBeGreaterThan(2);
    }
  });

  it('gives different Tamil players different keys (an ASCII-only key merged them all)', () => {
    expect(normalizeName('கார்த்திக்')).not.toBe(normalizeName('அருண்'));
  });

  it('keeps both scripts of a mixed-script name', () => {
    expect(normalizeName('Karthik கார்த்திக்')).toBe('karthik கார்த்திக்');
  });

  it('maps Tamil digits to ASCII digits', () => {
    expect(mapTamilDigits('௨௦௨௬')).toBe('2026');
    expect(normalizeName('Arun ௧')).toBe('arun 1');
  });

  it('rejects empty keys with null instead of an empty string', () => {
    for (const empty of ['', '   ', '...', '- . -', "''", '​‍']) expect(normalizeName(empty), JSON.stringify(empty)).toBeNull();
  });
});

describe('latinKey (PC-05: ASCII key for search, slugs and duplicate detection only)', () => {
  it('is the ASCII form for Latin names, accents folded', () => {
    expect(latinKey('S. Karthik')).toBe('s karthik');
    expect(latinKey('José')).toBe('jose');
    expect(latinKey('MOHAMED-ALI')).toBe('mohamed ali');
  });

  it('is null (never an empty string) for Tamil-only and mixed-script names: no transliteration is pinned', () => {
    expect(latinKey('கார்த்திக்')).toBeNull();
    expect(latinKey('Karthik கார்த்திக்')).toBeNull();
    expect(latinKey('...')).toBeNull();
    expect(latinKey('')).toBeNull();
  });
});

describe('initials styles (PC-12)', () => {
  it.each([
    ['S.KARTHIK', 'S. Karthik'],
    ['S. KARTHIK', 'S. Karthik'],
    ['KARTHIK S', 'Karthik S.'],
    ['Karthik.S', 'Karthik S.'],
    ['KP ARUN', 'K. P. Arun'],
    ['SR KUMAR', 'S. R. Kumar'],
    ['S V KUMAR', 'S. V. Kumar'],
    ['V.S. KUMAR', 'V. S. Kumar'],
    ['SANEETH D.S', 'Saneeth D. S.'],
    ['BHARATH SANJAI', 'Bharath Sanjai'],
    ['DAVIS', 'Davis'], // a word, not initials
    ['RAJ', 'Raj'], // 3 letters but has a vowel: a word
    ['MOHAMED-ALI', 'Mohamed-Ali'],
    ['SRI-RAM', 'Sri-Ram'],
    ["D'SOUZA", "D'Souza"],
    ['ahmad rizal', 'Ahmad Rizal'],
  ])('display %s -> %s', (raw, display) => {
    expect(toDisplayName(raw)).toBe(display);
  });

  it('preserves Tamil script in the display name', () => {
    expect(toDisplayName('கார்த்திக்')).toBe('கார்த்திக்');
    expect(toDisplayName('Karthik கார்த்திக்')).toBe('Karthik கார்த்திக்');
  });

  it('recognises initials: single letters and 2-3 consonant-only caps tokens', () => {
    for (const token of ['S', 'v', 'KP', 'SR', 'SKM']) expect(isInitialToken(token), token).toBe(true);
    for (const token of ['RAJ', 'AJ', 'SRI', 'Kp', 'Arun', 'SIVA']) expect(isInitialToken(token), token).toBe(false);
  });

  it('gives the same name_key whatever the position of the initial: S. Karthik = Karthik S. = KARTHIK S = Karthik.S', () => {
    const keys = ['S. Karthik', 'S.KARTHIK', 'Karthik S.', 'KARTHIK S', 'Karthik.S'].map(nameKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('karthik|s');
  });

  it('keeps initial order within the key and gives a pipe-free key when there are no initials', () => {
    expect(nameKey('KP ARUN')).toBe('arun|k p');
    expect(nameKey('PK ARUN')).not.toBe(nameKey('KP ARUN'));
    expect(nameKey('Arun Kumar')).toBe('arun kumar');
    expect(nameKey('MOHAMED-ALI')).toBe('mohamed ali');
  });

  it('does not confuse different people: Karthik S. and Karthik R. keep different keys', () => {
    expect(nameKey('Karthik S')).not.toBe(nameKey('Karthik R'));
  });

  it('never returns an empty key for a Tamil name', () => {
    expect(nameKey('கார்த்திக்')).toBe('கார்த்திக்');
    expect(nameKey('...')).toBeNull();
  });
});

describe('describeName (identity tier, PC-01)', () => {
  it.each([
    ['Velavan', 'single_token'],
    ['GANESH', 'single_token'],
    ['கார்த்திக்', 'single_token'],
    ['Mohamed-Ali', 'single_token'], // hyphenated = one token (safest)
    ['Bharath Sanjai', 'multi_token'],
    ['S. Karthik', 'multi_token'],
    ['Karthik S.', 'multi_token'],
    ['A', 'initials_only'],
    ['S. V.', 'initials_only'],
    ['KP', 'initials_only'],
  ])('%s is %s', (raw, tier) => {
    expect(describeName(raw).identityTier).toBe(tier);
  });

  it('flags a trailing ellipsis as truncated and drops it from the name', () => {
    const info = describeName('RAJ MURU…');
    expect(info.truncated).toBe(true);
    expect(info.displayName).toBe('Raj Muru');
    expect(describeName('RAJ MURU...').truncated).toBe(true);
    expect(describeName('RAJ MURU').truncated).toBe(false);
  });

  it('detects scripts and mixed-script names', () => {
    expect(describeName('Arun').scripts).toEqual(['latin']);
    expect(describeName('அருண்').scripts).toEqual(['tamil']);
    expect(describeName('Karthik கார்த்திக்').mixedScript).toBe(true);
    expect(describeName('Karthik').mixedScript).toBe(false);
  });

  it('measures the name length in letters (SHORT_NAME is < 2)', () => {
    expect(describeName('A').nameLength).toBe(1);
    expect(describeName('K P').nameLength).toBe(2);
    expect(describeName('Arun Kumar').nameLength).toBe(9);
  });
});

describe('normalizeTitle (PC-08 punctuation map, D-017 matching copy)', () => {
  it.each([
    ['ARUN V/S KUMAR || MS Semis – Test Cup 2026', 'ARUN V/S KUMAR || MS Semis - Test Cup 2026'], // en dash
    ['A vs B — Cup', 'A vs B - Cup'], // em dash
    ['A vs B − Cup', 'A vs B - Cup'], // minus sign
    ['A vs B ‐ Cup', 'A vs B - Cup'], // hyphen
    ['A vs B ‖ Cup', 'A vs B || Cup'], // U+2016 double vertical line
    ['ARUN ｖｓ KUMAR ｜｜ MS SF - Test Cup 2026', 'ARUN vs KUMAR || MS SF - Test Cup 2026'], // full width via NFKC
    ['Men’s Singles Final', "Men's Singles Final"], // curly apostrophe
    ['“Cup”', '"Cup"'],
    ['A vs B', 'A vs B'], // non-breaking space
  ])('%s', (raw, expected) => {
    expect(normalizeTitle(raw)).toBe(expected);
  });

  it('collapses whitespace BEFORE separators are looked for (PF-013)', () => {
    expect(normalizeTitle('ARUN    vs    KUMAR   ||   MS   SF  -  Test  Cup  2026')).toBe('ARUN vs KUMAR || MS SF - Test Cup 2026');
    expect(normalizeTitle('  trailing spaces   ')).toBe('trailing spaces');
  });

  it('strips U+FE0F for comparison only, keeps case, keeps emoji and Tamil letters', () => {
    expect(normalizeTitle('Smash Level ⚡️ || Badminton')).toBe('Smash Level ⚡ || Badminton');
    expect(normalizeTitle('ARUN vs KUMAR')).toBe('ARUN vs KUMAR');
    expect(normalizeTitle('கார்த்திக் vs அருண்')).toBe('கார்த்திக் vs அருண்');
  });

  it('maps Tamil digits so the year is recognisable (PF-075)', () => {
    expect(normalizeTitle('Test Cup ௨௦௨௬')).toBe('Test Cup 2026');
  });

  it('decodes entities in a single pass', () => {
    expect(decodeEntities('A &amp; B')).toBe('A & B');
    expect(decodeEntities('&quot;Cup&quot; &#39;x&#39; &#x2019;')).toBe('"Cup" \'x\' ’');
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&#0; &#1114112;')).toBe('&#0; &#1114112;');
    expect(normalizeTitle('A &amp; B vs C')).toBe('A & B vs C');
  });

  it('is idempotent', () => {
    for (const raw of ['ARUN    vs    KUMAR ‖ MS – Cup ௨௦௨௬', 'x ’ y']) {
      expect(normalizeTitle(normalizeTitle(raw))).toBe(normalizeTitle(raw));
    }
  });
});

describe('hashtags and emoji (PC-07)', () => {
  it('captures Latin and Tamil hashtags, lower-cased, before stripping them', () => {
    const { text, hashtags } = extractHashtags('ARUN vs KUMAR || MS SF - Test Cup 2026 #badminton #பேட்மிண்டன்');
    expect(hashtags).toEqual(['badminton', 'பேட்மிண்டன்']);
    expect(text).toBe('ARUN vs KUMAR || MS SF - Test Cup 2026');
  });

  it("does not treat 'Court #3' as a hashtag (letter-initial pattern)", () => {
    const { text, hashtags } = extractHashtags('ARUN vs KUMAR || Court #3 Final - Salem District 2026');
    expect(hashtags).toEqual([]);
    expect(text).toContain('Court #3 Final');
  });

  it('captures #shorts, the Shorts signal, and de-duplicates', () => {
    expect(extractHashtags('ARUN vs KUMAR smash rally #shorts #Shorts').hashtags).toEqual(['shorts']);
    expect(extractHashtags('Lakshya Sen || Red Bull || Power Smash #redbull  #lakshya').hashtags).toEqual(['redbull', 'lakshya']);
  });

  it('removes emoji but never digits (\\p{Emoji} would delete the year)', () => {
    expect(stripEmoji('🏸 ARUN vs KUMAR 🔥 || MS SF - Test Cup 2026')).toBe('ARUN vs KUMAR || MS SF - Test Cup 2026');
    expect(stripEmoji('Smash Level ⚡️ || 2026 #3')).toBe('Smash Level || 2026 #3');
    expect(stripEmoji('LIVE 🔴 Test District Championship 2026')).toBe('LIVE Test District Championship 2026');
  });

  it('preprocessTitle runs normalise, hashtag capture and emoji strip in the right order', () => {
    const pf043 = preprocessTitle('ARUN vs KUMAR || MS SF - Test Cup 2026 #badminton #பேட்மிண்டன் 🏸🔥');
    expect(pf043.text).toBe('ARUN vs KUMAR || MS SF - Test Cup 2026');
    expect(pf043.hashtags).toEqual(['badminton', 'பேட்மிண்டன்']);
    expect(pf043.normalizedTitle).toContain('🏸'); // the matching copy keeps emoji

    const pf044 = preprocessTitle('🏸 ARUN vs KUMAR 🔥 || MS SF - Test Cup 2026');
    expect(pf044.text).toBe('ARUN vs KUMAR || MS SF - Test Cup 2026');

    const pf012 = preprocessTitle('ARUN ｖｓ KUMAR ｜｜ MS SF - Test Cup 2026');
    expect(pf012.text).toBe('ARUN vs KUMAR || MS SF - Test Cup 2026');

    const pf066 = preprocessTitle('ARUN vs KUMAR || Men’s Singles Final - Test Cup 2026');
    expect(pf066.text).toBe("ARUN vs KUMAR || Men's Singles Final - Test Cup 2026");

    const pf075 = preprocessTitle('ARUN vs KUMAR || MS SF - Test Cup ௨௦௨௬');
    expect(pf075.text.endsWith('Test Cup 2026')).toBe(true);
  });
});
