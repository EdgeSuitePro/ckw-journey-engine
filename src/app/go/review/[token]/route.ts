import { NextResponse } from 'next/server';
import { recordEvent } from '@/engine/engine';
import { GOOGLE_REVIEW_URL } from '@/lib/config';
import { admin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Tracked review link: logs the click (so Delight is measurable), then hands off to Google. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: r } = await admin().from('reservations').select('id, customer_id').eq('access_token', token).maybeSingle();
  if (r) {
    try {
      await admin().from('customers').update({ review_clicked_at: new Date().toISOString() }).eq('id', r.customer_id).is('review_clicked_at', null);
      await recordEvent({
        type: 'review.clicked',
        customerId: r.customer_id,
        reservationId: r.id,
        actor: 'customer',
        idempotencyKey: `reservation:${r.id}:review.clicked`,
      });
    } catch (err) {
      console.error('[review click]', err);
    }
  }
  return NextResponse.redirect(GOOGLE_REVIEW_URL, 302);
}
