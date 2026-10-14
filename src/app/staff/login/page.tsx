'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Mark } from '@/components/Brand';

export default function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('That email and password didn’t match.');
      setBusy(false);
      return;
    }
    router.replace('/staff');
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-carbon px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-cream p-7">
        <div className="mb-6 flex items-center gap-2.5">
          <Mark />
          <span className="text-sm font-bold tracking-[0.18em]">CKW STAFF</span>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium">Password</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button className="btn btn-primary mt-6 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
