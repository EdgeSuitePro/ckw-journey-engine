import 'server-only';

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
  /** True when the provider isn't configured — message stays queued, nothing is lost. */
  notConfigured?: boolean;
}

/** Send a text through Quo (formerly OpenPhone). */
export async function sendSms(to: string, content: string): Promise<SendResult> {
  const apiKey = process.env.QUO_API_KEY;
  const from = process.env.QUO_FROM_NUMBER;
  if (!apiKey || !from) return { ok: false, notConfigured: true, error: 'Quo not configured' };

  try {
    const res = await fetch('https://api.quo.com/v1/messages', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, from, to: [to] }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; message?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `Quo HTTP ${res.status}` };
    return { ok: true, providerId: json.data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Quo network error' };
  }
}
