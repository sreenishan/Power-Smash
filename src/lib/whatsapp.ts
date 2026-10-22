// The ONE helper for WhatsApp links (D-025, D-029). Never build wa.me URLs anywhere else.
//
// Numbers must be INTERNATIONAL (country code first), e.g. 91XXXXXXXXXX for India. `normaliseWhatsAppNumber` is shared with
// scripts/check-release.ts so a number that would give a dead link is rejected at release time too (review finding C-2/B-12):
//   - spaces, "+", brackets and hyphens are removed; a leading "00" international prefix is dropped;
//   - a leading "0" (national trunk prefix) means the country code is missing -> rejected;
//   - exactly 10 digits starting 6-9 is an Indian mobile number WITHOUT the 91 -> rejected (wa.me would open a dead chat);
//   - otherwise 8-15 digits (E.164 length) are accepted.
// Returns null when there is no usable number, so callers hide the button instead of showing a broken link.
export function normaliseWhatsAppNumber(number: string | null | undefined): string | null {
  let digits = (number ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return null;
  if (digits.length < 8 || digits.length > 15) return null; // E.164 numbers are 8-15 digits including the country code
  return digits;
}

// `text`: optional prefilled message. Keep it free of personal data (D-029): a reference code and a topic are fine.
export function waLink(number: string | null | undefined, text?: string): string | null {
  const digits = normaliseWhatsAppNumber(number);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  const message = (text ?? '').replace(/\r/g, '').trim();
  return message === '' ? base : `${base}?text=${encodeURIComponent(message)}`;
}

// "Share on WhatsApp": a wa.me link WITHOUT a number, so the visitor picks the chat. Official format: https://wa.me/?text=<encoded>.
// The text must be public content only (a page URL and a short line), never personal data. Blank text gives null.
export function waShareLink(text: string | null | undefined): string | null {
  const message = (text ?? '').replace(/\r/g, '').trim();
  return message === '' ? null : `https://wa.me/?text=${encodeURIComponent(message)}`;
}
