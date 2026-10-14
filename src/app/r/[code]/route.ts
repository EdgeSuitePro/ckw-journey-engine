import { NextResponse } from 'next/server';

/** Referral link: /r/DANA-7K2Q → booking page with the code applied. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
  const url = new URL(`/reserve?ref=${encodeURIComponent(clean)}&utm_source=referral`, req.url);
  return NextResponse.redirect(url, 302);
}
