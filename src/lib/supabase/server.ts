import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { admin } from './admin';

/** Cookie-bound client for the signed-in staff member. */
export async function sessionClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component — middleware refreshes the session instead.
        }
      },
    },
  });
}

export interface StaffUser {
  id: string;
  email: string | null;
  displayName: string;
  role: 'owner' | 'staff';
}

/** Returns the staff member or null. Checks the staff_members allow-list, not just "is logged in". */
export async function currentStaff(): Promise<StaffUser | null> {
  const supabase = await sessionClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: member } = await admin()
    .from('staff_members')
    .select('display_name, role')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (!member) return null;
  return { id: data.user.id, email: data.user.email ?? null, displayName: member.display_name, role: member.role };
}

export async function requireStaff(): Promise<StaffUser> {
  const staff = await currentStaff();
  if (!staff) redirect('/staff/login');
  return staff;
}
