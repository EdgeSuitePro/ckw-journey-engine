import 'server-only';
import { addMinutes } from 'date-fns';
import { admin } from '@/lib/supabase/admin';
import { respectQuietHours } from '@/lib/time';
import { sendEmail } from '@/providers/resend';
import { sendSms } from '@/providers/quo';
import { checkGuard } from './guards';
import { planForEvent } from './planner';
import { canPickUp, TRANSITIONS } from './stateMachine';
import { firstName } from './templates';
import { EVENT_STAGE, type Customer, type EventType, type GuardName, type Reservation } from './types';

export class JourneyError extends Error {
  constructor(message: string, readonly code: 'invalid_transition' | 'not_found' | 'unpaid' | 'db') {
    super(message);
  }
}

export interface RecordInput {
  type: EventType;
  customerId: string;
  reservationId?: string | null;
  actor: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  /** Extra columns to set on the reservation along with the status move. */
  reservationPatch?: Record<string, unknown>;
}

async function loadCustomer(id: string): Promise<Customer> {
  const { data, error } = await admin().from('customers').select('*').eq('id', id).maybeSingle();
  if (error) throw new JourneyError(error.message, 'db');
  if (!data) throw new JourneyError('Customer not found', 'not_found');
  return data as Customer;
}

async function loadReservation(id: string): Promise<Reservation> {
  const { data, error } = await admin().from('reservations').select('*').eq('id', id).maybeSingle();
  if (error) throw new JourneyError(error.message, 'db');
  if (!data) throw new JourneyError('Reservation not found', 'not_found');
  return data as Reservation;
}

/**
 * Record one verified customer event and run the journey rules for it.
 *
 *   1. Ignore exact repeats (same idempotency key) — webhooks and double-taps are safe.
 *   2. Apply the status move with a compare-and-set, so two staff taps can't race.
 *   3. Append the event (immutable).
 *   4. Plan messages; cancel obsolete ones; queue new ones (deduped).
 *   5. Fire any follow-on events (e.g. a referral qualifying).
 *   6. Send anything due right now.
 */
export async function recordEvent(input: RecordInput): Promise<{ duplicate: boolean; eventId?: number }> {
  const db = admin();

  const { data: existing } = await db
    .from('journey_events')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing) return { duplicate: true, eventId: existing.id };

  // --- 2. status move ---------------------------------------------------------
  const rule = TRANSITIONS[input.type];
  if (rule) {
    if (!input.reservationId) throw new JourneyError('This event needs a reservation', 'invalid_transition');
    const current = await loadReservation(input.reservationId);
    if (input.type === 'reservation.picked_up' && !canPickUp(current.payment_status)) {
      throw new JourneyError('Take payment before marking picked up', 'unpaid');
    }
    const patch: Record<string, unknown> = { ...(input.reservationPatch ?? {}), status: rule.to };
    if (rule.stamp) patch[rule.stamp] = new Date().toISOString();
    const { data: moved, error } = await db
      .from('reservations')
      .update(patch)
      .eq('id', input.reservationId)
      .in('status', rule.from)
      .select('id');
    if (error) throw new JourneyError(error.message, 'db');
    if (!moved?.length) {
      throw new JourneyError(`Can't go from "${current.status}" to "${rule.to}"`, 'invalid_transition');
    }
  } else if (input.reservationPatch && input.reservationId) {
    const { error } = await db.from('reservations').update(input.reservationPatch).eq('id', input.reservationId);
    if (error) throw new JourneyError(error.message, 'db');
  }

  // --- 3. append event ---------------------------------------------------------
  const occurredAt = new Date();
  const { data: ev, error: evErr } = await db
    .from('journey_events')
    .insert({
      type: input.type,
      stage: EVENT_STAGE[input.type],
      customer_id: input.customerId,
      reservation_id: input.reservationId ?? null,
      actor: input.actor,
      payload: input.payload ?? {},
      idempotency_key: input.idempotencyKey,
      occurred_at: occurredAt.toISOString(),
    })
    .select('id')
    .single();
  if (evErr) {
    if (evErr.code === '23505') return { duplicate: true }; // lost a race to an identical event
    throw new JourneyError(evErr.message, 'db');
  }

  // --- 4. plan -----------------------------------------------------------------
  const customer = await loadCustomer(input.customerId);
  const reservation = input.reservationId ? await loadReservation(input.reservationId) : null;
  const plan = planForEvent({
    event: { type: input.type, occurredAt, payload: input.payload ?? {} },
    customer,
    reservation,
    friendFirstName: typeof input.payload?.friend_first_name === 'string' ? input.payload.friend_first_name : undefined,
  });

  for (const c of plan.cancel) {
    let q = db
      .from('messages')
      .update({ status: 'canceled', last_error: c.reason })
      .eq('status', 'queued')
      .eq(c.scope === 'reservation' ? 'reservation_id' : 'customer_id', c.id);
    if (c.templates.length) q = q.in('template', c.templates);
    const { error } = await q;
    if (error) throw new JourneyError(error.message, 'db');
  }

  if (plan.messages.length) {
    const rows = plan.messages.map((m) => ({
      customer_id: customer.id,
      reservation_id: reservation?.id ?? null,
      caused_by_event: ev.id,
      template: m.template,
      stage: m.stage,
      channel: m.channel,
      recipient: m.recipient,
      subject: m.subject ?? null,
      body: m.body,
      send_after: (m.channel === 'sms' && m.quietHours ? respectQuietHours(m.sendAfter) : m.sendAfter).toISOString(),
      guard: m.guard ?? null,
      quiet_hours: m.quietHours,
      dedupe_key: m.dedupeKey,
    }));
    const { error } = await db.from('messages').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (error) throw new JourneyError(error.message, 'db');
  }

  // --- 5. follow-on events -----------------------------------------------------
  if (input.type === 'reservation.picked_up' && customer.referred_by) {
    await qualifyReferral(customer);
  }

  // --- 6. send what's due now (confirmations shouldn't wait for the cron) -----
  await dispatchDue(10).catch((err) => console.error('[journey] inline dispatch failed', err));

  return { duplicate: false, eventId: ev.id };
}

/** First completed visit by a referred customer → thank the referrer. */
async function qualifyReferral(friend: Customer) {
  const db = admin();
  const { data: referral } = await db
    .from('referrals')
    .update({ status: 'qualified', qualified_at: new Date().toISOString() })
    .eq('referred_id', friend.id)
    .eq('status', 'pending')
    .select('id, referrer_id')
    .maybeSingle();
  if (!referral) return;
  await recordEvent({
    type: 'referral.qualified',
    customerId: referral.referrer_id,
    actor: 'system',
    idempotencyKey: `referral:${referral.id}:qualified`,
    payload: { referral_id: referral.id, friend_customer_id: friend.id, friend_first_name: firstName(friend) },
  });
}

// ============================================================================
// Dispatcher
// ============================================================================

interface MessageRow {
  id: string;
  customer_id: string | null;
  reservation_id: string | null;
  template: string;
  channel: 'sms' | 'email';
  recipient: string;
  subject: string | null;
  body: string;
  guard: GuardName | null;
  quiet_hours: boolean;
  attempts: number;
  dedupe_key: string;
}

const MAX_ATTEMPTS = 4;

export async function dispatchDue(limit = 25) {
  const db = admin();
  await db.rpc('requeue_stuck_messages');
  const { data, error } = await db.rpc('claim_due_messages', { p_limit: limit });
  if (error) throw new JourneyError(error.message, 'db');
  const claimed = (data ?? []) as MessageRow[];
  const summary = { claimed: claimed.length, sent: 0, skipped: 0, deferred: 0, failed: 0 };

  for (const m of claimed) {
    const now = new Date();
    // `refund` = this wasn't a real delivery attempt, so don't count it toward MAX_ATTEMPTS.
    const requeue = async (at: Date, note: string, refund = false) => {
      await db
        .from('messages')
        .update({ status: 'queued', send_after: at.toISOString(), last_error: note, attempts: refund ? m.attempts - 1 : m.attempts })
        .eq('id', m.id);
      summary.deferred++;
    };

    // Quiet hours are re-checked at send time too (cron may run late).
    if (m.channel === 'sms' && m.quiet_hours) {
      const allowed = respectQuietHours(now);
      if (allowed.getTime() > now.getTime()) {
        await requeue(allowed, 'deferred for quiet hours', true);
        continue;
      }
    }

    const customer = m.customer_id ? await loadCustomer(m.customer_id).catch(() => null) : null;
    const reservation = m.reservation_id ? await loadReservation(m.reservation_id).catch(() => null) : null;
    let newerReservationCount = 0;
    if (m.guard === 'no_newer_reservation' && customer && reservation) {
      const { count } = await db
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customer.id)
        .gt('created_at', reservation.created_at)
        .not('status', 'in', '(cancelled,no_show)');
      newerReservationCount = count ?? 0;
    }

    const verdict = checkGuard(m.guard, { now, channel: m.channel, customer, reservation, newerReservationCount });
    if (!verdict.ok) {
      await db.from('messages').update({ status: 'skipped', last_error: verdict.reason }).eq('id', m.id);
      summary.skipped++;
      continue;
    }

    const result =
      m.channel === 'sms'
        ? await sendSms(m.recipient, m.body)
        : await sendEmail(m.recipient, m.subject ?? 'Chef KnifeWorks', m.body, m.dedupe_key);

    if (result.ok) {
      await db
        .from('messages')
        .update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: result.providerId ?? null, last_error: null })
        .eq('id', m.id);
      if (m.template === 'review_request' && customer) {
        await db.from('customers').update({ review_requested_at: new Date().toISOString() }).eq('id', customer.id);
      }
      summary.sent++;
    } else if (result.notConfigured) {
      await requeue(addMinutes(now, 30), result.error ?? 'provider not configured', true);
    } else if (m.attempts < MAX_ATTEMPTS) {
      await requeue(addMinutes(now, 5 * m.attempts), result.error ?? 'send failed');
    } else {
      await db.from('messages').update({ status: 'failed', last_error: result.error ?? 'send failed' }).eq('id', m.id);
      summary.failed++;
    }
  }
  return summary;
}
