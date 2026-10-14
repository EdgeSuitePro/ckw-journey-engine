import { subDays } from 'date-fns';
import { JOURNEY } from '@/lib/config';
import type { Channel, Customer, GuardName, Reservation } from './types';

export interface GuardContext {
  now: Date;
  channel: Channel;
  customer: Customer | null;
  reservation: Reservation | null;
  /** Reservations this customer created after the message's reservation. */
  newerReservationCount: number;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Send-time checks. A message planned days ago is re-validated against the
 * live state right before it goes out — this is what makes reminders safe.
 */
export function checkGuard(guard: GuardName | null | undefined, ctx: GuardContext): GuardResult {
  const { customer: c, reservation: r } = ctx;

  // Universal rule: someone who opted out of texts never gets one.
  if (ctx.channel === 'sms' && c && !c.sms_opt_in) return { ok: false, reason: 'customer opted out of texts' };

  switch (guard ?? null) {
    case null:
      return { ok: true };

    case 'reservation_booked':
      return r?.status === 'booked' ? { ok: true } : { ok: false, reason: `reservation is ${r?.status ?? 'missing'}` };

    case 'reservation_ready':
      return r?.status === 'ready' ? { ok: true } : { ok: false, reason: `reservation is ${r?.status ?? 'missing'}` };

    case 'review_eligible': {
      if (!c) return { ok: false, reason: 'customer missing' };
      if (c.review_clicked_at) return { ok: false, reason: 'customer already opened the review link' };
      if (c.review_requested_at && new Date(c.review_requested_at) > subDays(ctx.now, JOURNEY.reviewCooldownDays)) {
        return { ok: false, reason: 'review already requested recently' };
      }
      return { ok: true };
    }

    case 'marketing_ok':
      return c?.marketing_opt_in ? { ok: true } : { ok: false, reason: 'no marketing consent' };

    case 'no_newer_reservation': {
      if (!c?.marketing_opt_in) return { ok: false, reason: 'no marketing consent' };
      return ctx.newerReservationCount === 0
        ? { ok: true }
        : { ok: false, reason: 'customer already rebooked' };
    }

    default:
      return { ok: false, reason: `unknown guard ${String(guard)}` };
  }
}
