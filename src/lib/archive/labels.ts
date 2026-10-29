// Display labels for the parsed fields (spec 7.2/7.3). The database stores codes (MS, SF, U15, open); pages show words.
// Everything shown from these is labelled "by Power Smash" on the page (D-016). Unknown codes are shown as they are, never invented.

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  MS: "Men's singles",
  WS: "Women's singles",
  MD: "Men's doubles",
  WD: "Women's doubles",
  XD: 'Mixed doubles',
  BS: "Boys' singles",
  GS: "Girls' singles",
  BD: "Boys' doubles",
  GD: "Girls' doubles",
};

export const ROUND_LABELS: Readonly<Record<string, string>> = {
  R128: 'Round of 128',
  R64: 'Round of 64',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarter-final',
  SF: 'Semi-final',
  F: 'Final',
  '3P': 'Third place',
  league: 'League',
  group: 'Group stage',
};

/** Rounds from the last to the first (Final first): the order of the round filter and of a tournament page's round groups. */
export const ROUND_ORDER: readonly string[] = ['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league'];

/** Sort key for a round code: known rounds in ROUND_ORDER, then unknown codes, then no round. */
export function roundRank(code: string | null | undefined): number {
  if (!code) return 100;
  const i = ROUND_ORDER.indexOf(code);
  return i < 0 ? 99 : i;
}

/** Sort key for a category code: the order of CATEGORY_LABELS, then unknown codes, then no category. */
export function categoryRank(code: string | null | undefined): number {
  if (!code) return 100;
  const i = Object.keys(CATEGORY_LABELS).indexOf(code);
  return i < 0 ? 99 : i;
}

const AGE_WORDS: Readonly<Record<string, string>> = { open: 'Open', senior: 'Senior', veterans: 'Veterans', masters: 'Masters' };

export function categoryLabel(code: string | null | undefined): string | null {
  return code ? (CATEGORY_LABELS[code] ?? code) : null;
}

export function roundLabel(code: string | null | undefined): string | null {
  return code ? (ROUND_LABELS[code] ?? code) : null;
}

/**
 * The two labels a match CARD shows, so the same words are never printed twice. `chip` goes on the card's header strip (the
 * category, or the round when the match has no category); `meta` is the small line under the title and holds only what the chip
 * does not (the round, when the chip is the category). Shared by MatchCard.astro and matches-client.ts, which must stay in step.
 */
export function cardLabels(
  category: string | null | undefined,
  round: string | null | undefined,
): { chip: string | null; meta: string | null } {
  const cat = categoryLabel(category);
  const rnd = roundLabel(round);
  return cat ? { chip: cat, meta: rnd } : { chip: rnd, meta: null };
}

export function ageGroupLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return AGE_WORDS[code] ?? code.replace(/_/g, ' ');
}

/** ISO 8601 duration for VideoObject (PT1H2M3S). Null for a missing or non-positive length. */
export function isoDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}
