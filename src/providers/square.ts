import { createHmac, timingSafeEqual } from 'node:crypto';

function baseUrl() {
  return process.env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

export function squareConfigured() {
  return !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

/**
 * Create a Square-hosted payment link for a reservation. The returned order_id
 * is how the webhook later ties the payment back to the reservation.
 */
export async function createPaymentLink(input: {
  reservationId: string;
  code: string;
  amountCents: number;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  redirectUrl: string;
}): Promise<{ id: string; url: string; orderId: string }> {
  if (!squareConfigured()) throw new Error('Square is not configured');
  const res = await fetch(`${baseUrl()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': process.env.SQUARE_API_VERSION ?? '2025-01-23',
    },
    body: JSON.stringify({
      idempotency_key: `${input.reservationId}:${input.amountCents}`,
      quick_pay: {
        name: `Knife sharpening · ${input.code}`,
        price_money: { amount: input.amountCents, currency: 'USD' },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      payment_note: input.code,
      checkout_options: { redirect_url: input.redirectUrl, allow_tipping: true },
      pre_populated_data: {
        ...(input.buyerEmail ? { buyer_email: input.buyerEmail } : {}),
        ...(input.buyerPhone ? { buyer_phone_number: input.buyerPhone } : {}),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    payment_link?: { id: string; url: string; order_id: string };
    errors?: { detail?: string; code?: string }[];
  };
  if (!res.ok || !json.payment_link) {
    throw new Error(json.errors?.[0]?.detail ?? `Square HTTP ${res.status}`);
  }
  return { id: json.payment_link.id, url: json.payment_link.url, orderId: json.payment_link.order_id };
}

/**
 * Square signs webhooks with HMAC-SHA256 over (notification URL + raw body),
 * base64-encoded, in the x-square-hmacsha256-signature header.
 */
export function verifySquareSignature(rawBody: string, signature: string | null, notificationUrl: string, key: string): boolean {
  if (!signature || !key) return false;
  const expected = createHmac('sha256', key).update(notificationUrl + rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SquarePaymentEvent {
  eventId: string;
  paymentId: string;
  orderId: string | null;
  status: string;
  amountCents: number;
  tipCents: number;
}

export function parsePaymentEvent(body: unknown): SquarePaymentEvent | null {
  const b = body as {
    event_id?: string;
    type?: string;
    data?: { object?: { payment?: {
      id: string; order_id?: string; status: string;
      total_money?: { amount: number }; amount_money?: { amount: number }; tip_money?: { amount: number };
    } } };
  };
  const p = b?.data?.object?.payment;
  if (!b?.event_id || !p || !b.type?.startsWith('payment.')) return null;
  return {
    eventId: b.event_id,
    paymentId: p.id,
    orderId: p.order_id ?? null,
    status: p.status,
    amountCents: p.total_money?.amount ?? p.amount_money?.amount ?? 0,
    tipCents: p.tip_money?.amount ?? 0,
  };
}
