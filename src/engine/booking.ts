import 'server-only';
import { addDays } from 'date-fns';
import { z } from 'zod';
import { JOURNEY } from '@/lib/config';
import { accessToken, referralCode, reservationCode } from '@/lib/codes';
import { toE164 } from '@/lib/phone';
import { admin } from '@/lib/supabase/admin';
import { ITEM_TYPES } from '@/lib/items';
import { buildSlots, type DropWindowRule, type Slot } from '@/lib/windows';
import { JourneyError, recordEvent } from './engine';
import type { Customer, Reservation } from './types';

export { ITEM_TYPES };

export async function availability(days = JOURNEY.bookingHorizonDays, now = new Date()): Promise<Slot[]> {
  const db = admin();
  const [rules, blackouts, taken] = await Promise.all([
    db.from('drop_windows').select('weekday, start_time, end_time, capacity, active'),
    db.from('blackout_dates').select('day').gte('day', now.toISOString().slice(0, 10)),
    db.rpc('window_bookings', { p_from: now.toISOString(), p_to: addDays(now, days + 1).toISOString() }),
  ]);
  if (rules.error) throw new JourneyError(rules.error.message, 'db');
  const takenMap: Record<string, number> = {};
  for (const row of (taken.data ?? []) as { window_start: string; taken: number }[]) {
    takenMap[new Date(row.window_start).toISOString()] = row.taken;
  }
  return buildSlots({
    rules: (rules.data ?? []) as DropWindowRule[],
    blackouts: ((blackouts.data ?? []) as { day: string }[]).map((b) => b.day),
    taken: takenMap,
    now,
    days,
    minLeadMinutes: JOURNEY.minLeadMinutes,
  });
}

export const BookingInput = z.object({
  fullName: z.string().trim().min(1, 'Please add your name').max(120),
  phone: z.string().trim().min(7, 'Please add a mobile number'),
  email: z.string().trim().email('That email looks off').max(200).optional().or(z.literal('')),
  windowStart: z.string().datetime(),
  items: z.record(z.string(), z.number().int().min(0).max(200)).default({}),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  marketingOptIn: z.boolean().default(false),
  referralCode: z.string().trim().max(40).optional().or(z.literal('')),
  source: z.string().trim().max(60).optional().or(z.literal('')),
  utm: z.record(z.string(), z.string().max(200)).default({}),
});
export type BookingInput = z.infer<typeof BookingInput>;

export class BookingError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
  }
}

/** Find a returning customer by phone (then email), or create a new one. */
async function upsertCustomer(input: BookingInput, phone: string): Promise<{ customer: Customer; isNew: boolean }> {
  const db = admin();
  const email = input.email ? input.email.toLowerCase() : null;

  let { data: found } = await db.from('customers').select('*').eq('phone', phone).maybeSingle();
  if (!found && email) {
    ({ data: found } = await db.from('customers').select('*').ilike('email', email).maybeSingle());
  }

  if (found) {
    const patch: Record<string, unknown> = {};
    if (email && !found.email) patch.email = email;
    if (!found.phone) patch.phone = phone;
    if (input.marketingOptIn && !found.marketing_opt_in) patch.marketing_opt_in = true;
    if (Object.keys(patch).length) {
      const { data } = await db.from('customers').update(patch).eq('id', found.id).select('*').single();
      found = data ?? found;
    }
    return { customer: found as Customer, isNew: false };
  }

  // New customer — attribute the referral, if any.
  let referredBy: string | null = null;
  if (input.referralCode) {
    const { data: referrer } = await db
      .from('customers')
      .select('id')
      .eq('referral_code', input.referralCode.toUpperCase())
      .maybeSingle();
    referredBy = referrer?.id ?? null;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db
      .from('customers')
      .insert({
        full_name: input.fullName,
        phone,
        email,
        marketing_opt_in: input.marketingOptIn,
        referral_code: referralCode(input.fullName),
        referred_by: referredBy,
        first_source: input.source || (referredBy ? 'referral' : null),
        first_utm: input.utm,
      })
      .select('*')
      .single();
    if (!error) return { customer: data as Customer, isNew: true };
    if (error.code !== '23505' || !error.message.includes('referral_code')) {
      if (error.code === '23505') throw new BookingError('That email is already on file with a different phone number.', 'email');
      throw new JourneyError(error.message, 'db');
    }
  }
  throw new JourneyError('Could not generate a referral code', 'db');
}

export async function createReservation(raw: unknown): Promise<Reservation> {
  const parsed = BookingInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BookingError(issue?.message ?? 'Please check the form', String(issue?.path[0] ?? ''));
  }
  const input = parsed.data;
  const phone = toE164(input.phone);
  if (!phone) throw new BookingError('Please enter a 10-digit US mobile number', 'phone');

  // The window must be a real, open slot on the current schedule.
  const slots = await availability();
  const slot = slots.find((s) => s.start === new Date(input.windowStart).toISOString());
  if (!slot) throw new BookingError('That drop-off window is no longer available — please pick another.', 'windowStart');
  if (slot.remaining <= 0) throw new BookingError('That window just filled up — please pick another.', 'windowStart');

  const { customer, isNew } = await upsertCustomer(input, phone);
  const db = admin();

  const items = Object.fromEntries(Object.entries(input.items).filter(([k, v]) => k in ITEM_TYPES && v > 0));
  const itemCount = Object.values(items).reduce((a, b) => a + b, 0);

  const { count: priorCount } = await db
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customer.id)
    .eq('status', 'picked_up');

  let reservation: Reservation | null = null;
  for (let attempt = 0; attempt < 4 && !reservation; attempt++) {
    const { data, error } = await db.rpc('book_reservation', {
      p_customer_id: customer.id,
      p_window_start: slot.start,
      p_window_end: slot.end,
      p_capacity: slot.capacity,
      p_code: reservationCode(),
      p_access_token: accessToken(),
      p_items: items,
      p_item_count: itemCount,
      p_source: input.source || (!isNew ? 'returning' : customer.referred_by ? 'referral' : 'direct'),
      p_utm: input.utm,
      p_referral_code_used: input.referralCode || null,
      p_customer_notes: input.notes || null,
    });
    if (error?.message.includes('window_full')) throw new BookingError('That window just filled up — please pick another.', 'windowStart');
    if (error && error.code === '23505') continue; // code collision — try a new one
    if (error) throw new JourneyError(error.message, 'db');
    reservation = data as Reservation;
  }
  if (!reservation) throw new JourneyError('Could not create reservation', 'db');

  if (isNew) {
    await recordEvent({
      type: 'customer.created',
      customerId: customer.id,
      actor: 'customer',
      idempotencyKey: `customer:${customer.id}:created`,
      payload: { source: customer.referred_by ? 'referral' : input.source || 'direct', utm: input.utm },
    });
    if (customer.referred_by) {
      await db.from('referrals').upsert(
        { referrer_id: customer.referred_by, referred_id: customer.id, first_reservation_id: reservation.id },
        { onConflict: 'referred_id', ignoreDuplicates: true },
      );
    }
  }

  await recordEvent({
    type: 'reservation.booked',
    customerId: customer.id,
    reservationId: reservation.id,
    actor: 'customer',
    idempotencyKey: `reservation:${reservation.id}:booked`,
    payload: {
      is_repeat: (priorCount ?? 0) > 0,
      source: input.source || null,
      item_count: itemCount,
      ...(isNew && customer.referred_by ? { referred_by: customer.referred_by } : {}),
    },
  });

  return reservation;
}
