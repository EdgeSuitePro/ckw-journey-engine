import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SiteHeader } from '@/components/Brand';
import { advance } from '@/engine/operations';
import { STATUS_LABEL } from '@/engine/stateMachine';
import { links } from '@/engine/templates';
import type { Customer, Reservation, ReservationStatus } from '@/engine/types';
import { BUSINESS, JOURNEY } from '@/lib/config';
import { ITEM_TYPES, type ItemKey } from '@/lib/items';
import { admin } from '@/lib/supabase/admin';
import { fmtSlot } from '@/lib/time';

export const metadata: Metadata = { title: 'Your order', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STEPS: ReservationStatus[] = ['booked', 'checked_in', 'in_service', 'ready', 'picked_up'];

async function load(token: string) {
  const { data: r } = await admin().from('reservations').select('*').eq('access_token', token).maybeSingle();
  if (!r) return null;
  const { data: c } = await admin().from('customers').select('*').eq('id', r.customer_id).single();
  return { r: r as Reservation, c: c as Customer };
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { token } = await params;
  const { new: isNew } = await searchParams;
  const data = await load(token);
  if (!data) notFound();
  const { r, c } = data;

  async function cancel() {
    'use server';
    const fresh = await load(token);
    if (fresh?.r.status === 'booked') {
      await advance(fresh.r.id, 'reservation.cancelled', 'customer');
    }
    redirect(`/o/${token}`);
  }

  const stepIndex = STEPS.indexOf(r.status);
  const unpaid = r.payment_status !== 'paid' && r.payment_status !== 'comped';
  const items = Object.entries(r.items ?? {}).filter(([, n]) => n > 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-8">
        {isNew && r.status === 'booked' && (
          <div className="mb-6 rounded-lg bg-carbon px-4 py-3.5 text-cream">
            <strong>You’re booked.</strong> A confirmation text is on its way. Save this page — it updates live.
          </div>
        )}

        <p className="eyebrow">Order {r.code}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{STATUS_LABEL[r.status]}</h1>
        <p className="mt-1 text-ink-soft">Drop-off: {fmtSlot(r.window_start, r.window_end)}</p>

        {stepIndex >= 0 && (
          <ol className="mt-8 space-y-0" aria-label="Progress">
            {STEPS.map((s, i) => {
              const done = i <= stepIndex;
              return (
                <li key={s} className="flex items-center gap-3 py-1.5">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                      done ? 'border-aogami bg-aogami text-cream' : 'border-line bg-white text-ink-soft'
                    }`}
                    aria-hidden="true"
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={done ? 'font-semibold' : 'text-ink-soft'}>{STATUS_LABEL[s]}</span>
                  {i === stepIndex && <span className="sr-only">(current)</span>}
                </li>
              );
            })}
          </ol>
        )}

        {r.status === 'ready' && unpaid && r.square_payment_link_url && (
          <div className="card mt-8 p-5">
            <p className="font-semibold">Pay ahead for a quick pickup</p>
            {r.amount_due_cents != null && (
              <p className="mt-1 text-2xl font-bold">${(r.amount_due_cents / 100).toFixed(2)}</p>
            )}
            <a href={r.square_payment_link_url} className="btn btn-primary mt-4 w-full">
              Pay securely with Square
            </a>
          </div>
        )}

        {r.status === 'picked_up' && (
          <div className="card mt-8 space-y-4 p-5">
            <p className="font-semibold">Thanks, {c.full_name.split(' ')[0]}. Enjoy the edge.</p>
            <p className="text-sm text-ink-soft">
              Share your link — friends get {JOURNEY.referralReward} their first sharpening and you get{' '}
              {JOURNEY.referralReward} your next one.
            </p>
            <p className="break-all rounded bg-paper px-3 py-2 font-mono text-sm">{links.refer(c)}</p>
            <Link href={`/reserve?rebook=${c.referral_code}`} className="btn btn-ghost w-full">
              Book my next sharpening
            </Link>
          </div>
        )}

        <dl className="card mt-8 divide-y divide-line text-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-soft">Where</dt>
            <dd className="text-right">{BUSINESS.address}</dd>
          </div>
          {items.length > 0 && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ink-soft">Bringing</dt>
              <dd className="text-right">
                {items.map(([k, n]) => `${n} ${ITEM_TYPES[k as ItemKey] ?? k}`.toLowerCase()).join(', ')}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-soft">Payment</dt>
            <dd className="capitalize">{r.payment_status === 'link_sent' ? 'Unpaid' : r.payment_status}</dd>
          </div>
        </dl>

        {r.status === 'booked' && (
          <form action={cancel} className="mt-8">
            <button type="submit" className="text-sm font-medium text-danger underline underline-offset-4">
              Cancel this reservation
            </button>
          </form>
        )}
        {(r.status === 'cancelled' || r.status === 'no_show') && (
          <Link href="/reserve" className="btn btn-primary mt-8 w-full">
            Book a new window
          </Link>
        )}
      </main>
    </>
  );
}
