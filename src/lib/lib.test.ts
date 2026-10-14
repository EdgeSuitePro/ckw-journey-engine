import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canPickUp, canTransition } from '@/engine/stateMachine';
import { parsePaymentEvent, verifySquareSignature } from '@/providers/square';
import { toE164 } from './phone';
import { fmtWindow, respectQuietHours, shopHour } from './time';
import { buildSlots } from './windows';

describe('phone', () => {
  it('normalises common US formats', () => {
    expect(toE164('(612) 555-0100')).toBe('+16125550100');
    expect(toE164('1-612-555-0100')).toBe('+16125550100');
    expect(toE164('555-0100')).toBeNull();
    expect(toE164('(012) 555-0100')).toBeNull();
  });
});

describe('time', () => {
  it('formats 2-hour windows', () => {
    expect(fmtWindow('2026-10-15T15:00:00Z', '2026-10-15T17:00:00Z')).toBe('10am–12pm');
    expect(fmtWindow('2026-10-15T19:00:00Z', '2026-10-15T21:00:00Z')).toBe('2–4pm');
  });
  it('moves late-night texts to 9am', () => {
    const late = respectQuietHours(new Date('2026-10-16T03:30:00Z')); // 10:30pm Central
    expect(shopHour(late)).toBe(9);
    expect(late.toISOString()).toBe('2026-10-16T14:00:00.000Z');
    const ok = new Date('2026-10-16T17:00:00Z');
    expect(respectQuietHours(ok)).toBe(ok);
  });
});

describe('windows', () => {
  const rules = [
    { weekday: 4, start_time: '10:00:00', end_time: '12:00:00', capacity: 3, active: true },
    { weekday: 4, start_time: '08:00:00', end_time: '10:00:00', capacity: 3, active: true },
    { weekday: 5, start_time: '08:00:00', end_time: '10:00:00', capacity: 3, active: false },
  ];
  it('expands rules into dated slots with remaining capacity', () => {
    const slots = buildSlots({
      rules,
      blackouts: [],
      taken: { '2026-10-15T15:00:00.000Z': 2 },
      now: new Date('2026-10-14T17:00:00Z'), // Wed noon
      days: 3,
      minLeadMinutes: 30,
    });
    expect(slots.map((s) => [s.start, s.remaining])).toEqual([
      ['2026-10-15T13:00:00.000Z', 3],
      ['2026-10-15T15:00:00.000Z', 1],
    ]);
  });
  it('honours blackouts and lead time', () => {
    expect(buildSlots({ rules, blackouts: ['2026-10-15'], taken: {}, now: new Date('2026-10-14T17:00:00Z'), days: 3, minLeadMinutes: 30 })).toEqual([]);
    const sameDay = buildSlots({ rules, blackouts: [], taken: {}, now: new Date('2026-10-15T14:45:00Z'), days: 1, minLeadMinutes: 30 });
    expect(sameDay).toEqual([]);
  });
});

describe('state machine', () => {
  it('only allows forward moves', () => {
    expect(canTransition('reservation.checked_in', 'booked')).toBe(true);
    expect(canTransition('reservation.picked_up', 'booked')).toBe(false);
    expect(canTransition('reservation.cancelled', 'ready')).toBe(false);
  });
  it('requires payment before pickup', () => {
    expect(canPickUp('unpaid')).toBe(false);
    expect(canPickUp('paid')).toBe(true);
    expect(canPickUp('comped')).toBe(true);
  });
});

describe('square webhook', () => {
  it('verifies signatures', () => {
    const url = 'https://example.com/api/webhooks/square';
    const body = '{"event_id":"e1"}';
    const sig = createHmac('sha256', 'k').update(url + body).digest('base64');
    expect(verifySquareSignature(body, sig, url, 'k')).toBe(true);
    expect(verifySquareSignature(body + ' ', sig, url, 'k')).toBe(false);
    expect(verifySquareSignature(body, null, url, 'k')).toBe(false);
  });
  it('parses payment events', () => {
    const parsed = parsePaymentEvent({
      event_id: 'e1',
      type: 'payment.updated',
      data: { object: { payment: { id: 'p1', order_id: 'o1', status: 'COMPLETED', total_money: { amount: 5000 }, tip_money: { amount: 500 } } } },
    });
    expect(parsed).toEqual({ eventId: 'e1', paymentId: 'p1', orderId: 'o1', status: 'COMPLETED', amountCents: 5000, tipCents: 500 });
  });
});
