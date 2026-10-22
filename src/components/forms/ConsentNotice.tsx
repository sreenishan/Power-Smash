/** @jsxImportSource react */
// The notice shown on every form (D-028, spec 15.4): plain text from src/content/consent.ts, owned by the Legal worker.
// It is a NOTICE, not a tick box. The payload builder stores `{ id, version }` of this exact text with every submission. If the
// text contains the words "Privacy Policy" they link to the privacy page (`privacyHref`, written by the page through the one URL
// helper); the words shown to the visitor are never changed, so the stored id and version always describe what was on screen.
import type { ConsentText } from '../../content/consent';

export interface ConsentNoticeProps {
  notice: ConsentText;
  /** Address of the privacy page, in the site's one canonical form (src/lib/urls.ts path('/privacy')). */
  privacyHref: string;
}

const LINK_WORDS = 'Privacy Policy';

export function ConsentNotice({ notice, privacyHref }: ConsentNoticeProps) {
  const at = notice.text.indexOf(LINK_WORDS);
  return (
    <p className="rounded-md border-l-4 border-ps-court bg-ps-court-tint/60 px-4 py-3 text-small leading-relaxed text-ps-ink" data-notice-id={notice.id} data-notice-version={notice.version}>
      {at < 0 ? (
        notice.text
      ) : (
        <>
          {notice.text.slice(0, at)}
          <a href={privacyHref}>{LINK_WORDS}</a>
          {notice.text.slice(at + LINK_WORDS.length)}
        </>
      )}
    </p>
  );
}
