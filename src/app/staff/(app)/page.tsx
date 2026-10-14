import { addDays } from 'date-fns';
import type { Customer, Reservation, ReservationStatus } from '@/engine/types';
import { admin } from '@/lib/supabase/admin';
import { shopDate, shopTime } from '@/lib/time';
import { OrderCard } from './OrderCard';

export const dynamic = 'force-dynamic';

const LANES: { status: ReservationStatus; title: string; hint: string }[] = [
  { status: 'booked', title: 'Arriving', hint: 'Next 7 days' },
  { status: 'checked_in', title: 'Checked in', hint: 'Waiting for the bench' },
  { status: 'in_service', title: 'On the bench', hint: 'Being sharpened' },
  { status: 'ready', title: 'Ready', hint: 'Waiting for pickup' },
];

export default async function Board() {
  const db = admin();
  const now = new Date();
  const horizon = addDays(now, 7).toISOString();
  const todayStart = shopTime(shopDate(now), '00:00').toISOString();

  const [{ data: active }, { data: doneToday }] = await Promise.all([
    db
      .from('reservations')
      .select('*, customer:customers(*)')
      .in('status', ['booked', 'checked_in', 'in_service', 'ready'])
      .lt('window_start', horizon)
      .order('window_start'),
    db
      .from('reservations')
      .select('id', { count: 'exact' })
      .eq('status', 'picked_up')
      .gte('picked_up_at', todayStart),
  ]);

  const rows = (active ?? []) as (Reservation & { customer: Customer })[];
  const today = shopDate(now);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Board</h1>
        <p className="text-sm text-ink-soft">
          {rows.filter((r) => r.status === 'booked' && shopDate(new Date(r.window_start)) === today).length} arriving
          today · {doneToday?.length ?? 0} picked up today
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const items = rows.filter((r) => r.status === lane.status);
          return (
            <section key={lane.status} aria-labelledby={`lane-${lane.status}`} className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 id={`lane-${lane.status}`} className="font-semibold">
                  {lane.title} <span className="text-ink-soft">({items.length})</span>
                </h2>
                <span className="text-xs text-ink-soft">{lane.hint}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-ink-soft">
                    Nothing here
                  </p>
                )}
                {items.map((r) => (
                  <OrderCard key={r.id} reservation={r} customer={r.customer} isToday={shopDate(new Date(r.window_start)) === today} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
