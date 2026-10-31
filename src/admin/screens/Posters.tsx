// QR posters: the link a printed poster's QR code opens, and a QR you can scan or save from the phone. Built with src/lib/qr.
import { useState } from 'react';
import { env } from '../../config/env';
import { buildQrTarget, checkSiteOrigin, qrMatrix, type QrDestination } from '../../lib/qr';
import type { PosterTarget } from '../../lib/admin/types';
import { Badge, Button, Empty, LoadState, cardCls, useAdmin, useAsync } from '../ui';

function QrSvg({ text, label }: { text: string; label: string }) {
  let m: ReturnType<typeof qrMatrix> | null = null;
  try {
    m = qrMatrix(text);
  } catch {
    m = null;
  }
  if (!m) return <p role="alert" className="font-semibold text-ps-live">This address is too long for a QR code.</p>;
  const q = 4;
  const size = m.size + q * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="h-48 w-48 bg-white" shapeRendering="crispEdges">
      <g fill="#000">{m.rows.flatMap((row, y) => row.map((dark, x) => (dark ? <rect key={`${x}-${y}`} x={x + q} y={y + q} width="1" height="1" /> : null)))}</g>
    </svg>
  );
}

export function Posters() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listPosterTargets(), []);
  const origin = checkSiteOrigin(env.siteUrl, { allowLocalHttp: true });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Each poster has a QR code that opens that tournament (or the channel) with tracking, so you can see which venue sent visitors.</p>
      {!origin.ok ? <p role="alert" className="rounded-lg border border-ps-live border-l-4 bg-ps-live-tint p-4 text-ps-ink">The website address is not set up yet, so no QR code can be made. It is set by the build setting PUBLIC_SITE_URL.</p> : null}
      {origin.ok && origin.local ? <p role="status" className="rounded-lg border border-ps-live border-l-4 bg-ps-live-tint p-4 text-ps-ink">This is a test address. Do not print these codes.</p> : null}
      <LoadState loading={q.loading} error={q.error}>
        {origin.ok && q.data && q.data.length > 0 ? q.data.map((t) => <PosterCard key={t.slug} t={t} origin={origin.origin} />) : <Empty>No posters to make yet. A tournament gets a poster once it is approved.</Empty>}
      </LoadState>
    </div>
  );
}

function PosterCard({ t, origin }: { t: PosterTarget; origin: string }) {
  const { notify } = useAdmin();
  const [shown, setShown] = useState(false);
  const dest: QrDestination = t.kind === 'channel' ? { kind: 'channel' } : { kind: 'tournament', slug: t.slug };
  const target = buildQrTarget(origin, dest);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target ?? '');
      notify('Link copied.');
    } catch {
      notify('Could not copy. Press and hold the link to copy it.');
    }
  };
  return (
    <article className={cardCls}>
      <p className="font-bold">{t.title} <Badge>{t.kind === 'channel' ? 'Channel' : 'Tournament'}</Badge></p>
      {target ? (
        <>
          <p className="mt-1 break-all text-small">{target}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button small onClick={() => void copy()}>Copy link</Button>
            <Button small onClick={() => setShown(!shown)}>{shown ? 'Hide QR code' : 'Show QR code'}</Button>
          </div>
          {shown ? <div className="mt-3 flex justify-center"><QrSvg text={target} label={`QR code for ${t.title}`} /></div> : null}
        </>
      ) : (
        <p role="alert" className="mt-1 font-semibold text-ps-live">No safe link can be made for this one.</p>
      )}
    </article>
  );
}
