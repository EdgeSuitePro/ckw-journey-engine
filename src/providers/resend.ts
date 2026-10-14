import 'server-only';
import type { SendResult } from './quo';

/** Send an email through Resend. */
export async function sendEmail(to: string, subject: string, html: string, idempotencyKey?: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, notConfigured: true, error: 'Resend not configured' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `Resend HTTP ${res.status}` };
    return { ok: true, providerId: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Resend network error' };
  }
}
