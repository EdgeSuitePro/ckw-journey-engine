import { describe, expect, it } from 'vitest';
import { checkGuard, type GuardContext } from './guards';
import type { Customer, Reservation } from './types';

const c = (over: Partial<Customer> = {}) =>
  ({ id: 'c1', sms_opt_in: true, marketing_opt_in: true, review_requested_at: null, review_clicked_at: null, ...over }) as Customer;
const r = (status: Reservation['status']) => ({ id: 'r1', status }) as Reservation;
const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({
  now: new Date('2026-10-20T15:00:00Z'),
  channel: 'sms',
  customer: c(),
  reservation: r('booked'),
  newerReservationCount: 0,
  ...over,
});

describe('send-time guards', () => {
  it('never texts someone who opted out, whatever the guard', () => {
    expect(checkGuard(null, ctx({ customer: c({ sms_opt_in: false }) })).ok).toBe(false);
    expect(checkGuard(null, ctx({ customer: c({ sms_opt_in: false }), channel: 'email' })).ok).toBe(true);
  });

  it('drops stale drop-off reminders once checked in or cancelled', () => {
    expect(checkGuard('reservation_booked', ctx()).ok).toBe(true);
    expect(checkGuard('reservation_booked', ctx({ reservation: r('checked_in') })).ok).toBe(false);
    expect(checkGuard('reservation_booked', ctx({ reservation: r('cancelled') })).ok).toBe(false);
  });

  it('asks for a review once, and never after they clicked', () => {
    expect(checkGuard('review_eligible', ctx()).ok).toBe(true);
    expect(checkGuard('review_eligible', ctx({ customer: c({ review_clicked_at: '2026-01-01T00:00:00Z' }) })).ok).toBe(false);
    expect(checkGuard('review_eligible', ctx({ customer: c({ review_requested_at: '2026-09-01T00:00:00Z' }) })).ok).toBe(false);
    expect(checkGuard('review_eligible', ctx({ customer: c({ review_requested_at: '2025-01-01T00:00:00Z' }) })).ok).toBe(true);
  });

  it('marketing messages need explicit consent', () => {
    expect(checkGuard('marketing_ok', ctx({ customer: c({ marketing_opt_in: false }) })).ok).toBe(false);
  });

  it('skips the re-sharpen reminder if they already rebooked', () => {
    expect(checkGuard('no_newer_reservation', ctx()).ok).toBe(true);
    expect(checkGuard('no_newer_reservation', ctx({ newerReservationCount: 1 })).ok).toBe(false);
  });
});
