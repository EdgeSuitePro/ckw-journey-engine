'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { NEXT_ACTION } from '@/engine/stateMachine';
import type { Customer, Reservation } from '@/engine/types';
import { ITEM_TYPES, type ItemKey } from '@/lib/items';
import { formatPhone } from '@/lib/phone';
import { fmtSlot, fmtWindow } from '@/lib/time';
import { advanceAction, markPaidAction, type ActionResult } from './actions';

const PAY_LABEL: Record<Reservation['payment_status'], string> = {
  unpaid: 'Unpaid',
  link_sent: 'Pay link sent',
  paid: 'Paid',
  comped: 'Comped',
  refunded: 'Refunded',
};

export function OrderCard({ reservation: r, customer: c, isToday }: { reservation: Reservation; customer: Customer; isToday: boolean }) {
  const [advState, advance, advancing] = useActionState<ActionResult | null, FormData>(advanceAction, null);
  const [payState, pay, paying] = useActionState<ActionResult | null, FormData>(markPaidAction, null);
  const [showPay, setShowPay] = useState(false);
  const next = NEXT_ACTION[r.status];
  const paid = r.payment_status === 'paid' || r.payment_status === 'comped';
  const items = Object.entries(r.items ?? {}).filter(([, n]) => n > 0);
  const error = (advState && !advState.ok && advState.error) || (payState && !payState.ok && payState.error);

  return (
    <article className="card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/staff/customers/${c.id}`} className="block truncate font-semibold hover:underline">
            {c.full_name}
          </Link>
          <a href={`tel:${c.phone}`} className="text-sm text-ink-soft">
            {formatPhone(c.phone)}
          </a>
        </div>
        <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-xs">{r.code}</span>
      </div>

      <p className={`mt-2 text-sm ${isToday && r.status === 'booked' ? 'font-semibold text-aogami' : 'text-ink-soft'}`}>
        {r.status === 'booked' ? (isToday ? `Today · ${fmtWindow(r.window_start, r.window_end)}` : fmtSlot(r.window_start, r.window_end)) : `Dropped ${fmtSlot(r.window_start, r.window_end)}`}
      </p>
      {items.length > 0 && (
        <p className="mt-1 text-sm">{items.map(([k, n]) => `${n} ${(ITEM_TYPES[k as ItemKey] ?? k).toLowerCase()}`).join(' · ')}</p>
      )}
      {r.customer_notes && <p className="mt-1.5 rounded bg-bronze/10 px-2 py-1 text-xs">“{r.customer_notes}”</p>}

      {r.status !== 'booked' && (
        <p className="mt-2 text-xs">
          <span className={paid ? 'font-semibold text-sage' : 'text-ink-soft'}>{PAY_LABEL[r.payment_status]}</span>
          {r.amount_due_cents != null && !paid && <span className="text-ink-soft"> · ${(r.amount_due_cents / 100).toFixed(2)} due</span>}
        </p>
      )}

      {next && (
        <form action={advance} className="mt-3 flex gap-2">
          <input type="hidden" name="reservationId" value={r.id} />
          <input type="hidden" name="event" value={next.event} />
          {next.event === 'reservation.ready' && (
            <label className="flex-1">
              <span className="sr-only">Total due</span>
              <input
                name="amount"
                inputMode="decimal"
                placeholder="Total $"
                defaultValue={r.amount_due_cents != null ? (r.amount_due_cents / 100).toFixed(2) : ''}
                className="field !min-h-[40px] text-sm"
              />
            </label>
          )}
          {next.event === 'reservation.picked_up' && !paid ? (
            <button type="button" onClick={() => setShowPay(true)} className="btn btn-primary !min-h-[40px] flex-1 text-sm">
              Take payment
            </button>
          ) : (
            <button className="btn btn-primary !min-h-[40px] flex-1 text-sm" disabled={advancing}>
              {advancing ? '…' : next.label}
            </button>
          )}
        </form>
      )}

      {!paid && r.status === 'ready' && (showPay || (payState && !payState.ok)) && (
        <form action={pay} className="mt-2 space-y-2 rounded-lg bg-paper p-2.5">
          <input type="hidden" name="reservationId" value={r.id} />
          <div className="flex gap-2">
            <select name="method" className="field !min-h-[40px] text-sm" defaultValue="card_in_person">
              <option value="card_in_person">Card (Square POS)</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="comped">Comped</option>
            </select>
            <input
              name="amount"
              inputMode="decimal"
              placeholder="$"
              defaultValue={r.amount_due_cents != null ? (r.amount_due_cents / 100).toFixed(2) : ''}
              className="field !min-h-[40px] w-24 text-sm"
            />
          </div>
          <button className="btn btn-primary !min-h-[40px] w-full text-sm" disabled={paying}>
            {paying ? '…' : 'Record payment'}
          </button>
        </form>
      )}

      {r.status === 'booked' && (
        <div className="mt-2 flex gap-3 text-xs">
          {(['reservation.no_show', 'reservation.cancelled'] as const).map((ev) => (
            <form key={ev} action={advance}>
              <input type="hidden" name="reservationId" value={r.id} />
              <input type="hidden" name="event" value={ev} />
              <button className="text-ink-soft underline-offset-2 hover:underline">{ev === 'reservation.no_show' ? 'No-show' : 'Cancel'}</button>
            </form>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </article>
  );
}
