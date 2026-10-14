import { NextResponse } from 'next/server';
import { markPaid } from '@/engine/operations';
import { admin } from '@/lib/supabase/admin';
import { parsePaymentEvent, verifySquareSignature } from '@/providers/square';

export const dynamic = 'force-dynamic';

/**
 * Square → "payment.updated". A COMPLETED payment for an order we created a
 * payment link for becomes a verified `payment.received` event.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? '';
  const url = process.env.SQUARE_WEBHOOK_URL ?? '';
  if (!verifySquareSignature(raw, req.headers.get('x-square-hmacsha256-signature'), url, key)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  const event = parsePaymentEvent(JSON.parse(raw));
  if (!event || event.status !== 'COMPLETED' || !event.orderId) return NextResponse.json({ ignored: true });

  const { data: r } = await admin().from('reservations').select('id').eq('square_order_id', event.orderId).maybeSingle();
  if (!r) return NextResponse.json({ ignored: true, reason: 'order not ours' });

  await markPaid(r.id, 'square', {
    method: 'square',
    amountCents: event.amountCents,
    tipCents: event.tipCents,
    squarePaymentId: event.paymentId,
  });
  return NextResponse.json({ ok: true });
}
