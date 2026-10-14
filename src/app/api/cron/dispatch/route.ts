import { NextResponse } from 'next/server';
import { dispatchDue } from '@/engine/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Runs every 5 minutes (vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const totals = { claimed: 0, sent: 0, skipped: 0, deferred: 0, failed: 0 };
  // Drain in batches, bounded so one run can't exceed the function timeout.
  for (let i = 0; i < 8; i++) {
    const s = await dispatchDue(25);
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += s[k];
    if (s.claimed < 25) break;
  }
  return NextResponse.json(totals);
}
