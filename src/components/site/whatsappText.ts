// Prefilled WhatsApp messages (D-025: "a prefilled message per page type"). D-029: no personal data in the text, only a
// topic. These strings go into waLink(number, text), the ONLY way to build a wa.me link. Pure, unit-tested.

const BY_ROUTE: Record<string, string> = {
  '/': 'Hi Power Smash, I have a question.',
  '/services': 'Hi Power Smash, I would like to know more about tournament coverage.',
  '/pricing': 'Hi Power Smash, I have a question about your pricing.',
  '/partner': 'Hi Power Smash, I would like to know more about partnering with you.',
  '/support': 'Hi Power Smash, I have a question about supporting the channel.',
  '/about': 'Hi Power Smash, I have a question.',
  '/tournaments': 'Hi Power Smash, I have a question about a tournament.',
  '/tournaments/submit': 'Hi Power Smash, I would like to list my tournament.',
  '/book': 'Hi Power Smash, I would like to book coverage for my tournament.',
  '/contact': 'Hi Power Smash, I have a question.',
};

export const DEFAULT_WHATSAPP_TEXT = 'Hi Power Smash, I have a question.';

/** The message for a page path. Unknown paths (legal pages, 404) get the generic greeting. */
export function whatsappTextForPath(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (BY_ROUTE[path]) return BY_ROUTE[path];
  if (path.startsWith('/tournaments/')) return BY_ROUTE['/tournaments'];
  return DEFAULT_WHATSAPP_TEXT;
}

/** Message for a named package or product. Only the product name goes in. */
export function whatsappTextForPackage(name: string): string {
  return `Hi Power Smash, I would like to ask about ${name.trim()}.`;
}
