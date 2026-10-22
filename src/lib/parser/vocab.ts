/**
 * Reviewed-by-data vocabulary of the title parser (M2b). Tables only, no logic besides small
 * lookups, so a reviewer can read every word the parser knows.
 *
 * Nothing here is Tamil vocabulary for "versus" or rounds: that list needs a native speaker
 * (PC-24, OT-32, PARSER_OPEN_ITEMS PO-05) and is deliberately absent.
 */
import type { Category, Round } from './types';

/** Digits of other scripts (Arabic-Indic, Extended Arabic-Indic, Devanagari, Bengali, Tamil) to ASCII. */
export function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹०-९০-৯௦-௯]/gu, (d) => {
    const cp = d.codePointAt(0) as number;
    const base = [0x660, 0x6f0, 0x966, 0x9e6, 0xbe6].find((b) => cp >= b && cp <= b + 9) as number;
    return String(cp - base);
  });
}

/** Letters and digits only, lower-case: the comparison key of one title word. */
export function wordKey(word: string): string {
  return asciiDigits(word.normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

// ---------------------------------------------------------------------------
// Categories (A.2). Keys are concatenated word keys: "Men's Singles" -> 'menssingles'.
// ---------------------------------------------------------------------------

const GENDER_WORDS: Record<string, 'M' | 'W' | 'X' | 'B' | 'G'> = {
  men: 'M',
  mens: 'M',
  gents: 'M',
  gentsmens: 'M',
  women: 'W',
  womens: 'W',
  ladies: 'W',
  lady: 'W',
  mixed: 'X',
  mix: 'X',
  boys: 'B',
  boy: 'B',
  girls: 'G',
  girl: 'G',
};

export const CATEGORY_PHRASES: Record<string, Category> = {};
for (const [gender, letter] of Object.entries(GENDER_WORDS)) {
  for (const word of ['single', 'singles']) {
    CATEGORY_PHRASES[`${gender}${word}`] = `${letter}S` as Category;
  }
  for (const word of ['double', 'doubles']) {
    CATEGORY_PHRASES[`${gender}${word}`] = `${letter}D` as Category;
  }
}
/** Mixed has no singles. */
delete CATEGORY_PHRASES.mixedsingle;
delete CATEGORY_PHRASES.mixedsingles;
delete CATEGORY_PHRASES.mixsingle;
delete CATEGORY_PHRASES.mixsingles;

/** Two-letter codes: accepted only as bare letters (no dots), so 'M.S. Memorial' stays a name (PC-04). */
export const CATEGORY_CODES: Record<string, Category> = {
  ms: 'MS',
  ws: 'WS',
  md: 'MD',
  wd: 'WD',
  xd: 'XD',
  mxd: 'XD',
  bs: 'BS',
  gs: 'GS',
  bd: 'BD',
  gd: 'GD',
};

export const DOUBLES_CATEGORIES: readonly Category[] = ['MD', 'WD', 'XD', 'BD', 'GD'];
export const SINGLES_CATEGORIES: readonly Category[] = ['MS', 'WS', 'BS', 'GS'];

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

/** value, ambiguous. Ambiguous words count only in a pure token segment or next to a category (PC-04). */
export const ROUND_WORDS: Record<string, { round: Round; ambiguous: boolean }> = {
  final: { round: 'F', ambiguous: true },
  finals: { round: 'F', ambiguous: true },
  f: { round: 'F', ambiguous: true },
  grandfinal: { round: 'F', ambiguous: false },
  grandfinals: { round: 'F', ambiguous: false },
  grandfinale: { round: 'F', ambiguous: false },
  semifinal: { round: 'SF', ambiguous: false },
  semifinals: { round: 'SF', ambiguous: false },
  semis: { round: 'SF', ambiguous: false },
  semi: { round: 'SF', ambiguous: true },
  sf: { round: 'SF', ambiguous: false },
  quarterfinal: { round: 'QF', ambiguous: false },
  quarterfinals: { round: 'QF', ambiguous: false },
  quaterfinal: { round: 'QF', ambiguous: false },
  quaterfinals: { round: 'QF', ambiguous: false },
  quarters: { round: 'QF', ambiguous: false },
  qf: { round: 'QF', ambiguous: false },
  prequarter: { round: 'R16', ambiguous: false },
  prequarters: { round: 'R16', ambiguous: false },
  prequarterfinal: { round: 'R16', ambiguous: false },
  prequarterfinals: { round: 'R16', ambiguous: false },
  prequater: { round: 'R16', ambiguous: false },
  prequaterfinal: { round: 'R16', ambiguous: false },
  prequaterfinals: { round: 'R16', ambiguous: false },
  pqf: { round: 'R16', ambiguous: false },
  r16: { round: 'R16', ambiguous: false },
  roundof16: { round: 'R16', ambiguous: false },
  r32: { round: 'R32', ambiguous: false },
  roundof32: { round: 'R32', ambiguous: false },
  r64: { round: 'R64', ambiguous: false },
  r128: { round: 'R128', ambiguous: false },
  league: { round: 'league', ambiguous: true },
  leaguematch: { round: 'league', ambiguous: false },
  group: { round: 'group', ambiguous: true },
  groupstage: { round: 'group', ambiguous: false },
  groupmatch: { round: 'group', ambiguous: false },
  '3rdplace': { round: '3P', ambiguous: false },
  thirdplace: { round: '3P', ambiguous: false },
  '3rdplacematch': { round: '3P', ambiguous: false },
  bronze: { round: '3P', ambiguous: true },
  bronzemedal: { round: '3P', ambiguous: false },
};

// ---------------------------------------------------------------------------
// Age groups (PC-13, D-012). U21 is a group but never a minor signal.
// ---------------------------------------------------------------------------

export const AGE_WORDS: Record<string, { group: string; ambiguous: boolean; signal: boolean; allowAnywhere: boolean }> = {
  subjunior: { group: 'sub_junior', ambiguous: false, signal: true, allowAnywhere: true },
  subjuniors: { group: 'sub_junior', ambiguous: false, signal: true, allowAnywhere: true },
  junior: { group: 'junior', ambiguous: false, signal: true, allowAnywhere: true },
  juniors: { group: 'junior', ambiguous: false, signal: true, allowAnywhere: true },
  youth: { group: 'youth', ambiguous: false, signal: true, allowAnywhere: true },
  cadet: { group: 'cadet', ambiguous: false, signal: true, allowAnywhere: true },
  cadets: { group: 'cadet', ambiguous: false, signal: true, allowAnywhere: true },
  mini: { group: 'mini', ambiguous: true, signal: true, allowAnywhere: false },
  minis: { group: 'mini', ambiguous: true, signal: true, allowAnywhere: false },
  senior: { group: 'senior', ambiguous: true, signal: false, allowAnywhere: false },
  seniors: { group: 'senior', ambiguous: true, signal: false, allowAnywhere: false },
  open: { group: 'open', ambiguous: true, signal: false, allowAnywhere: false },
  veteran: { group: 'veterans', ambiguous: true, signal: false, allowAnywhere: false },
  veterans: { group: 'veterans', ambiguous: true, signal: false, allowAnywhere: false },
  master: { group: 'masters', ambiguous: true, signal: false, allowAnywhere: false },
  masters: { group: 'masters', ambiguous: true, signal: false, allowAnywhere: false },
};

/** Number words for 'Under Fifteen' (4..19). */
export const NUMBER_WORDS: Record<string, number> = {
  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

/**
 * Words that look like an age marker but are not in the vocabulary (UNKNOWN_AGE_TOKEN, fail closed).
 * Tamil words are listed only to fail closed: their meaning needs a native reviewer (OT-32).
 */
export const UNKNOWN_AGE_LIKE =
  /^(?:u\d+[a-z]+|kids?|children|child|tiny|tots?|toddlers?|minor|minors|under|below|sub|jr|jrs|school|schools|schoolboys?|schoolgirls?|teens?|teenagers?|teenage|students?|பள்ளி|ஜூனியர்|ஜுனியர்|சப்ஜூனியர்|சிறுவர்|சிறுவர்கள்|சிறுமியர்|சிறுமிகள்|மாணவர்|மாணவர்கள்|மாணவியர்|இளையோர்|கேடட்)$/u;

/** Trailing words that are about the video, never part of a name (B2-3). */
export const NOISE_WORDS = new Set([
  'live', 'replay', 'today', 'match', 'telecast', 'hd', 'fullmatch', 'full', 'video', 'stream', 'streaming', 'rally', 'rallies',
]);

/** Neutral words that are part of a category-style segment but carry no information on their own. */
export const NEUTRAL_WORDS = new Set([
  'men',
  'mens',
  'women',
  'womens',
  'boys',
  'girls',
  'mixed',
  'team',
  'teams',
  'event',
  'teamevent',
  'live',
  'livescore',
  'fullmatch',
  'fullvideo',
  'fullgame',
  'finalsday',
  'decidingset',
  'powersmash',
  'badmintonpowersmash',
]);

// ---------------------------------------------------------------------------
// Non-match gates (PC-16)
// ---------------------------------------------------------------------------

export const NON_MATCH_KEYWORDS =
  /(?<![\p{L}\p{N}])(?:highlights?|compilations?|montage|top\s*\d+|best\s+(?:of|rallies|shots|points|smashes)|reactions?|trailer|teaser|promo|interview|vlog|tutorial|unboxing|review)(?![\p{L}\p{N}])/iu;

export const GEAR_BRANDS =
  /(?<![\p{L}\p{N}])(?:yonex|li[\s-]?ning|victor|carlton|apacs|babolat|astrox|nanoflare|arcsaber|axforce|thruster|badminton\s+racket|racquet\s+review|kawasaki|hundred|cosco|ashaway)(?![\p{L}\p{N}])/iu;

/** Known international events. A hit makes the title international even without country codes (PC-17). */
export const INTERNATIONAL_EVENTS =
  /(?<![\p{L}\p{N}])(?:world\s+championships?|world\s+tour|world\s+junior|olympics?|thomas\s+cup|uber\s+cup|sudirman\s+cup|all\s+england|asian\s+games|asia\s+championships?|commonwealth\s+games|bwf|super\s+(?:1000|750|500|300)|singapore\s+open|malaysia\s+open|malaysia\s+masters|indonesia\s+open|indonesia\s+masters|japan\s+open|china\s+open|korea\s+open|denmark\s+open|french\s+open|german\s+open|swiss\s+open|thailand\s+open|hong\s+kong\s+open|macau\s+open|australian\s+open|arctic\s+open)(?![\p{L}\p{N}])/iu;

// ---------------------------------------------------------------------------
// Team-tie detection (PC-16)
// ---------------------------------------------------------------------------

export const INDIAN_STATES = new Set([
  'andhra pradesh',
  'arunachal pradesh',
  'assam',
  'bihar',
  'chhattisgarh',
  'goa',
  'gujarat',
  'haryana',
  'himachal pradesh',
  'jharkhand',
  'karnataka',
  'kerala',
  'madhya pradesh',
  'maharashtra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha',
  'odissa',
  'punjab',
  'rajasthan',
  'sikkim',
  'tamil nadu',
  'tamilnadu',
  'telangana',
  'tripura',
  'uttar pradesh',
  'uttarakhand',
  'west bengal',
  'delhi',
  'puducherry',
  'pondicherry',
  'jammu and kashmir',
  'chandigarh',
  'railways',
  'services',
  'petroleum',
]);

export const TEAM_WORDS = new Set([
  'kings',
  'falcons',
  'warriors',
  'shuttlers',
  'strikers',
  'smashers',
  'titans',
  'tigers',
  'lions',
  'eagles',
  'royals',
  'riders',
  'blasters',
  'club',
  'team',
  'xi',
  'united',
  'smashers',
  'rangers',
  'panthers',
  'challengers',
]);

// ---------------------------------------------------------------------------
// Countries (PC-17): IOC/BWF codes. SRI is left out on purpose: it collides with the name word.
// CBE, MDU and other city abbreviations are NOT countries.
// ---------------------------------------------------------------------------

export const COUNTRY_CODES = new Set(
  (
    'IND INA MAS SIN JPN CHN DEN THA KOR TPE HKG VIE PHI ENG SCO WAL FRA GER NED ESP ITA SUI SWE RUS UKR USA CAN AUS NZL BRA ' +
    'PAK NEP BAN IRL POL CZE BEL AUT FIN NOR ISR EGY RSA UGA NGR MRI UAE KSA MAC MYA BRN MGL KAZ UZB IRI TUR POR CRO BUL EST ' +
    'LAT LTU HUN SVK SLO SRB GRE MEX PER CHI ARG COL CUB GUA JAM MDV BHU AFG IRQ JOR LBN QAT KUW OMA CAM LAO TLS FIJ PNG ' +
    'ALG GHA KEN ZAM TAN ZIM ISL LUX MLT AZE GEO ARM BLR MDA ROU CYP'
  ).split(' '),
);

// ---------------------------------------------------------------------------
// Places (PC-28): the 38 Tamil Nadu districts with informal spellings, plus a few cities that
// appear in titles. CBE and MDU are NOT aliases (PARSER_OPEN_ITEMS PO-13 keeps them as hints).
// ---------------------------------------------------------------------------

const PLACE_TABLE: Record<string, string[]> = {
  Ariyalur: [],
  Chengalpattu: ['chengalpet'],
  Chennai: ['madras'],
  Coimbatore: ['kovai'],
  Cuddalore: ['kadalur'],
  Dharmapuri: [],
  Dindigul: [],
  Erode: [],
  Kallakurichi: [],
  Kancheepuram: ['kanchipuram', 'kanchi'],
  Kanyakumari: ['kanniyakumari', 'nagercoil'],
  Karur: [],
  Krishnagiri: [],
  Madurai: [],
  Mayiladuthurai: [],
  Nagapattinam: ['nagapatnam'],
  Namakkal: [],
  Nilgiris: ['the nilgiris', 'ooty', 'udhagamandalam'],
  Perambalur: [],
  Pudukkottai: ['pudukottai'],
  Ramanathapuram: ['ramnad'],
  Ranipet: [],
  Salem: [],
  Sivaganga: ['sivagangai'],
  Tenkasi: [],
  Thanjavur: ['tanjore'],
  Theni: [],
  Thoothukudi: ['tuticorin'],
  Tiruchirappalli: ['trichy', 'tiruchi', 'trichinopoly', 'tiruchirapalli'],
  Tirunelveli: ['nellai', 'tinnevelly'],
  Tirupathur: ['tirupattur'],
  Tiruppur: ['tirupur'],
  Tiruvallur: ['thiruvallur'],
  Tiruvannamalai: ['thiruvannamalai'],
  Tiruvarur: ['thiruvarur'],
  Vellore: [],
  Villupuram: ['vilupuram', 'viluppuram', 'villuppuram'],
  Virudhunagar: ['virudunagar'],
};

/** Cities outside Tamil Nadu that show up as locations (not districts of the table). */
const OTHER_PLACES: Record<string, string[]> = {
  Bengaluru: ['bangalore'],
  Hyderabad: [],
  Puducherry: ['pondicherry'],
  Kochi: ['cochin'],
  Visakhapatnam: ['vishakapatnam', 'vizag', 'visakhapatnam'],
  Mumbai: ['bombay'],
  Delhi: ['new delhi'],
  Pune: [],
  Kolkata: ['calcutta'],
  Guwahati: [],
};

export const DISTRICT_NAMES = new Set(Object.keys(PLACE_TABLE));

const PLACE_ALIASES = new Map<string, string>();
for (const table of [PLACE_TABLE, OTHER_PLACES]) {
  for (const [canonical, aliases] of Object.entries(table)) {
    PLACE_ALIASES.set(canonical.toLowerCase(), canonical);
    for (const alias of aliases) PLACE_ALIASES.set(alias.toLowerCase(), canonical);
  }
}

/** Canonical place for an informal spelling, or null. Whole-string, case-insensitive. */
export function canonicalPlace(text: string): string | null {
  const key = text.trim().toLowerCase().replace(/\s+/gu, ' ');
  return PLACE_ALIASES.get(key) ?? null;
}

/** True when the whole text is a state, a district or a known city (a team side, PC-16). */
export function isPlaceOrState(text: string): boolean {
  const key = text.trim().toLowerCase().replace(/\s+/gu, ' ');
  return INDIAN_STATES.has(key) || PLACE_ALIASES.has(key);
}

// ---------------------------------------------------------------------------
// Series key fillers (PC-11)
// ---------------------------------------------------------------------------

export const SERIES_FILLERS = new Set([
  'badminton',
  'tournament',
  'tournaments',
  'championship',
  'championships',
  'tourney',
  'the',
  'of',
  'and',
  'in',
  'at',
]);

/** Words that normally belong to a tournament name: used to find where a player name ends (no separator). */
export const TOURNAMENT_NOUNS = new Set([
  'tournament',
  'tournaments',
  'championship',
  'championships',
  'cup',
  'trophy',
  'league',
  'open',
  'nationals',
  'national',
  'ranking',
  'meet',
  'series',
  'classic',
  'invitational',
  'badminton',
  'district',
  'state',
  'academy',
  'games',
  'zonal',
  'level',
]);
