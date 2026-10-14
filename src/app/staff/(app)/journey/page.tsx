import Link from 'next/link';
import { subDays } from 'date-fns';
import { admin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type Metrics = {
  discover: { new_customers: number; by_source: Record<string, number> };
  reserve: { booked: number; cancelled: number; no_show: number; confirmations_sent: number };
  experience: { checked_in: number; ready: number; paid: number; picked_up: number; revenue_cents: number; avg_turnaround_hours: number | null };
  delight: { thank_yous_sent: number; review_requests_sent: number; review_link_clicks: number };
  return_refer: {
    reminders_sent: number;
    repeat_bookings: number;
    referral_invites_sent: number;
    referred_bookings: number;
    referrals_qualified: number;
    repeat_customer_rate: number;
  };
  messages: { sent: number; failed: number; suppressed: number; queued: number };
};

const PERIODS = [30, 90, 365];
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—');
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-ink-soft">{label}</dt>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-ink-soft">{sub}</dd>}
    </div>
  );
}

function Stage({ name, line, highlight, children }: { name: string; line: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border p-5 ${highlight ? 'border-bronze/60 bg-bronze/10' : 'border-line bg-white'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-[0.16em]">{name}</h2>
        <p className="text-xs text-ink-soft">{line}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</dl>
    </section>
  );
}

const Arrow = () => (
  <div className="flex justify-center py-1 text-ink-soft" aria-hidden="true">
    ↓
  </div>
);

export default async function Journey({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = PERIODS.includes(Number(raw)) ? Number(raw) : 30;
  const { data, error } = await admin().rpc('journey_metrics', { p_since: subDays(new Date(), days).toISOString() });
  if (error || !data) return <p className="text-danger">Couldn’t load metrics: {error?.message}</p>;
  const m = data as Metrics;
  const sources = Object.entries(m.discover.by_source).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer journey</h1>
          <p className="text-sm text-ink-soft">Every number comes from a verified customer event.</p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-white p-1 text-sm" aria-label="Period">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/staff/journey?days=${p}`}
              aria-current={p === days ? 'page' : undefined}
              className={`rounded-md px-3 py-1 ${p === days ? 'bg-carbon text-cream' : 'text-ink-soft hover:text-carbon'}`}
            >
              {p === 365 ? '1 yr' : `${p} d`}
            </Link>
          ))}
        </nav>
      </div>

      <Stage name="DISCOVER" line="Where new customers came from">
        <Stat label="New customers" value={m.discover.new_customers} />
        {sources.slice(0, 3).map(([s, n]) => (
          <Stat key={s} label={s} value={n} sub={pct(n, m.discover.new_customers)} />
        ))}
      </Stage>
      <Arrow />
      <Stage name="RESERVE" line="2-hour drop-off windows · confirmations">
        <Stat label="Bookings" value={m.reserve.booked} />
        <Stat label="Confirmations sent" value={m.reserve.confirmations_sent} />
        <Stat label="Cancelled" value={m.reserve.cancelled} sub={pct(m.reserve.cancelled, m.reserve.booked)} />
        <Stat label="No-shows" value={m.reserve.no_show} sub={pct(m.reserve.no_show, m.reserve.booked)} />
      </Stage>
      <Arrow />
      <Stage name="EXPERIENCE" line="Check-in · sharpening · payment · pickup">
        <Stat label="Checked in" value={m.experience.checked_in} />
        <Stat label="Picked up" value={m.experience.picked_up} />
        <Stat label="Revenue" value={usd(m.experience.revenue_cents)} />
        <Stat label="Avg turnaround" value={m.experience.avg_turnaround_hours != null ? `${m.experience.avg_turnaround_hours} h` : '—'} sub="check-in → ready" />
      </Stage>
      <Arrow />
      <Stage name="DELIGHT" line="Aftercare · thank-you · review">
        <Stat label="Thank-yous sent" value={m.delight.thank_yous_sent} />
        <Stat label="Review requests" value={m.delight.review_requests_sent} />
        <Stat label="Review link opened" value={m.delight.review_link_clicks} sub={pct(m.delight.review_link_clicks, m.delight.review_requests_sent)} />
      </Stage>
      <Arrow />
      <Stage name="RETURN & REFER" line="Reminders · referrals · repeat reservations" highlight>
        <Stat label="Repeat bookings" value={m.return_refer.repeat_bookings} />
        <Stat label="Repeat customer rate" value={`${m.return_refer.repeat_customer_rate}%`} sub="all time" />
        <Stat label="Referred bookings" value={m.return_refer.referred_bookings} />
        <Stat label="Reminders sent" value={m.return_refer.reminders_sent} />
      </Stage>

      <section className="mt-8 rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold tracking-[0.16em]">MESSAGE HEALTH</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Sent" value={m.messages.sent} />
          <Stat label="Scheduled" value={m.messages.queued} sub="right now" />
          <Stat label="Suppressed" value={m.messages.suppressed} sub="no longer relevant" />
          <Stat label="Failed" value={m.messages.failed} />
        </dl>
      </section>
    </div>
  );
}
