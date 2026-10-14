import type { EventType, PaymentStatus, ReservationStatus } from './types';

/**
 * The only allowed moves through the shop. An event that doesn't match one of
 * these is rejected, so the journey can't skip a step or run backwards.
 */
export const TRANSITIONS: Partial<Record<EventType, { from: ReservationStatus[]; to: ReservationStatus; stamp?: string }>> = {
  'reservation.checked_in': { from: ['booked'], to: 'checked_in', stamp: 'checked_in_at' },
  'reservation.in_service': { from: ['checked_in'], to: 'in_service' },
  'reservation.ready': { from: ['checked_in', 'in_service'], to: 'ready', stamp: 'ready_at' },
  'reservation.picked_up': { from: ['ready'], to: 'picked_up', stamp: 'picked_up_at' },
  'reservation.cancelled': { from: ['booked'], to: 'cancelled', stamp: 'cancelled_at' },
  'reservation.no_show': { from: ['booked'], to: 'no_show' },
};

export function canTransition(event: EventType, current: ReservationStatus): boolean {
  const rule = TRANSITIONS[event];
  return !!rule && rule.from.includes(current);
}

/** Pickup closes the order, so it requires the bill to be settled first. */
export function canPickUp(payment: PaymentStatus): boolean {
  return payment === 'paid' || payment === 'comped';
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  booked: 'Booked',
  checked_in: 'Checked in',
  in_service: 'On the bench',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

/** Next action staff can take from each status (drives the board buttons). */
export const NEXT_ACTION: Partial<Record<ReservationStatus, { event: EventType; label: string }>> = {
  booked: { event: 'reservation.checked_in', label: 'Check in' },
  checked_in: { event: 'reservation.in_service', label: 'Start sharpening' },
  in_service: { event: 'reservation.ready', label: 'Mark ready' },
  ready: { event: 'reservation.picked_up', label: 'Picked up' },
};
