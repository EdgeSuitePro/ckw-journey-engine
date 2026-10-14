import { NextResponse } from 'next/server';
import { availability } from '@/engine/booking';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const slots = await availability();
    return NextResponse.json({ slots }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[availability]', err);
    return NextResponse.json({ error: 'Availability is temporarily unavailable.' }, { status: 503 });
  }
}
