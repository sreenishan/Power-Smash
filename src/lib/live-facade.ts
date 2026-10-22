// Click-to-load YouTube player for /live (privacy, D-016): nothing from YouTube is requested until the visitor presses the button.
// The page renders `<div data-live-facade data-embed-src="https://www.youtube-nocookie.com/embed/<id>?...">` with a button inside; this
// file swaps the div's content for the iframe. The address is re-checked here: it must start with the privacy-enhanced embed origin.
const EMBED_PREFIX = 'https://www.youtube-nocookie.com/embed/';

/** True only for an embed address on the privacy-enhanced domain. Exported for the unit test. */
export function isAllowedEmbedSrc(src: string | null | undefined): src is string {
  return typeof src === 'string' && src.startsWith(EMBED_PREFIX) && !/[\s"'<>]/.test(src);
}

export function installLiveFacade(root: ParentNode): void {
  for (const box of Array.from(root.querySelectorAll<HTMLElement>('[data-live-facade]'))) {
    const button = box.querySelector<HTMLButtonElement>('button[data-live-load]');
    if (!button) continue;
    button.hidden = false; // the button is hidden in the HTML so a visitor without JavaScript sees the plain link instead
    button.addEventListener('click', () => {
      const src = box.getAttribute('data-embed-src');
      if (!isAllowedEmbedSrc(src)) return;
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.title = box.getAttribute('data-title') ?? 'YouTube video player';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.className = 'ps-live-frame';
      box.replaceChildren(frame);
      frame.focus();
    });
  }
}
