export type ReservationStatus =
  | 'booked'
  | 'checked_in'
  | 'in_service'
  | 'ready'
  | 'picked_up'
  | 'cancelled'
  | 'no_show';

export type PaymentStatus = 'unpaid' | 'link_sent' | 'paid' | 'comped' | 'refunded';
export type Stage = 'discover' | 'reserve' | 'experience' | 'delight' | 'return_refer';
export type Channel = 'sms' | 'email';

export const EVENT_STAGE = {
  'customer.created': 'discover',
  'reservation.booked': 'reserve',
  'reservation.cancelled': 'reserve',
  'reservation.no_show': 'reserve',
  'reservation.checked_in': 'experience',
  'reservation.in_service': 'experience',
  'reservation.ready': 'experience',
  'payment.link_sent': 'experience',
  'payment.received': 'experience',
  'reservation.picked_up': 'experience',
  'review.clicked': 'delight',
  'referral.qualified': 'return_refer',
  'campaign.queued': 'return_refer',
} as const satisfies Record<string, Stage>;

export type EventType = keyof typeof EVENT_STAGE;

export type GuardName =
  | 'reservation_booked'
  | 'reservation_ready'
  | 'review_eligible'
  | 'marketing_ok'
  | 'no_newer_reservation';

export interface Customer {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  sms_opt_in: boolean;
  marketing_opt_in: boolean;
  referral_code: string;
  referred_by: string | null;
  review_requested_at: string | null;
  review_clicked_at: string | null;
  created_at: string;
}

export interface Reservation {
  id: string;
  code: string;
  access_token: string;
  customer_id: string;
  window_start: string;
  window_end: string;
  status: ReservationStatus;
  payment_status: PaymentStatus;
  items: Record<string, number>;
  item_count: number;
  amount_due_cents: number | null;
  amount_paid_cents: number | null;
  payment_method: string | null;
  square_payment_link_url: string | null;
  square_order_id: string | null;
  source: string | null;
  referral_code_used: string | null;
  customer_notes: string | null;
  staff_notes: string | null;
  created_at: string;
  checked_in_at: string | null;
  ready_at: string | null;
  paid_at: string | null;
  picked_up_at: string | null;
  cancelled_at: string | null;
}

export interface JourneyEvent {
  type: EventType;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface PlannedMessage {
  template: string;
  stage: Stage;
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  sendAfter: Date;
  guard?: GuardName;
  /** Defer texts that would land between 8pm and 9am Central. */
  quietHours: boolean;
  dedupeKey: string;
}

export interface CancelInstruction {
  scope: 'reservation' | 'customer';
  id: string;
  /** Templates to cancel; empty = every queued message in scope. */
  templates: string[];
  reason: string;
}

export interface Plan {
  messages: PlannedMessage[];
  cancel: CancelInstruction[];
}
