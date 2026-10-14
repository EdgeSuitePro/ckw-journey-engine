import { addHours, addMinutes, subHours } from 'date-fns';
import { JOURNEY } from '@/lib/config';
import { daysLaterAt, shopDate, shopHour, shopTime } from '@/lib/time';
import { email, sms } from './templates';
import type { Customer, JourneyEvent, Plan, PlannedMessage, Reservation, Stage } from './types';

/**
 * The journey rulebook. Given one verified event, decide which messages to
 * queue and which queued messages are now obsolete.
 *
 * Pure function: no database, no clock (uses event.occurredAt), fully testable.
 * Every message gets a dedupe key, so recording the same event twice is safe.
 */
export function planForEvent(input: {
  event: JourneyEvent;
  customer: Customer;
  reservation?: Reservation | null;
  /** For referral.qualified: the friend whose pickup earned the reward. */
  friendFirstName?: string;
}): Plan {
  const { event, customer: c, reservation: r } = input;
  const now = event.occurredAt;
  const plan: Plan = { messages: [], cancel: [] };

  const canText = !!c.phone && c.sms_opt_in;
  const canEmail = !!c.email;

  const add = (m: Omit<PlannedMessage, 'recipient' | 'stage'> & { stage: Stage }) => {
    const recipient = m.channel === 'sms' ? c.phone : c.email;
    if (!recipient) return;
    plan.messages.push({ ...m, recipient });
  };

  /** Prefer a text; fall back to email when we can't text. */
  const textOrEmail = (
    base: { template: string; stage: Stage; sendAfter: Date; guard?: PlannedMessage['guard']; key: string },
    smsBody: string,
    mail?: { subject: string; html: string },
  ) => {
    if (canText) {
      add({ ...base, channel: 'sms', body: smsBody, quietHours: true, dedupeKey: `${base.key}:sms` });
    } else if (canEmail && mail) {
      add({ ...base, channel: 'email', subject: mail.subject, body: mail.html, quietHours: false, dedupeKey: `${base.key}:email` });
    }
  };

  switch (event.type) {
    // ---------------------------------------------------------------- RESERVE
    case 'reservation.booked': {
      if (!r) break;
      const key = `res:${r.id}`;
      if (canText) {
        add({ template: 'booking_confirmed', stage: 'reserve', channel: 'sms', body: sms.booking_confirmed(c, r),
          sendAfter: now, quietHours: false, dedupeKey: `${key}:booking_confirmed:sms` });
      }
      if (canEmail) {
        const m = email.booking_confirmed(c, r);
        add({ template: 'booking_confirmed', stage: 'reserve', channel: 'email', subject: m.subject, body: m.html,
          sendAfter: now, quietHours: false, dedupeKey: `${key}:booking_confirmed:email` });
      }

      // Reminder 2 hours before the window; early-morning windows get it at 7pm the night before.
      const start = new Date(r.window_start);
      let remindAt = subHours(start, 2);
      if (shopHour(remindAt) < 8) remindAt = shopTime(shopDate(subHours(start, 24)), '19:00');
      if (canText && remindAt.getTime() - now.getTime() > 60 * 60 * 1000) {
        add({ template: 'dropoff_reminder', stage: 'reserve', channel: 'sms', body: sms.dropoff_reminder(c, r),
          sendAfter: remindAt, guard: 'reservation_booked', quietHours: false, dedupeKey: `${key}:dropoff_reminder:sms` });
      }

      // If the window passes and they never checked in, a no-pressure rebook nudge.
      if (canText) {
        add({ template: 'missed_dropoff', stage: 'reserve', channel: 'sms', body: sms.missed_dropoff(c, r),
          sendAfter: addMinutes(new Date(r.window_end), 90), guard: 'reservation_booked', quietHours: true,
          dedupeKey: `${key}:missed_dropoff:sms` });
      }

      // They came back on their own — the re-sharpen reminder has done its job.
      plan.cancel.push({ scope: 'customer', id: c.id, templates: ['resharpen_reminder'], reason: 'customer rebooked' });
      break;
    }

    case 'reservation.cancelled': {
      if (!r) break;
      plan.cancel.push({ scope: 'reservation', id: r.id, templates: [], reason: 'reservation cancelled' });
      if (canText) {
        add({ template: 'booking_cancelled', stage: 'reserve', channel: 'sms', body: sms.booking_cancelled(),
          sendAfter: now, quietHours: false, dedupeKey: `res:${r.id}:booking_cancelled:sms` });
      }
      break;
    }

    case 'reservation.no_show': {
      if (!r) break;
      plan.cancel.push({ scope: 'reservation', id: r.id, templates: ['dropoff_reminder'], reason: 'marked no-show' });
      break;
    }

    // ------------------------------------------------------------- EXPERIENCE
    case 'reservation.checked_in': {
      if (!r) break;
      plan.cancel.push({ scope: 'reservation', id: r.id, templates: ['dropoff_reminder', 'missed_dropoff'], reason: 'checked in' });
      if (canText) {
        add({ template: 'checked_in', stage: 'experience', channel: 'sms', body: sms.checked_in(c, r),
          sendAfter: now, quietHours: false, dedupeKey: `res:${r.id}:checked_in:sms` });
      }
      break;
    }

    case 'reservation.ready': {
      if (!r) break;
      const key = `res:${r.id}`;
      if (canText) {
        add({ template: 'ready', stage: 'experience', channel: 'sms', body: sms.ready(c, r),
          sendAfter: now, quietHours: true, dedupeKey: `${key}:ready:sms` });
      }
      if (canEmail) {
        const m = email.ready(c, r);
        add({ template: 'ready', stage: 'experience', channel: 'email', subject: m.subject, body: m.html,
          sendAfter: now, quietHours: false, dedupeKey: `${key}:ready:email` });
      }
      if (canText) {
        add({ template: 'pickup_nudge', stage: 'experience', channel: 'sms', body: sms.pickup_nudge(c, r),
          sendAfter: addHours(now, JOURNEY.pickupNudgeAfterHours), guard: 'reservation_ready', quietHours: true,
          dedupeKey: `${key}:pickup_nudge:sms` });
      }
      break;
    }

    case 'payment.received': {
      if (!r) break;
      if (canText) {
        add({ template: 'payment_received', stage: 'experience', channel: 'sms', body: sms.payment_received(c, r),
          sendAfter: now, quietHours: false, dedupeKey: `res:${r.id}:payment_received:sms` });
      }
      break;
    }

    // ------------------------------------------------- DELIGHT → RETURN & REFER
    case 'reservation.picked_up': {
      if (!r) break;
      const key = `res:${r.id}`;
      plan.cancel.push({ scope: 'reservation', id: r.id, templates: ['pickup_nudge'], reason: 'picked up' });

      // Delight: aftercare + thank-you, two hours after they walk out.
      const thanksAt = addHours(now, 2);
      if (canText) {
        add({ template: 'thank_you_aftercare', stage: 'delight', channel: 'sms', body: sms.thank_you_aftercare(c),
          sendAfter: thanksAt, quietHours: true, dedupeKey: `${key}:thank_you_aftercare:sms` });
      }
      if (canEmail) {
        const m = email.thank_you_aftercare(c, r);
        add({ template: 'thank_you_aftercare', stage: 'delight', channel: 'email', subject: m.subject, body: m.html,
          sendAfter: thanksAt, quietHours: false, dedupeKey: `${key}:thank_you_aftercare:email` });
      }

      // Delight: review request once they've cooked with the new edge. Guard
      // enforces "once per customer per cooldown" and "not if already clicked".
      if (canText) {
        add({ template: 'review_request', stage: 'delight', channel: 'sms', body: sms.review_request(c, r),
          sendAfter: daysLaterAt(now, JOURNEY.reviewAfterDays, '10:30'), guard: 'review_eligible', quietHours: true,
          dedupeKey: `${key}:review_request:sms` });
      }

      // Refer: invite to share their link (marketing → requires opt-in).
      textOrEmail(
        { template: 'referral_invite', stage: 'return_refer', key: `cust:${c.id}:referral_invite`,
          sendAfter: daysLaterAt(now, JOURNEY.referralInviteAfterDays, '11:00'), guard: 'marketing_ok' },
        sms.referral_invite(c),
        email.referral_invite(c),
      );

      // Return: re-sharpen reminder. One per completed order; suppressed if they rebook first.
      textOrEmail(
        { template: 'resharpen_reminder', stage: 'return_refer', key: `${key}:resharpen_reminder`,
          sendAfter: daysLaterAt(now, JOURNEY.resharpenAfterDays, '10:00'), guard: 'no_newer_reservation' },
        sms.resharpen_reminder(c, r),
        email.resharpen_reminder(c),
      );
      break;
    }

    case 'referral.qualified': {
      // Here `customer` is the REFERRER being thanked.
      if (canText) {
        add({ template: 'referral_qualified', stage: 'return_refer', channel: 'sms',
          body: sms.referral_qualified(c, input.friendFirstName ?? ''), sendAfter: now, quietHours: true,
          dedupeKey: `referral:${String(event.payload.referral_id)}:qualified:sms` });
      }
      break;
    }

    default:
      break;
  }

  return plan;
}
