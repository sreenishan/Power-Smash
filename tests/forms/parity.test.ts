// The client-side rules (src/lib/forms/rules.ts, no zod) must agree with the zod contract (src/lib/contracts/lead.ts) on every
// field of every form. If the Lead-backend worker changes a rule, this file fails until rules.ts is updated.
// The shared rules of the M1 review-fix wave are tested here on both sides at once: R-PHONE (pasted numbers with invisible
// marks), R-TEXT (rupee sign, dashes, curly quotes...), R-DATE (yesterday to 1,095 days ahead, India time, injectable clock),
// R-ELAPSED (elapsedMs is clamped, never a reason to refuse a form), and the "client checks what is sent" rule (B-13).
import { describe, expect, it } from 'vitest';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { buildPayload } from '../../src/lib/forms/payload';
import { START_DATE_MAX_DAYS_AHEAD, istToday } from '../../src/lib/contracts/lead-constants';
import { allFieldDefs, checkForm } from '../../src/lib/forms/validate';
import { NOW, META, forms, fullValues, pinClock } from './helpers';

pinClock();

const long = (n: number, ch = 'x') => ch.repeat(n);

// R-TEXT: what organisers paste from posters (and what must still be refused: pipe, semicolon, brackets, braces, backslash, backtick).
const R_TEXT = [
  '₹25,000', '₹ 500 per player', '20% advance', "Chennai Open – Men's Doubles", 'Cup — 2026', 'Cup “26”', 'Cup ‘26’', 'Cup 2026!', 'Open?', 'Cup · Day 1', 'Cup ’26',
  'A|B', 'A;B', 'A[1]', 'A{1}', 'A\B', 'A`B', 'A*B', 'A_B', '=₹5', '₹', '–', '“', 'Cup <b>', 'x–y', 'x—y',
];

const TEXT = [...R_TEXT, '', 'Sample Open', 'A', 'Ab', long(41), long(61), long(81), long(121), long(125), 'Open!!!', 'Open 2027', 'Open 12345', 'Open 1234567', 'a@b.com', 'www.site.in', 'see site.in', '=A1', '+X', '@x', 'Te<st', "O'Neil (B)", 'Rs 20,000 - 30,000', 'Rs 25000', '2026-27 U19', 'தமிழ் பெயர்', 'A\tB', 'Zero​Width'];
const MULTI = ['', 'Hello\nworld', long(801), long(1501), 'a\rb', 'tab\there', 'one\n\n\n\ntwo', 'http://a.org http://b.org http://c.org', '=SUM(A1) is fine in notes', 'Call 9876543210 now'];
const INT = ['', '0', '1', '4', '30', '31', '64', '65', '10000', '10001', 'abc', '12.5', '-3', '1000000', ' 7 '];
const LIST = ['', 'U13, U15', 'a,b,c,d,e,f,g,h,i,j,k,l', 'a,b,c,d,e,f,g,h,i,j,k,l,m', long(40), long(41), 'Bad!', 'U13,,U15', 'U13\nU15'];
const DATE = ['', '2027-02-10', '2027-02-11', '2027-13-40', '2027-02-30', 'tomorrow', '1999-12-31', '2101-01-01', '2027-2-10', '2000-01-01', '2100-12-31', '2025-12-31', '2026-02-29'];

const addDays = (iso: string, n: number): string => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)).toISOString().slice(0, 10);
/** R-DATE edges around "today in India" at the pinned clock: two days ago, yesterday, today, +1,095, +1,096. */
function DATE_EDGES(): string[] {
  const today = istToday(NOW);
  return [addDays(today, -2), addDays(today, -1), today, addDays(today, 1), addDays(today, START_DATE_MAX_DAYS_AHEAD - 1), addDays(today, START_DATE_MAX_DAYS_AHEAD), addDays(today, START_DATE_MAX_DAYS_AHEAD + 1)];
}
const URL = ['', 'https://sample-club.in/x', 'http://sample-club.in', 'https://localhost', 'https://a.b', 'ftp://sample-club.in', 'https://user:pw@sample-club.in', 'https://127.0.0.1/x', `https://sample-club.in/${long(300)}`, 'https://x.test/a', 'https://sample-club.in:8443/'];

// R-PHONE: a number copied from WhatsApp, Contacts or a web page: no-break and thin spaces, zero-width and bidi marks around or
// inside the digits, plus lookalikes that must STILL be refused (en dash, soft hyphen, letter O for zero).
const PHONE_PASTES = [
  '+91 98765 43210', '+91 98765 43210', '‪+91 98765 43210‬', '‎+91 98765 43210', '98765 43210', '98765 43210',
  '​9876543210', '9876​543210', '﻿9876543210', '⁦+91 98765 43210⁩', '98765‏43210', '‫98765 43210‮',
  '+91  98765 43210', ' 98765 43210 ', '98765–43210', '98765­43210', '9876O43210', '+91‎ 98765‎ 43210',
  '⁧+91 98765 43210⁩', '9​8​7​6​5​4​3​2​1​0',
];

const CANDIDATES: Record<string, string[]> = {
  name: TEXT,
  organization: TEXT,
  organizerName: TEXT,
  company: TEXT,
  eventName: TEXT,
  tournamentName: TEXT,
  venue: TEXT,
  district: TEXT,
  city: TEXT,
  level: TEXT,
  budgetRange: TEXT,
  entryFee: TEXT,
  notes: MULTI,
  objectives: MULTI,
  registrationDetails: MULTI,
  message: ['', 'Hi', 'Hello', 'Hello there', long(1500), long(1501), 'a\nb\nc'],
  phone: ['', '12345', '98765 43210', '+91 98765 43210', '098765 43210', '5555555555', 'abcdefghij', '+44 7700 900123', '9876543210123456', '௯௮௭௬௫ ௪௩௨௧௦', '98765-43210', ...PHONE_PASTES],
  email: ['', 'bad', 'a@b', 'a@b.co', 'x@@y.com', 'A.B@Example.COM', 'a b@c.com', 'a@b.c', 'a..b@c.com'],
  courts: INT,
  matchDays: INT,
  expectedEntries: INT,
  categories: LIST,
  ageGroups: LIST,
  startDate: [...DATE, ...DATE_EDGES()],
  endDate: [...DATE, ...DATE_EDGES()],
  startMonth: ['', '2027-03', '2027-13', '27-03', '2027-3', '1999-01', '2027-00'],
  companyUrl: URL,
  registrationLink: URL,
  posterUrl: URL,
  // Request form: a link or a description, and the details
  what: ['', 'https://example.org/players/sample-player/', 'Final of the sample open, second video', 'x'.repeat(300), 'x'.repeat(301), 'Call 9876543210', '=A1', 'a<b', 'tab	here', 'Zero​width', 'http://example.org/x', '₹ 5'],
  details: MULTI,
  // M3: send your video
  videoUrl: URL,
  matchDate: DATE,
  category: TEXT,
  round: TEXT,
  players: TEXT,
};

function contractCode(kind: string, values: Record<string, unknown>, field: string, now: Date = NOW): string | null {
  const form = forms[kind]!;
  const result = validateLeadRequest(buildPayload(form, values as never, META), { now });
  if (result.ok) return null;
  return result.fieldErrors[field] ?? null;
}

describe('client rules agree with the zod contract, field by field', () => {
  for (const [kind, form] of Object.entries(forms)) {
    const fields = allFieldDefs(form).filter((f) => CANDIDATES[f.name]);
    it(`${kind}: every checked field has candidates (no field silently unchecked)`, () => {
      const unchecked = allFieldDefs(form)
        .filter((f) => !['checkbox', 'checks', 'select', 'radio'].includes(f.type))
        .map((f) => f.name)
        .filter((n) => !CANDIDATES[n]);
      expect(unchecked).toEqual([]);
    });

    for (const field of fields) {
      it(`${kind}.${field.name}`, () => {
        const mismatches: string[] = [];
        for (const candidate of CANDIDATES[field.name]!) {
          const values = { ...fullValues[kind]!, [field.name]: candidate };
          const client = checkForm(form, values, NOW)[field.name] ?? null;
          const server = contractCode(kind, values, field.name);
          const blank = candidate.trim() === '';
          // Where the FORM is stricter than the contract on purpose (requiredByForm, e.g. coverage startDate).
          if (blank && field.requiredByForm) {
            expect(client).toBe('required');
            continue;
          }
          // The contract reports end-before-start only when everything else passes; the client shows it early. Skip that pair.
          if (field.name === 'endDate' && candidate !== '' && candidate < String(fullValues[kind]!.startDate ?? '')) continue;
          if (client !== server) mismatches.push(`${JSON.stringify(candidate.length > 40 ? `${candidate.slice(0, 20)}...(${candidate.length})` : candidate)}: client=${client} server=${server}`);
        }
        expect(mismatches).toEqual([]);
      });
    }
  }

  it('select and radio values: every option the forms offer is accepted by the contract', () => {
    for (const [kind, form] of Object.entries(forms)) {
      for (const field of allFieldDefs(form)) {
        if (!['select', 'radio'].includes(field.type)) continue;
        for (const option of field.options ?? []) {
          const values = { ...fullValues[kind]!, [field.name]: option.value };
          expect(contractCode(kind, values, field.name), `${kind}.${field.name}=${option.value}`).toBeNull();
          expect(checkForm(form, values, NOW)[field.name] ?? null, `${kind}.${field.name}=${option.value}`).toBeNull();
        }
      }
    }
  });

  it('the contact form: phone or email, in both implementations', () => {
    const base = { ...fullValues.general!, phone: '', email: '' };
    expect(checkForm(forms.general!, base).phone).toBe('contact_required');
    expect(contractCode('general', base, 'phone')).toBe('contact_required');
    expect(checkForm(forms.general!, { ...base, email: 'a@example.com' }).phone).toBeUndefined();
    expect(contractCode('general', { ...base, email: 'a@example.com' }, 'phone')).toBeNull();
  });

  it('M3: every required consent box: unticked is consent_required on both sides, ticked is fine, for each of the two new kinds', () => {
    for (const kind of ['video_submission', 'alerts_signup']) {
      const form = forms[kind]!;
      const boxes = allFieldDefs(form).filter((f) => f.requiredTick);
      expect(boxes.length, kind).toBeGreaterThan(0);
      for (const box of boxes) {
        const off = { ...fullValues[kind]!, [box.name]: false };
        expect(checkForm(form, off, NOW)[box.name], `${kind}.${box.name} client`).toBe('consent_required');
        const result = validateLeadRequest(buildPayload(form, off as never, META), { now: NOW });
        expect(result.ok, `${kind}.${box.name} server`).toBe(false);
        if (!result.ok) expect(result.fieldErrors[`${box.name}.given`], `${kind}.${box.name} server code`).toBe('consent_required');
        expect(checkForm(form, fullValues[kind]!, NOW)[box.name] ?? null).toBeNull();
      }
      expect(validateLeadRequest(buildPayload(form, fullValues[kind]! as never, META), { now: NOW }).ok, kind).toBe(true);
    }
  });

  it('M3: the new radio fields must be chosen (client and server agree), and the video link must be https', () => {
    const v = { ...fullValues.video_submission!, role: '', footageSource: '', minorsVisible: '' };
    const client = checkForm(forms.video_submission!, v, NOW);
    expect(client.role).toBe('required');
    expect(client.footageSource).toBe('required');
    expect(client.minorsVisible).toBe('required');
    const server = validateLeadRequest(buildPayload(forms.video_submission!, v as never, META), { now: NOW });
    expect(server.ok).toBe(false);
    if (!server.ok) expect(Object.keys(server.fieldErrors).sort()).toEqual(['footageSource', 'minorsVisible', 'role']);
  });

  it('end date before the start date is an error in both implementations', () => {
    const values = { ...fullValues.coverage!, startDate: '2027-02-10', endDate: '2027-02-09' };
    expect(checkForm(forms.coverage!, values).endDate).toBe('invalid_date');
    expect(contractCode('coverage', values, 'endDate')).toBe('invalid_date');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// R-DATE at the edges, and the midnight in India
// ---------------------------------------------------------------------------------------------------------------

describe('R-DATE: client and server agree on the start-date window, at the edges and across midnight India time', () => {
  const instants = [
    '2026-10-21T00:00:00Z', // 05:30 IST on the 21st
    '2026-10-21T18:29:59.999Z', // 23:59:59.999 IST on the 21st: still the 21st
    '2026-10-21T18:30:00.000Z', // 00:00:00 IST on the 22nd: the 22nd
    '2026-12-31T18:29:59.999Z',
    '2026-12-31T18:30:00.000Z', // New Year in India
    '2028-02-28T18:30:00.000Z', // leap day ahead
  ];

  for (const instant of instants) {
    it(`at ${instant} every date from three days before to three days after each edge gets the same answer`, () => {
      const now = new Date(instant);
      const today = istToday(now);
      const probes: string[] = [];
      for (let d = -3; d <= 3; d += 1) {
        probes.push(addDays(today, d)); // around "yesterday"
        probes.push(addDays(today, START_DATE_MAX_DAYS_AHEAD + d)); // around the last allowed day
      }
      const mismatches: string[] = [];
      for (const kind of ['coverage', 'tournament_submission'] as const) {
        for (const date of probes) {
          const values = { ...fullValues[kind]!, startDate: date, endDate: '' };
          const client = checkForm(forms[kind]!, values, now).startDate ?? null;
          const server = contractCode(kind, values, 'startDate', now);
          if (client !== server) mismatches.push(`${kind} ${date}: client=${client} server=${server}`);
          // and the edges themselves are what the rule says
          const expectedOk = date >= addDays(today, -1) && date <= addDays(today, START_DATE_MAX_DAYS_AHEAD);
          expect(client === null, `${kind} ${date} at ${instant}`).toBe(expectedOk);
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it('the last day (endDate) is NOT window-checked by either side, only as a real date, and must not be before the start', () => {
    for (const kind of ['coverage', 'tournament_submission'] as const) {
      for (const endDate of ['2031-01-01', '2100-12-31', '2027-03-01']) {
        const values = { ...fullValues[kind]!, startDate: '2027-02-10', endDate };
        expect(checkForm(forms[kind]!, values, NOW).endDate ?? null, `${kind} ${endDate}`).toBe(contractCode(kind, values, 'endDate'));
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A deterministic fuzz corpus: tricky characters at the start, inside and at the end of realistic values, plus random strings
// ---------------------------------------------------------------------------------------------------------------

/** Small seeded generator so the corpus is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRICKY = [
  '﻿', ' ', ' ', '\n', '\r', '\r\n', '\t', ' ', ' ', ' ', ' ', '​', '‌', '‍', '‎', '‏',
  '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '\u0000', '\u0007', '\u007F', '\u0085', '\u009F', '­', '⁠',
  ' ', '  ', '\uD800', '\uDC00', '😀', '́',
];
const ALPHABET = [
  ...'abcXYZ019 .,\'()-&/#+:', '₹', '–', '—', '‘', '’', '“', '”', '%', '!', '?', '·', '|', ';', '[', ']', '{', '}', '\\', '`', '=', '@', '<', '>', '*', '_', '$', '"', '~', '^',
  'த', 'மி', 'ழ்', '௧', '٣', '９', ' ', ' ', '‎',
];

const BASES: Record<string, string[]> = {
  text: ['Sample Open', 'Open 2027', "Men's Doubles", 'Cup ’26', 'தமிழ் பெயர்', 'Rs 25,000', '₹25,000', 'Day 1 – Finals'],
  multi: ['Hello world', 'Line one\nLine two', 'Call us after 6 pm.', 'We need two cameras.'],
  phone: ['9876543210', '+91 98765 43210', '098765-43210', '+44 7700 900123'],
  email: ['test.person@example.com', 'a@b.co', 'A.B@Example.COM'],
  url: ['https://sample-club.in/x', 'https://sample-club.in/'],
  date: ['2027-02-10', '2026-10-20', '2029-10-20'],
  int: ['4', '12', '30'],
  list: ['U13, U15', 'Open doubles', 'a,b,c'],
};

function corpusFor(kind: keyof typeof BASES, randomCount = 150): string[] {
  const out = new Set<string>();
  const rand = mulberry32(kind.length * 7919 + 17);
  for (const base of BASES[kind]!) {
    out.add(base);
    for (const t of TRICKY) {
      out.add(`${t}${base}`);
      out.add(`${base}${t}`);
      out.add(`${base.slice(0, Math.ceil(base.length / 2))}${t}${base.slice(Math.ceil(base.length / 2))}`);
    }
  }
  for (let i = 0; i < randomCount; i += 1) {
    const length = 1 + Math.floor(rand() * 18);
    let s = '';
    for (let j = 0; j < length; j += 1) s += rand() < 0.12 ? TRICKY[Math.floor(rand() * TRICKY.length)]! : ALPHABET[Math.floor(rand() * ALPHABET.length)]!;
    out.add(s);
  }
  return [...out];
}

const FUZZ_KIND_BY_FIELD: Record<string, keyof typeof BASES> = {
  name: 'text', organization: 'text', organizerName: 'text', company: 'text', eventName: 'text', tournamentName: 'text', venue: 'text',
  district: 'text', city: 'text', level: 'text', budgetRange: 'text', entryFee: 'text',
  notes: 'multi', objectives: 'multi', registrationDetails: 'multi', message: 'multi', details: 'multi', what: 'text',
  phone: 'phone', email: 'email', companyUrl: 'url', registrationLink: 'url', posterUrl: 'url',
  videoUrl: 'url', matchDate: 'date', category: 'text', round: 'text', players: 'text',
  startDate: 'date', endDate: 'date', courts: 'int', matchDays: 'int', expectedEntries: 'int', categories: 'list', ageGroups: 'list',
};

describe('fuzz corpus: client and server agree on every text, phone, email, link, date, number and list box', () => {
  const seen = new Set<string>();
  for (const [kind, form] of Object.entries(forms)) {
    for (const field of allFieldDefs(form)) {
      const fuzzKind = FUZZ_KIND_BY_FIELD[field.name];
      if (!fuzzKind || seen.has(field.name)) continue;
      seen.add(field.name); // each field NAME once (the rule is per name), on the first form that has it
      it(`${kind}.${field.name} (${fuzzKind})`, () => {
        const corpus = corpusFor(fuzzKind);
        const mismatches: string[] = [];
        for (const candidate of corpus) {
          const values = { ...fullValues[kind]!, [field.name]: candidate };
          const client = checkForm(form, values, NOW)[field.name] ?? null;
          const server = contractCode(kind, values, field.name);
          const blank = candidate.trim() === '';
          if (blank && field.requiredByForm) continue;
          if (field.name === 'endDate' && candidate.trim() !== '' && candidate.trim() < String(fullValues[kind]!.startDate ?? '')) continue;
          if (client !== server) mismatches.push(`${JSON.stringify(candidate.length > 30 ? `${candidate.slice(0, 20)}...(${candidate.length})` : candidate)}: client=${client} server=${server}`);
        }
        expect(mismatches.slice(0, 15), `${mismatches.length} of ${corpus.length} differ`).toEqual([]);
      });
    }
  }

  it('the corpus is large enough to mean something (several thousand checks), and the fields are all covered', () => {
    const total = Object.keys(FUZZ_KIND_BY_FIELD).reduce((n, name) => n + corpusFor(FUZZ_KIND_BY_FIELD[name]!).length, 0);
    expect(total).toBeGreaterThan(5000);
    for (const form of Object.values(forms)) {
      for (const field of allFieldDefs(form)) {
        if (['checkbox', 'checks', 'select', 'radio', 'month'].includes(field.type)) continue;
        expect(FUZZ_KIND_BY_FIELD[field.name], `field ${field.name} has no fuzz kind`).toBeDefined();
      }
    }
  });
});

describe('R-PHONE and R-TEXT, spelled out (what the review asked for, on both sides)', () => {
  const phoneOk = ['+91 98765 43210', '+91 98765 43210', '‪+91 98765 43210‬', '‎+91 98765 43210', '98765 43210', '​9876543210', '﻿9876543210'];
  const phoneBad = ['98765–43210', '98765­43210', '9876O43210', '12345'];
  const textOk = ['₹25,000', '₹ 500 per player', '20% advance', "Chennai Open – Men's Doubles", 'Cup — 2026', 'Cup “26”', 'Cup 2026!', 'Open?', 'Cup · Day 1'];
  const textBad = ['A|B', 'A[1]', 'A{1}', 'A\\B', 'A`B', '=₹5', 'Cup <b>', 'A\nB', 'A\tB'];

  it('a number pasted from WhatsApp or Contacts is accepted by both', () => {
    for (const phone of phoneOk) {
      const values = { ...fullValues.coverage!, phone };
      expect(checkForm(forms.coverage!, values, NOW).phone ?? null, JSON.stringify(phone)).toBeNull();
      expect(contractCode('coverage', values, 'phone'), JSON.stringify(phone)).toBeNull();
    }
  });

  it('look-alikes that are not allowed are refused by both', () => {
    for (const phone of phoneBad) {
      const values = { ...fullValues.coverage!, phone };
      expect(checkForm(forms.coverage!, values, NOW).phone, JSON.stringify(phone)).toBe('invalid_phone');
      expect(contractCode('coverage', values, 'phone'), JSON.stringify(phone)).toBe('invalid_phone');
    }
  });

  it('the new characters are accepted in the label-style boxes by both, and the unsafe ones stay refused by both', () => {
    for (const eventName of textOk) {
      const values = { ...fullValues.coverage!, eventName };
      expect(checkForm(forms.coverage!, values, NOW).eventName ?? null, eventName).toBeNull();
      expect(contractCode('coverage', values, 'eventName'), eventName).toBeNull();
    }
    for (const eventName of textBad) {
      const values = { ...fullValues.coverage!, eventName };
      const client = checkForm(forms.coverage!, values, NOW).eventName ?? null;
      expect(client, eventName).not.toBeNull();
      expect(contractCode('coverage', values, 'eventName'), eventName).toBe(client);
    }
  });
});

describe('R-ELAPSED: the server clamps the timer, the client clamps before sending; neither ever refuses a form because of it', () => {
  it('a body with a huge, negative or odd elapsedMs is still accepted by the server (after its own clamp)', () => {
    const base = buildPayload(forms.general!, fullValues.general!, META);
    for (const elapsedMs of [90_000_000, -5, 1e15, 12.5, '5000', null]) {
      const result = validateLeadRequest({ ...base, elapsedMs }, { now: NOW });
      expect(result.ok, String(elapsedMs)).toBe(true);
    }
  });

  it('what the client sends is already inside the server limit', () => {
    for (const elapsedMs of [0, 1500, 86_400_000, 90_000_000, 1e15]) {
      const payload = buildPayload(forms.general!, fullValues.general!, { ...META, elapsedMs });
      const result = validateLeadRequest(payload, { now: NOW });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.elapsedMs).toBe(payload.elapsedMs);
    }
  });
});
