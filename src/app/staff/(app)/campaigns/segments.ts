import 'server-only';
import { subDays } from 'date-fns';
import { admin } from '@/lib/supabase/admin';

export const SEGMENTS = {
  all_opted_in: 'Everyone who opted in to reminders',
  lapsed_90: 'Last sharpening 90+ days ago',
  lapsed_180: 'Last sharpening 180+ days ago',
  one_and_done: 'Came once, never returned',
} as const;
export type Segment = keyof typeof SEGMENTS;

export interface Recipient {
  id: string;
  full_name: string;
  phone: string;
}

/** Only customers with marketing consent and a textable number are ever included. */
export async function segmentRecipients(segment: Segment): Promise<Recipient[]> {
  const { data, error } = await admin()
    .from('customers')
    .select('id, full_name, phone, reservations(status, picked_up_at)')
    .eq('marketing_opt_in', true)
    .eq('sms_opt_in', true)
    .not('phone', 'is', null);
  if (error) throw error;

  const now = new Date();
  return (data ?? [])
    .filter((c) => {
      const rs = (c.reservations ?? []) as { status: string; picked_up_at: string | null }[];
      const active = rs.some((r) => ['booked', 'checked_in', 'in_service', 'ready'].includes(r.status));
      const done = rs.filter((r) => r.status === 'picked_up' && r.picked_up_at).map((r) => new Date(r.picked_up_at!));
      const last = done.length ? new Date(Math.max(...done.map((d) => d.getTime()))) : null;
      switch (segment) {
        case 'all_opted_in':
          return true;
        case 'lapsed_90':
          return !active && !!last && last < subDays(now, 90);
        case 'lapsed_180':
          return !active && !!last && last < subDays(now, 180);
        case 'one_and_done':
          return !active && done.length === 1;
      }
    })
    .map((c) => ({ id: c.id, full_name: c.full_name, phone: c.phone as string }));
}
