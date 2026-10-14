import { describe, expect, it } from 'vitest';
import { shopHour } from '@/lib/time';
import { planForEvent } from './planner';
import type { Customer, JourneyEvent, Reservation } from './types';

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  full_name: 'Dana Whitfield',
  phone: '+16125550100',
  email: 'dana@example.com',
  sms_opt_in: true,
  marketing_opt_in: true,
  referral_code: 'DANA-7K2Q',
  referred_by: null,
  review_requested_at: null,
  review_clicked_at: null,
  created_at: '2026-10-01T15:00:00Z',
  ...over,
});

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: 'r1',
  code: 'CKW-AB12',
  access_token: 'tok',
  customer_id: 'c1',
  // Thu Oct 15 2026, 10am–12pm Central
  window_start: '2026-10-15T15:00:00Z',
  window_end: '2026-10-15T17:00:00Z',
  status: 'booked',
  payment_status: 'unpaid',
  items: { kitchen_knives: 5 },
  item_count: 5,
  amount_due_cents: 4500,
  amount_paid_cents: null,
  payment_method: null,
  square_payment_link_url: null,
  square_order_id: null,
  source: null,
  referral_code_used: null,
  customer_notes: null,
  staff_notes: null,
  created_at: '2026-10-14T17:00:00Z',
  checked_in_at: null,
  ready_at: null,
  paid_at: null,
  picked_up_at: null,
  cancelled_at: null,
  ...over,
});

const ev = (type: JourneyEvent['type'], at = '2026-10-14T17:00:00Z', payload = {}): JourneyEvent => ({
  type,
  occurredAt: new Date(at),
  payload,
});

const templates = (p: ReturnType<typeof planForEvent>) => p.messages.map((m) => `${m.template}:${m.channel}`).sort();

describe('RESERVE', () => {
  it('confirms by text and email, schedules a reminder and a missed-drop-off nudge', () => {
    const plan = planForEvent({ event: ev('reservation.booked'), customer: customer(), reservation: reservation() });
    expect(templates(plan)).toEqual([
      'booking_confirmed:email',
      'booking_confirmed:sms',
      'dropoff_reminder:sms',
      'missed_dropoff:sms',
    ]);
    const reminder = plan.messages.find((m) => m.template === 'dropoff_reminder')!;
    expect(reminder.sendAfter.toISOString()).toBe('2026-10-15T13:00:00.000Z'); // 2h before, 8am Central
    expect(reminder.guard).toBe('reservation_booked');
  });

  it('sends early-morning reminders the evening before', () => {
    const plan = planForEvent({
      event: ev('reservation.booked'),
      customer: customer(),
      reservation: reservation({ window_start: '2026-10-15T13:00:00Z', window_end: '2026-10-15T15:00:00Z' }), // 8–10am
    });
    const reminder = plan.messages.find((m) => m.template === 'dropoff_reminder')!;
    expect(shopHour(reminder.sendAfter)).toBe(19);
  });

  it('skips the reminder when the window is less than an hour away', () => {
    const plan = planForEvent({
      event: ev('reservation.booked', '2026-10-15T11:00:00Z'),
      customer: customer(),
      reservation: reservation(),
    });
    expect(plan.messages.some((m) => m.template === 'dropoff_reminder')).toBe(true); // 10am window, booked 6am → 8am reminder ok
    const late = planForEvent({ event: ev('reservation.booked', '2026-10-15T14:30:00Z'), customer: customer(), reservation: reservation() });
    expect(late.messages.some((m) => m.template === 'dropoff_reminder')).toBe(false);
  });

  it('cancels any pending re-sharpen reminder when a customer rebooks on their own', () => {
    const plan = planForEvent({ event: ev('reservation.booked'), customer: customer(), reservation: reservation() });
    expect(plan.cancel).toContainEqual(expect.objectContaining({ scope: 'customer', templates: ['resharpen_reminder'] }));
  });

  it('respects a customer who cannot be texted', () => {
    const plan = planForEvent({ event: ev('reservation.booked'), customer: customer({ sms_opt_in: false }), reservation: reservation() });
    expect(templates(plan)).toEqual(['booking_confirmed:email']);
  });

  it('cancelling clears every queued message for that reservation', () => {
    const plan = planForEvent({ event: ev('reservation.cancelled'), customer: customer(), reservation: reservation() });
    expect(plan.cancel).toContainEqual(expect.objectContaining({ scope: 'reservation', id: 'r1', templates: [] }));
  });
});

describe('EXPERIENCE', () => {
  it('check-in cancels drop-off reminders and confirms receipt', () => {
    const plan = planForEvent({ event: ev('reservation.checked_in'), customer: customer(), reservation: reservation() });
    expect(templates(plan)).toEqual(['checked_in:sms']);
    expect(plan.cancel[0]?.templates).toEqual(['dropoff_reminder', 'missed_dropoff']);
  });

  it('ready notice includes the pay link when unpaid, and a guarded pickup nudge', () => {
    const r = reservation({ status: 'ready', square_payment_link_url: 'https://square.link/u/abc' });
    const plan = planForEvent({ event: ev('reservation.ready'), customer: customer(), reservation: r });
    const text = plan.messages.find((m) => m.template === 'ready' && m.channel === 'sms')!;
    expect(text.body).toContain('https://square.link/u/abc');
    expect(text.body).toContain('$45');
    const nudge = plan.messages.find((m) => m.template === 'pickup_nudge')!;
    expect(nudge.guard).toBe('reservation_ready');
  });

  it('ready notice omits the pay link once paid', () => {
    const r = reservation({ status: 'ready', payment_status: 'paid', square_payment_link_url: 'https://square.link/u/abc' });
    const plan = planForEvent({ event: ev('reservation.ready'), customer: customer(), reservation: r });
    expect(plan.messages.find((m) => m.channel === 'sms')!.body).not.toContain('square.link');
  });
});

describe('DELIGHT + RETURN & REFER', () => {
  const pickedUp = () =>
    planForEvent({
      event: ev('reservation.picked_up', '2026-10-16T22:00:00Z'), // Fri 5pm Central
      customer: customer(),
      reservation: reservation({ status: 'picked_up', payment_status: 'paid' }),
    });

  it('queues thank-you, review, referral invite and re-sharpen reminder', () => {
    expect(templates(pickedUp())).toEqual([
      'referral_invite:sms',
      'resharpen_reminder:sms',
      'review_request:sms',
      'thank_you_aftercare:email',
      'thank_you_aftercare:sms',
    ]);
  });

  it('every follow-up is guarded by live state at send time', () => {
    const byTemplate = Object.fromEntries(pickedUp().messages.map((m) => [m.template, m]));
    expect(byTemplate.review_request.guard).toBe('review_eligible');
    expect(byTemplate.referral_invite.guard).toBe('marketing_ok');
    expect(byTemplate.resharpen_reminder.guard).toBe('no_newer_reservation');
  });

  it('times follow-ups sensibly', () => {
    const byTemplate = Object.fromEntries(pickedUp().messages.map((m) => [m.template, m]));
    expect(byTemplate.review_request.sendAfter.toISOString()).toBe('2026-10-18T15:30:00.000Z'); // +2 days, 10:30am
    expect(byTemplate.resharpen_reminder.sendAfter.toISOString()).toBe('2027-01-14T16:00:00.000Z'); // +90 days, 10am CST
  });

  it('dedupe keys are stable so a repeated event never double-sends', () => {
    const a = pickedUp().messages.map((m) => m.dedupeKey).sort();
    const b = pickedUp().messages.map((m) => m.dedupeKey).sort();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('falls back to email for follow-ups when the customer has no mobile', () => {
    const plan = planForEvent({
      event: ev('reservation.picked_up'),
      customer: customer({ phone: null }),
      reservation: reservation({ status: 'picked_up' }),
    });
    expect(templates(plan)).toEqual(['referral_invite:email', 'resharpen_reminder:email', 'thank_you_aftercare:email']);
  });

  it('thanks the referrer when a referral qualifies', () => {
    const plan = planForEvent({
      event: ev('referral.qualified', undefined, { referral_id: 'ref1' }),
      customer: customer(),
      friendFirstName: 'Sam',
    });
    expect(plan.messages[0]?.body).toContain('Sam');
    expect(plan.messages[0]?.dedupeKey).toBe('referral:ref1:qualified:sms');
  });
});
