import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/Brand';
import { ReserveForm } from './ReserveForm';

export const metadata: Metadata = { title: 'Book a drop-off' };

export default function ReservePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8">
        <p className="eyebrow">Reserve</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Book a drop-off window</h1>
        <p className="mt-2 text-ink-soft">Pick a 2-hour window, tell us what you’re bringing, and you’re set.</p>
        <Suspense>
          <ReserveForm />
        </Suspense>
      </main>
    </>
  );
}
