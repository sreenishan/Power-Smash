// Prices: edit a product's price, GST flag and visibility. Integer paise only; no default price exists (src/lib/pricing-admin).
import { useState } from 'react';
import type { ProductItem } from '../../lib/admin/types';
import { rupeesInputFromPaise } from '../../lib/pricing-admin/price-input';
import { formatInr } from '../../lib/money';
import { Badge, Button, Confirm, Empty, Field, LoadState, TextInput, cardCls, inputCls, useAdmin, useAsync, useBusy } from '../ui';

const TYPE_LABEL = { fixed: 'Fixed price', starting_from: 'Starting from', quote: 'On quote' } as const;

export function Prices() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listProducts(), []);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Type a price in rupees. Nothing is filled in for you: a product with no price shows no price on the site, and a product can be shown only when it has what its price type needs.</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data && q.data.length > 0 ? q.data.map((p) => <ProductCard key={p.slug} item={p} />) : <Empty>No products.</Empty>}
      </LoadState>
    </div>
  );
}

function ProductCard({ item }: { item: ProductItem }) {
  const r = item.record;
  const { client, actor, notify, check, bump } = useAdmin();
  const [open, setOpen] = useState(false);
  const [priceType, setPriceType] = useState<string>(r.priceType);
  const [rupees, setRupees] = useState(rupeesInputFromPaise(r.pricePaise));
  const [gst, setGst] = useState(r.gstInclusive === null ? 'unknown' : r.gstInclusive ? 'yes' : 'no');
  const [days, setDays] = useState(r.deliveryDays === null ? '' : String(r.deliveryDays));
  const [visible, setVisible] = useState(r.visible);
  const [quoteOk, setQuoteOk] = useState(r.quoteWordingApproved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [busy, run] = useBusy();

  const save = async () => {
    setErrors({});
    const d = days.trim() === '' ? null : Number(days);
    const res = await run(() =>
      client.saveProduct(actor, {
        slug: item.slug,
        name: r.name,
        summary: r.summary,
        priceType,
        priceRupees: rupees.trim() === '' ? null : rupees,
        gstInclusive: gst === 'unknown' ? null : gst === 'yes',
        deliveryDays: d !== null && Number.isInteger(d) ? d : null,
        visible,
        sort: r.sort,
        inclusions: r.inclusions,
        inclusionsApproved: r.inclusionsApproved,
        quoteWordingApproved: quoteOk,
      }),
    );
    setAsking(false);
    if (!res) return;
    if (check(res)) {
      notify('Saved. Publish from the dashboard to put it on the site.');
      bump();
      setOpen(false);
    } else setErrors(res.errors ?? {});
  };
  const err = (k: string) => (errors[k] ? <p role="alert" className="font-semibold text-ps-live">{errors[k]}</p> : null);

  return (
    <article className={cardCls}>
      <p className="break-words font-bold">{r.name}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <Badge>{TYPE_LABEL[r.priceType]}</Badge>
        <Badge tone={r.pricePaise === null ? 'warn' : 'good'}>{r.pricePaise === null ? 'No price set' : formatInr(r.pricePaise)}</Badge>
        <Badge tone={r.visible ? 'good' : 'neutral'}>{r.visible ? 'Shown on the site' : 'Not shown'}</Badge>
      </p>
      <div className="mt-2"><Button small onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit price'}</Button></div>
      {open ? (
        <form className="mt-3 flex flex-col gap-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); setAsking(true); }}>
          <Field label="Price type" htmlFor={`pt-${item.slug}`}>
            <select id={`pt-${item.slug}`} className={inputCls} value={priceType} onChange={(e) => setPriceType(e.target.value)}>
              <option value="fixed">Fixed price</option>
              <option value="starting_from">Starting from</option>
              <option value="quote">On quote (no price shown)</option>
            </select>
          </Field>
          <Field label="Price in rupees" htmlFor={`pr-${item.slug}`} hint="For example 5,000 or 12,50,000. Leave empty for no price.">
            <TextInput id={`pr-${item.slug}`} value={rupees} onChange={setRupees} inputMode="numeric" />
          </Field>
          {err('price')}
          <Field label="Does the price include GST?" htmlFor={`gst-${item.slug}`}>
            <select id={`gst-${item.slug}`} className={inputCls} value={gst} onChange={(e) => setGst(e.target.value)}>
              <option value="unknown">Not sure: say nothing about GST</option>
              <option value="yes">Yes, includes GST</option>
              <option value="no">No, GST is extra</option>
            </select>
          </Field>
          <Field label="Delivery in working days (optional)" htmlFor={`dd-${item.slug}`}>
            <TextInput id={`dd-${item.slug}`} value={days} onChange={setDays} inputMode="numeric" />
          </Field>
          {err('deliveryDays')}
          <label className="flex min-h-tap items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={quoteOk} onChange={(e) => setQuoteOk(e.target.checked)} />I approve the words "On quote, message us on WhatsApp"</label>
          <label className="flex min-h-tap items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={visible} onChange={(e) => setVisible(e.target.checked)} />Show this product on the site</label>
          {err('visible')}{err('inclusions')}{err('name')}{err('priceType')}
          {errors.form ? <p role="alert" className="font-semibold text-ps-live">{errors.form}</p> : null}
          <div><Button type="submit" variant="primary">Review and save</Button></div>
          {asking ? <Confirm title={`Save the price of "${r.name}"?`} body={`The change is recorded with your name. It reaches the site at the next publish.`} confirmLabel="Save" busy={busy} onConfirm={() => void save()} onCancel={() => setAsking(false)} /> : null}
        </form>
      ) : null}
    </article>
  );
}
