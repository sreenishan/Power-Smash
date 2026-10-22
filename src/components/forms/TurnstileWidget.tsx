/** @jsxImportSource react */
// The spam check area. It always renders a reserved box (so nothing jumps) and, once the form has been touched (`started`), hands
// the box over to TurnstileLogic (a separate chunk) which loads the Turnstile logic, injects Cloudflare's script and renders the
// managed widget (D-010: nothing third-party on page load). Before the first touch this is only the box and one sentence, so the
// part of the form that loads with the page stays small (review C-1).
import { Suspense, lazy, type RefObject } from 'react';
import type { TurnstileMode, WidgetController } from '../../lib/forms/turnstile';

const TurnstileLogic = lazy(() => import('./TurnstileLogic'));

// Same words as the "loading" state in widgetMessage() (src/lib/forms/turnstile.ts, which loads after the first touch); written out
// here so this file does not pull in the widget texts. tests/forms/turnstile.test.ts checks the two stay equal.
const WIDGET_LOADING_FALLBACK = 'Getting the spam check ready...';

export interface TurnstileWidgetProps {
  mode: TurnstileMode;
  siteKey: string | null;
  /** True after the first focus, pointer or key event anywhere in the form. */
  started: boolean;
  /** The parent reads the current token from here at send time. */
  controllerRef: RefObject<WidgetController | null>;
  /** Receives the container so the parent can move focus to it. */
  boxRef: RefObject<HTMLDivElement | null>;
  /** Called each time the widget reports a solved check. */
  onSolved: () => void;
}

export function TurnstileWidget({ mode, siteKey, started, controllerRef, boxRef, onSolved }: TurnstileWidgetProps) {
  // Only a development build can be in this mode (resolveTurnstileMode), so the production bundle drops this notice entirely.
  if (import.meta.env.DEV && mode === 'dev-unconfigured') {
    return (
      <div className="rounded-md border-2 border-dashed border-ps-live bg-ps-live-tint p-3 text-small text-ps-ink" data-dev-only>
        <strong>Development only.</strong> No spam-check key is set (PUBLIC_TURNSTILE_SITE_KEY), so the check is not shown. The
        server will still refuse a send without a valid check. This notice never appears on a production build.
      </div>
    );
  }
  if (mode !== 'widget' || !siteKey) return null;

  return (
    <div ref={boxRef} tabIndex={-1} className="flex flex-col gap-2" aria-label="Spam check">
      {started ? (
        <Suspense
          fallback={
            // Same height as the placeholder below and as the loaded widget area: if the box shrank here, the Send button would move
            // up between pointer-down and pointer-up and the very first tap on Send would be lost (finding E-1).
            <>
              <div className="min-h-[65px]" />
              <p role="status" className="text-small text-fg-muted">
                {WIDGET_LOADING_FALLBACK}
              </p>
            </>
          }
        >
          <TurnstileLogic siteKey={siteKey} controllerRef={controllerRef} onSolved={onSolved} />
        </Suspense>
      ) : (
        <>
          <div className="min-h-[65px]" />
          <p role="status" className="text-small text-fg-muted">
            The spam check loads when you start filling in the form.
          </p>
        </>
      )}
    </div>
  );
}
