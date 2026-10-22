/** @jsxImportSource react */
// The working part of the spam check area, loaded after the first touch of the form (React.lazy in TurnstileWidget.tsx). It loads
// the Turnstile logic (another chunk), injects Cloudflare's script, renders the managed widget into the reserved box and shows
// the plain-English state under it, with a "try again" button when the widget or its script failed (D-010: nothing third-party
// on page load; the logic and the texts are in src/lib/forms/turnstile.ts). When the check passes it calls `onSolved` (review
// B-14: the "still finishing" message goes away). The reserved box itself is drawn by TurnstileWidget so it is in the page's HTML.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { WidgetController } from '../../lib/forms/turnstile';
import { WIDGET_LOADING_TEXT, WIDGET_LOAD_FAILED_TEXT } from '../../lib/forms/widget-text';
import { buttonQuiet } from './styles';

export interface TurnstileLogicProps {
  siteKey: string;
  /** The parent reads the current token from here at send time. */
  controllerRef: RefObject<WidgetController | null>;
  /** Called each time the widget reports a solved check. */
  onSolved: () => void;
}

/** What is shown under the widget, and whether the "try again" button is offered. */
interface View {
  text: string;
  retry: boolean;
}

export default function TurnstileLogic({ siteKey, controllerRef, onSolved }: TurnstileLogicProps) {
  const [view, setView] = useState<View>({ text: WIDGET_LOADING_TEXT, retry: false });
  const [attempt, setAttempt] = useState(0);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const solvedRef = useRef(onSolved);
  solvedRef.current = onSolved;

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    const container = mountRef.current;
    void import('../../lib/forms/turnstile')
      .then(({ loadTurnstile, renderWidget, widgetMessage }) =>
        loadTurnstile(document as never, window as never).then((api) => {
          if (cancelled) return;
          controllerRef.current = renderWidget(api, container, siteKey, (s) => {
            if (cancelled) return;
            setView({ text: widgetMessage(s), retry: s.status === 'error' });
            if (s.status === 'solved') solvedRef.current();
          });
        }),
      )
      .catch(() => {
        if (!cancelled) setView({ text: WIDGET_LOAD_FAILED_TEXT, retry: true });
      });
    return () => {
      cancelled = true;
      controllerRef.current?.remove();
      controllerRef.current = null;
    };
  }, [siteKey, attempt, controllerRef]);

  return (
    <>
      <div ref={mountRef} className="min-h-[65px]" />
      <p role="status" className="text-small text-fg-muted">
        {view.text}
      </p>
      {view.retry ? (
        <button
          type="button"
          className={`${buttonQuiet} w-full sm:w-auto`}
          onClick={() => {
            setView({ text: WIDGET_LOADING_TEXT, retry: false });
            setAttempt((n) => n + 1);
          }}
        >
          Try the spam check again
        </button>
      ) : null}
    </>
  );
}
