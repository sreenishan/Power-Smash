// Fixed wording of the /international/ page (D-112), kept in one place so the tests can pin it.

/** Every official link: a new tab that gets no opener, no referrer and no search-engine endorsement. */
export const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow';

/** The line the page leads with (the owner decision: links only, nothing copied). */
export const OFFICIAL_SITE_NOTE = 'Details and results on the official site. Power Smash lists these events with a link to each one\'s official page.';

/** The visible label of an official link: says it is external and names the website it opens. */
export function linkLabel(host: string): string {
  return `Official page on ${host}`;
}
