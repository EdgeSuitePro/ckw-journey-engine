import type { Metadata } from 'next';
import { Mark } from '@/components/Brand';
import { requireStaff } from '@/lib/supabase/server';
import { StaffNav } from './StaffNav';

export const metadata: Metadata = { title: 'Staff', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 bg-carbon text-cream">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <Mark size={30} inverted />
          <StaffNav />
          <span className="ml-auto hidden text-xs text-cream/60 sm:block">{staff.displayName}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
