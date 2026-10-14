'use server';

import { revalidatePath } from 'next/cache';
import { JourneyError } from '@/engine/engine';
import { advance, markPaid } from '@/engine/operations';
import type { EventType } from '@/engine/types';
import { requireStaff } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

const ALLOWED: EventType[] = [
  'reservation.checked_in',
  'reservation.in_service',
  'reservation.ready',
  'reservation.picked_up',
  'reservation.cancelled',
  'reservation.no_show',
];

function toCents(value: FormDataEntryValue | null): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Math.round(Number(String(value).replace(/[^0-9.]/g, '')) * 100);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function advanceAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const id = String(form.get('reservationId'));
  const type = String(form.get('event')) as EventType;
  if (!ALLOWED.includes(type)) return { ok: false, error: 'Unknown action' };
  try {
    await advance(id, type, `staff:${staff.id}`, { amountCents: toCents(form.get('amount')) });
    revalidatePath('/staff');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof JourneyError ? err.message : 'Something went wrong' };
  }
}

export async function markPaidAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const id = String(form.get('reservationId'));
  const method = String(form.get('method')) as 'card_in_person' | 'cash' | 'check' | 'comped';
  if (!['card_in_person', 'cash', 'check', 'comped'].includes(method)) return { ok: false, error: 'Pick a payment method' };
  const amountCents = method === 'comped' ? 0 : toCents(form.get('amount'));
  if (amountCents == null) return { ok: false, error: 'Enter the amount collected' };
  try {
    await markPaid(id, `staff:${staff.id}`, { method, amountCents });
    revalidatePath('/staff');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof JourneyError ? err.message : 'Something went wrong' };
  }
}
