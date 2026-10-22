// CSV writer shared by every export (partner report, inbox leads, subscribers later). PURE.
//
// Formula injection (OWASP "CSV injection", spec 18, BUILD_PLAN M3 tests): a text cell that a spreadsheet could read as a formula
// is defused by a leading apostrophe. A cell is dangerous when its first non-blank character (after removing leading spaces,
// tabs, newlines and other invisible characters) is `=`, `+`, `-`, `@`, or when it starts with a tab or a carriage return. Numbers are
// typed `number` cells and are written as plain digits, so a legitimate negative amount stays a number and is never prefixed.
//
// Indian-locale safety: numbers never carry digit grouping or a decimal comma (`1,00,000` would split into columns and read as
// text in a lakh-grouped locale); they are written with `.` as the decimal point and no separators. Money is converted from integer
// paise by integer arithmetic (`paiseToDecimal`), never through a float.
//
// Output: RFC 4180 style (comma, double-quote escaping, CRLF), optionally with a UTF-8 BOM so Excel opens Tamil and other non-ASCII
// text correctly.

export type CsvCell = string | number | null | undefined;

/** Leading characters a spreadsheet may skip or that hide what follows: whitespace, controls, format (zero-width, bidi) and separators. */
const LEADING_HIDDEN = /^[\p{White_Space}\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]+/u;
/** After NFKC (which folds full-width and small-form lookalikes) a formula starts with one of these; U+2212 is the minus sign lookalike. */
const FORMULA_START = /^[=+\-@\u2212]/;
const LEADING_CONTROL_OR_FORMAT = /^[\p{Cc}\p{Cf}]/u;

/**
 * Defuse one TEXT cell: returns it with a leading apostrophe when a spreadsheet could run it as a formula. Dangerous when, after
 * Unicode NFKC folding and removing leading whitespace, control and invisible characters, the first character is `=`, `+`, `-`, `@`
 * (or the minus lookalike), or when the value itself STARTS with a control or format (bidi, zero-width) character, tab or CR.
 * This runs BEFORE control characters are stripped from the cell (see csvCell), so stripping can never expose a live formula.
 */
export function sanitizeText(value: string): string {
  const folded = value.normalize('NFKC').replace(LEADING_HIDDEN, '');
  if (FORMULA_START.test(folded) || LEADING_CONTROL_OR_FORMAT.test(value)) return `'${value}`;
  return value;
}

/** A number as plain digits: finite only, no grouping, `.` decimal. Anything else is an empty cell. */
export function plainNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  // Avoid exponent notation for tiny or huge values: toFixed(6) then trim zeros.
  return n.toFixed(6).replace(/\.?0+$/, '');
}

/** Integer paise to a decimal rupee string by integer arithmetic: 12345600 -> "123456.00". Rejects non-integers. */
export function paiseToDecimal(paise: number): string {
  if (typeof paise !== 'number' || !Number.isSafeInteger(paise)) throw new RangeError('paiseToDecimal expects an integer number of paise');
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Ratio in basis points (clicks per 10,000 impressions) rounded half up, by integer arithmetic. Null when the denominator is 0. */
export function basisPoints(numerator: number, denominator: number): number | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) return null;
  return Math.floor((numerator * 20_000 + denominator) / (2 * denominator));
}

/** Basis points as a percentage string with two decimals: 125 -> "1.25". */
export const percentFromBasisPoints = (bp: number): string => `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;

/** One cell as CSV text (quoted when it holds a comma, a quote or a line break). */
export function csvCell(cell: CsvCell): string {
  let text: string;
  if (cell === null || cell === undefined) text = '';
  else if (typeof cell === 'number') text = plainNumber(cell);
  else text = sanitizeText(String(cell));
  // Control characters other than tab and newline have no place in a spreadsheet cell.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvOptions {
  /** Prepend a UTF-8 byte order mark (Excel). Default true. */
  bom?: boolean;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>, options: CsvOptions = {}): string {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return `${options.bom === false ? '' : '\ufeff'}${body}\r\n`;
}
