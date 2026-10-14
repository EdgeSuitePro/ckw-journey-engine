import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { STATUS_LABEL } from '@/engine/stateMachine';
import { links } from '@/engine/templates';
import type { Customer, Reservation } from '@/engine/types';
import { formatPhone } from '@/lib/phone';
import { admin } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/supabase/server';
import { fmtDay, fmtSlot } from '@/lib/time';
import { formatInTimeZone } from 'date-fns-tz';
import { BUSINESS } from '@/lib/config';

export const dynamic = 'force-dynamic';

const STAGE_COLOR: Record<string, string> = {
  discover: 'bg-sage',
  reserve: 'bg-aogami',
  experience: 'bg-carbon',
  delight: 'bg-bronze',
  return_refer: 'bg-bronze-deep',
};

const EVENT_LABEL: Record<string, string> = {
  'customer.created': 'First booked',
  'reservation.booked': 'Booked a drop-off',
  'reservation.cancelled': 'Cancelled',
  'reservation.no_show': 'No-show',
  'reservation.checked_in': 'Checked in',
  'reservation.in_service': 'On the bench',
  'reservation.ready': 'Marked ready',
  'payment.received': 'Paid',
  'reservation.picked_up': 'Picked up',
  'review.clicked': 'Opened review link',
  'referral.qualified': 'Referral qualified',
};

const when = (iso: string) => formatInTimeZone(new Date(iso), BUSINESS.timezone, 'MMM d, h:mmaaa');

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = admin();
  const { data: c } = await db.from('customers').select('*').eq('id', id).maybeSingle();
  if (!c) notFound();
  const customer = c as Customer;

  const [{ data: res }, { data: events }, { data: msgs }, { data: refs }] = await Promise.all([
    db.from('reservations').select('*').eq('customer_id', id).order('window_start', { ascending: false }),
    db.from('journey_events').select('id, type, stage, occurred_at, payload').eq('customer_id', id).order('occurred_at', { ascending: false }).limit(100),
    db.from('messages').select('id, template, channel, status, send_after, sent_at, last_error, stage').eq('customer_id', id).order('send_after', { ascending: false }).limit(100),
    db.from('referrals').select('id, status, referred:customers!referrals_referred_id_fkey(full_name)').eq('referrer_id', id),
  ]);

  async function toggle(form: FormData) {
    'use server';
    await requireStaff();
    const field = String(form.get('field'));
    if (field !== 'sms_opt_in' && field !== 'marketing_opt_in') return;
    await admin().from('customers').update({ [field]: form.get('value') === 'true' }).eq('id', id);
    revalidatePath(`/staff/customers/${id}`);
  }

  const timeline = [
    ...(events ?? []).map((e) => ({ at: e.occurred_at as string, kind: 'event' as const, stage: e.stage as string, label: EVENT_LABEL[e.type] ?? e.type, note: '' })),
    ...(msgs ?? []).map((m) => ({
      at: (m.sent_at ?? m.send_after) as string,
      kind: 'message' as const,
      stage: m.stage as string,
      label: `${m.template.replaceAll('_', ' ')} · ${m.channel}`,
      note: m.status === 'sent' ? 'sent' : m.status === 'queued' ? 'scheduled' : `${m.status}${m.last_error ? ` — ${m.last_error}` : ''}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const completed = (res ?? []).filter((r) => r.status === 'picked_up').length;

  return (
    <>
      <Link href="/staff/customers" className="text-sm text-ink-soft hover:text-carbon">
        ← Customers
      </Link>
      <div className="mt-2 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="card p-5">
            <h1 className="text-xl font-bold">{customer.full_name}</h1>
            <p className="mt-1 text-sm">
              <a href={`tel:${customer.phone}`}>{formatPhone(customer.phone)}</a>
            </p>
            {customer.email && <p className="text-sm text-ink-soft">{customer.email}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-ink-soft">Visits</dt>
                <dd className="text-lg font-semibold">{completed}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Customer since</dt>
                <dd className="font-medium">{fmtDay(customer.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Referrals</dt>
                <dd className="text-lg font-semibold">{(refs ?? []).filter((r) => r.status !== 'pending').length}<span className="text-sm font-normal text-ink-soft"> / {(refs ?? []).length}</span></dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">Review link</dt>
                <dd className="font-medium">{customer.review_clicked_at ? 'Opened' : customer.review_requested_at ? 'Asked' : '—'}</dd>
              </div>
            </dl>
          </div>
          <div className="card divide-y divide-line text-sm">
            {(
              [
                ['sms_opt_in', 'Texts', customer.sms_opt_in],
                ['marketing_opt_in', 'Reminders & offers', customer.marketing_opt_in],
              ] as const
            ).map(([field, label, value]) => (
              <form key={field} action={toggle} className="flex items-center justify-between px-4 py-3">
                <input type="hidden" name="field" value={field} />
                <input type="hidden" name="value" value={String(!value)} />
                <span>{label}</span>
                <button className={`rounded-full px-2.5 py-1 text-xs font-semibold ${value ? 'bg-sage text-white' : 'bg-paper text-ink-soft'}`}>
                  {value ? 'On' : 'Off'}
                </button>
              </form>
            ))}
            <div className="px-4 py-3">
              <p className="text-xs text-ink-soft">Referral link</p>
              <p className="mt-0.5 break-all font-mono text-xs">{links.refer(customer)}</p>
            </div>
          </div>
        </aside>

        <div className="space-y-6">
          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Orders</h2>
            <ul className="divide-y divide-line text-sm">
              {(res as Reservation[] | null)?.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    <span className="font-mono text-xs">{r.code}</span> · {fmtSlot(r.window_start, r.window_end)}
                  </span>
                  <span className="text-ink-soft">
                    {STATUS_LABEL[r.status]}
                    {r.amount_paid_cents != null && ` · $${(r.amount_paid_cents / 100).toFixed(2)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Journey</h2>
            <ol className="px-4 py-3">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-3 py-2 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.kind === 'event' ? STAGE_COLOR[t.stage] : 'border border-ink-soft bg-white'}`} />
                  <span className="w-28 shrink-0 text-xs text-ink-soft">{when(t.at)}</span>
                  <span className={t.kind === 'event' ? 'font-medium' : 'text-ink-soft'}>
                    {t.label}
                    {t.note && <span className="text-xs"> — {t.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
