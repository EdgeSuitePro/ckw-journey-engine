import 'server-only';
import { admin } from '@/lib/supabase/admin';
import { links } from './templates';
import { createPaymentLink, squareConfigured } from '@/providers/square';
import { JourneyError, recordEvent } from './engine';
import type { EventType, Reservation } from './types';

/**
 * Shop operations — each one is a thin wrapper that records a verified event.
 * Used by staff screens, the customer order page and the Square webhook.
 */

async function getReservation(id: string): Promise<Reservation> {
  const { data } = await admin().from('reservations').select('*').eq('id', id).maybeSingle();
  if (!data) throw new JourneyError('Reservation not found', 'not_found');
  return data as Reservation;
}

export async function advance(reservationId: string, type: EventType, actor: string, opts: { amountCents?: number } = {}) {
  const r = await getReservation(reservationId);
  const patch: Record<string, unknown> = {};

  if (type === 'reservation.ready') {
    if (opts.amountCents != null) patch.amount_due_cents = opts.amountCents;
    const amount = opts.amountCents ?? r.amount_due_cents ?? 0;
    if (amount > 0 && r.payment_status === 'unpaid' && squareConfigured()) {
      try {
        const { data: c } = await admin().from('customers').select('email, phone').eq('id', r.customer_id).single();
        const link = await createPaymentLink({
          reservationId: r.id,
          code: r.code,
          amountCents: amount,
          buyerEmail: c?.email,
          buyerPhone: c?.phone,
          redirectUrl: links.order(r),
        });
        Object.assign(patch, {
          square_payment_link_id: link.id,
          square_payment_link_url: link.url,
          square_order_id: link.orderId,
          payment_status: 'link_sent',
        });
      } catch (err) {
        // Never block "ready" on Square — the customer can still pay at pickup.
        console.error('[square] payment link failed', err);
      }
    }
  }

  return recordEvent({
    type,
    customerId: r.customer_id,
    reservationId: r.id,
    actor,
    idempotencyKey: `reservation:${r.id}:${type}`,
    reservationPatch: Object.keys(patch).length ? patch : undefined,
    payload: { from_status: r.status, ...(opts.amountCents != null ? { amount_due_cents: opts.amountCents } : {}) },
  });
}

/** One payment per reservation — Square and "paid in person" share the same key, so they can't double-count. */
export async function markPaid(
  reservationId: string,
  actor: string,
  opts: { method: 'square' | 'card_in_person' | 'cash' | 'check' | 'comped'; amountCents: number; tipCents?: number; squarePaymentId?: string },
) {
  const r = await getReservation(reservationId);
  if (r.payment_status === 'paid' || r.payment_status === 'comped') return { duplicate: true };
  const now = new Date().toISOString();
  return recordEvent({
    type: 'payment.received',
    customerId: r.customer_id,
    reservationId: r.id,
    actor,
    idempotencyKey: `reservation:${r.id}:payment.received`,
    reservationPatch: {
      payment_status: opts.method === 'comped' ? 'comped' : 'paid',
      payment_method: opts.method,
      amount_paid_cents: opts.amountCents,
      paid_at: now,
    },
    payload: {
      method: opts.method,
      amount_cents: opts.amountCents,
      tip_cents: opts.tipCents ?? 0,
      ...(opts.squarePaymentId ? { square_payment_id: opts.squarePaymentId } : {}),
    },
  });
}
