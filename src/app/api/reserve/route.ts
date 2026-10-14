import { NextResponse } from 'next/server';
import { BookingError, createReservation } from '@/engine/booking';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    const r = await createReservation(body);
    return NextResponse.json({ code: r.code, orderUrl: `/o/${r.access_token}` }, { status: 201 });
  } catch (err) {
    if (err instanceof BookingError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 422 });
    }
    console.error('[reserve]', err);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again or text us.' }, { status: 500 });
  }
}
