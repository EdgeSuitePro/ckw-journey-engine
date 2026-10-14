import { BUSINESS, JOURNEY, appUrl } from '@/lib/config';
import { fmtDay, fmtSlot } from '@/lib/time';
import type { Customer, Reservation } from './types';

/**
 * Every customer-facing word lives here, so tone can be tuned in one place.
 * SMS bodies stay under ~300 characters (2 segments).
 */

export const firstName = (c: Pick<Customer, 'full_name'>) => c.full_name.trim().split(/\s+/)[0] ?? '';

export const links = {
  order: (r: Pick<Reservation, 'access_token'>) => appUrl(`/o/${r.access_token}`),
  reserve: (c?: Pick<Customer, 'referral_code'>) => appUrl(c ? `/reserve?rebook=${c.referral_code}` : '/reserve'),
  refer: (c: Pick<Customer, 'referral_code'>) => appUrl(`/r/${c.referral_code}`),
  review: (r: Pick<Reservation, 'access_token'>) => appUrl(`/go/review/${r.access_token}`),
};

const money = (cents: number | null | undefined) =>
  cents == null ? '' : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

const STOP = 'Reply STOP to opt out.';

export const sms = {
  booking_confirmed: (c: Customer, r: Reservation) =>
    `Hi ${firstName(c)}, you're booked with ${BUSINESS.name}: drop-off ${fmtSlot(r.window_start, r.window_end)}. ` +
    `Your order page (directions + status): ${links.order(r)} ${STOP}`,

  dropoff_reminder: (c: Customer, r: Reservation) =>
    `Reminder ${firstName(c)}: your knife drop-off window is ${fmtSlot(r.window_start, r.window_end)}. ` +
    `Need to change it? ${links.order(r)}`,

  missed_dropoff: (c: Customer, r: Reservation) =>
    `Hi ${firstName(c)}, looks like we missed you today — no problem. Pick a new drop-off window here: ${links.order(r)}`,

  booking_cancelled: () =>
    `Your ${BUSINESS.name} reservation is cancelled. Whenever you're ready: ${links.reserve()}`,

  checked_in: (c: Customer, r: Reservation) =>
    `Got them, ${firstName(c)}! ${r.item_count > 0 ? `${r.item_count} item${r.item_count === 1 ? '' : 's'} checked in. ` : ''}` +
    `We'll text you the moment they're ready. Track it: ${links.order(r)}`,

  ready: (c: Customer, r: Reservation) => {
    const pay =
      r.payment_status === 'paid' || r.payment_status === 'comped'
        ? 'You\'re all paid up.'
        : r.square_payment_link_url
          ? `Total ${money(r.amount_due_cents)} — pay ahead: ${r.square_payment_link_url}`
          : r.amount_due_cents
            ? `Total ${money(r.amount_due_cents)}.`
            : '';
    return `${firstName(c)}, your knives are sharp and ready for pickup! ${pay} Details: ${links.order(r)}`.replace(/\s+/g, ' ');
  },

  pickup_nudge: (c: Customer, r: Reservation) =>
    `Hi ${firstName(c)}, your sharpened knives are still waiting for you. Pickup details: ${links.order(r)}`,

  payment_received: (c: Customer, r: Reservation) =>
    `Payment received${r.amount_paid_cents ? ` (${money(r.amount_paid_cents)})` : ''} — thank you, ${firstName(c)}!`,

  thank_you_aftercare: (c: Customer) =>
    `Thanks for trusting us with your knives, ${firstName(c)}. Keep that edge: hand-wash, dry right away, ` +
    `cut on wood or plastic (never glass or stone), and store them guarded. ${BUSINESS.signoff}`,

  review_request: (c: Customer, r: Reservation) =>
    `${firstName(c)}, how are those edges treating you? If you have 30 seconds, a Google review helps a small ` +
    `local shop more than you'd think: ${links.review(r)} ${STOP}`,

  referral_invite: (c: Customer) =>
    `Know someone with dull knives? Share your link — they get ${JOURNEY.referralReward} their first sharpening ` +
    `and you get ${JOURNEY.referralReward} your next one: ${links.refer(c)} ${STOP}`,

  resharpen_reminder: (c: Customer, r: Reservation) =>
    `Hi ${firstName(c)}, it's been about ${Math.round(JOURNEY.resharpenAfterDays / 30)} months since your last ` +
    `sharpening (${fmtDay(r.picked_up_at ?? r.window_start)}). Ready for a fresh edge? Book in a minute: ` +
    `${links.reserve(c)} ${STOP}`,

  referral_qualified: (c: Customer, friendFirstName: string) =>
    `Good news ${firstName(c)} — ${friendFirstName || 'your friend'} just picked up their first sharpening. ` +
    `You've earned ${JOURNEY.referralReward} your next visit. Thank you!`,
};

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface Email {
  subject: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function emailLayout(title: string, paragraphs: string[], cta?: { label: string; href: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.55">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:24px 0"><a href="${esc(cta.href)}" style="background:#111111;color:#FAF9F5;` +
      `padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#FAF9F5;font-family:Montserrat,Helvetica,Arial,sans-serif;color:#111111">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<div style="font-weight:700;letter-spacing:.18em;font-size:12px;color:#C6925B;margin-bottom:24px">CHEF KNIFEWORKS</div>
<h1 style="font-size:22px;margin:0 0 20px">${esc(title)}</h1>${body}${button}
<hr style="border:none;border-top:1px solid #e4e0d8;margin:32px 0 16px">
<p style="font-size:12px;color:#8B9A88;margin:0">${esc(BUSINESS.name)} · ${esc(BUSINESS.address)}</p>
</div></body></html>`;
}

export const email = {
  booking_confirmed: (c: Customer, r: Reservation): Email => ({
    subject: `You're booked — drop-off ${fmtSlot(r.window_start, r.window_end)}`,
    html: emailLayout(
      `See you ${fmtDay(r.window_start)}, ${esc(firstName(c))}`,
      [
        `Your drop-off window is <strong>${esc(fmtSlot(r.window_start, r.window_end))}</strong>. Confirmation code <strong>${esc(r.code)}</strong>.`,
        `Bring your knives wrapped in a towel or in a sleeve. Your order page has directions and live status — we'll text you the moment everything is ready.`,
      ],
      { label: 'View my order', href: links.order(r) },
    ),
  }),

  ready: (c: Customer, r: Reservation): Email => ({
    subject: 'Your knives are ready for pickup',
    html: emailLayout(
      `Ready when you are, ${esc(firstName(c))}`,
      [
        `Everything is sharpened, checked, and waiting for you.`,
        r.payment_status === 'paid' || r.payment_status === 'comped'
          ? `You're all paid up.`
          : r.amount_due_cents
            ? `Your total is <strong>${money(r.amount_due_cents)}</strong>.${r.square_payment_link_url ? ` You can pay ahead so pickup is a quick grab-and-go.` : ''}`
            : '',
      ].filter(Boolean),
      r.square_payment_link_url && r.payment_status !== 'paid'
        ? { label: 'Pay now', href: r.square_payment_link_url }
        : { label: 'Pickup details', href: links.order(r) },
    ),
  }),

  thank_you_aftercare: (c: Customer, r: Reservation): Email => ({
    subject: 'Keeping that edge sharp',
    html: emailLayout(
      `Thank you, ${esc(firstName(c))}`,
      [
        `Thanks for bringing your knives to us. A few habits keep a fresh edge lasting for months:`,
        `<strong>Hand-wash and dry immediately.</strong> Dishwashers dull and chip edges.<br>` +
          `<strong>Cut on wood or plastic.</strong> Glass, stone, and ceramic boards roll an edge in minutes.<br>` +
          `<strong>Hone, don't grind.</strong> A few light strokes on a honing rod before use keeps the edge aligned.<br>` +
          `<strong>Store them guarded.</strong> A block, magnetic strip, or sleeve — never loose in a drawer.`,
        `Most home kitchens are ready for a touch-up in about ${Math.round(JOURNEY.resharpenAfterDays / 30)} months. We'll send a friendly reminder if you'd like one.`,
      ],
      { label: 'Leave a quick review', href: links.review(r) },
    ),
  }),

  referral_invite: (c: Customer): Email => ({
    subject: `Give ${JOURNEY.referralReward}, get ${JOURNEY.referralReward}`,
    html: emailLayout(
      `Share a sharp edge`,
      [
        `Know someone fighting a dull knife? Send them your link. They get <strong>${esc(JOURNEY.referralReward)}</strong> their first sharpening, and you get <strong>${esc(JOURNEY.referralReward)}</strong> your next one.`,
      ],
      { label: 'Get my referral link', href: links.refer(c) },
    ),
  }),

  resharpen_reminder: (c: Customer): Email => ({
    subject: 'Time for a fresh edge?',
    html: emailLayout(
      `Ready for a touch-up, ${esc(firstName(c))}?`,
      [`It's been about ${Math.round(JOURNEY.resharpenAfterDays / 30)} months since your last sharpening. Booking takes about a minute.`],
      { label: 'Book a drop-off', href: links.reserve(c) },
    ),
  }),
};
