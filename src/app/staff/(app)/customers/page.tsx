import Link from 'next/link';
import type { Customer } from '@/engine/types';
import { formatPhone } from '@/lib/phone';
import { admin } from '@/lib/supabase/admin';
import { fmtDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const term = q.trim().slice(0, 60);
  let query = admin().from('customers').select('*').order('created_at', { ascending: false }).limit(100);
  if (term) {
    const digits = term.replace(/\D/g, '');
    const safe = term.replace(/[%,()]/g, '');
    query = query.or(
      [`full_name.ilike.%${safe}%`, `email.ilike.%${safe}%`, ...(digits.length >= 3 ? [`phone.ilike.%${digits}%`] : [])].join(','),
    );
  }
  const { data } = await query;
  const customers = (data ?? []) as Customer[];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <form className="w-full sm:w-80">
          <label className="sr-only" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" defaultValue={term} placeholder="Name, phone or email" className="field" />
        </form>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-wider text-ink-soft">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Phone</th>
              <th className="hidden px-4 py-2.5 font-semibold md:table-cell">Reminders</th>
              <th className="px-4 py-2.5 text-right font-semibold">Since</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-cream">
                <td className="px-4 py-3">
                  <Link href={`/staff/customers/${c.id}`} className="font-medium hover:underline">
                    {c.full_name}
                  </Link>
                </td>
                <td className="hidden px-4 py-3 text-ink-soft sm:table-cell">{formatPhone(c.phone)}</td>
                <td className="hidden px-4 py-3 md:table-cell">{c.marketing_opt_in ? 'Yes' : <span className="text-ink-soft">No</span>}</td>
                <td className="px-4 py-3 text-right text-ink-soft">{fmtDay(c.created_at)}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-soft">
                  {term ? 'No matches.' : 'No customers yet — they appear here after their first booking.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
