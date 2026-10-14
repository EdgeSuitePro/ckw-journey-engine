import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dispatchDue } from '@/engine/engine';
import { firstName, links } from '@/engine/templates';
import { admin } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/supabase/server';
import { fmtDay, respectQuietHours } from '@/lib/time';
import { SEGMENTS, segmentRecipients, type Segment } from './segments';

export const dynamic = 'force-dynamic';

const STARTERS = [
  { name: 'Holiday cooking', body: 'Hi {first}! Holiday cooking season is here — get your knives sharp before the big meals. Book a drop-off in a minute: {link}' },
  { name: 'Grilling season', body: 'Hi {first}, grilling season is coming. Bring your knives in for a fresh edge before the first cookout: {link}' },
];

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ queued?: string }> }) {
  await requireStaff();
  const { queued } = await searchParams;
  const counts = Object.fromEntries(
    await Promise.all((Object.keys(SEGMENTS) as Segment[]).map(async (s) => [s, (await segmentRecipients(s)).length] as const)),
  ) as Record<Segment, number>;
  const { data: past } = await admin().from('campaigns').select('*').order('created_at', { ascending: false }).limit(20);

  async function send(form: FormData) {
    'use server';
    const staff = await requireStaff();
    const segment = String(form.get('segment')) as Segment;
    const name = String(form.get('name') ?? '').trim().slice(0, 80) || 'Campaign';
    const body = String(form.get('body') ?? '').trim();
    if (!(segment in SEGMENTS) || body.length < 10) return;

    const db = admin();
    const { data: campaign, error } = await db
      .from('campaigns')
      .insert({ name, segment, body, created_by: staff.id })
      .select('id')
      .single();
    if (error || !campaign) throw new Error(error?.message ?? 'Could not create campaign');

    const recipients = await segmentRecipients(segment);
    const sendAt = respectQuietHours(new Date()).toISOString();
    const rows = recipients.map((r) => ({
      customer_id: r.id,
      campaign_id: campaign.id,
      template: 'campaign',
      stage: 'return_refer',
      channel: 'sms',
      recipient: r.phone,
      body: `${body.replaceAll('{first}', firstName(r)).replaceAll('{link}', links.reserve())} Reply STOP to opt out.`,
      send_after: sendAt,
      guard: 'marketing_ok',
      quiet_hours: true,
      dedupe_key: `campaign:${campaign.id}:${r.id}`,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await db.from('messages').upsert(rows.slice(i, i + 500), { onConflict: 'dedupe_key', ignoreDuplicates: true });
    }
    await db.from('campaigns').update({ queued_count: rows.length }).eq('id', campaign.id);
    await dispatchDue(25).catch(() => undefined);
    revalidatePath('/staff/campaigns');
    redirect(`/staff/campaigns?queued=${rows.length}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Seasonal campaigns</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Texts go only to customers who opted in to reminders. Sends are spread out by the dispatcher and held for quiet hours (8pm–9am).
      </p>

      {queued && (
        <p className="mt-4 rounded-lg bg-sage/20 px-4 py-3 text-sm">
          <strong>{queued}</strong> messages queued. Track them on the Journey page.
        </p>
      )}

      <form action={send} className="card mt-6 space-y-4 p-5">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Campaign name</span>
          <input name="name" className="field" placeholder="Holiday 2026" required />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Who gets it</legend>
          <div className="space-y-2">
            {(Object.entries(SEGMENTS) as [Segment, string][]).map(([key, label], i) => (
              <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm">
                <span className="flex items-center gap-2.5">
                  <input type="radio" name="segment" value={key} defaultChecked={i === 1} className="accent-aogami" />
                  {label}
                </span>
                <span className="font-semibold tabular-nums">{counts[key]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Message</span>
          <textarea name="body" className="field min-h-[110px]" defaultValue={STARTERS[0]!.body} maxLength={400} required />
          <span className="mt-1 block text-xs text-ink-soft">
            {'{first}'} = first name, {'{link}'} = booking link. “Reply STOP to opt out.” is added automatically.
          </span>
        </label>
        <button className="btn btn-primary w-full">Queue campaign</button>
      </form>

      {past && past.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold">History</h2>
          <ul className="card mt-2 divide-y divide-line text-sm">
            {past.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-3">
                <span>{p.name}</span>
                <span className="text-ink-soft">
                  {p.queued_count} · {fmtDay(p.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
