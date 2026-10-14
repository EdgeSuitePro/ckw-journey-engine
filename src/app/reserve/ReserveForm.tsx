'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ITEM_TYPES, type ItemKey } from '@/lib/items';
import { fmtDay, fmtWindow, shopDate } from '@/lib/time';

interface Slot {
  start: string;
  end: string;
  capacity: number;
  remaining: number;
}

export function ReserveForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [day, setDay] = useState<string>('');
  const [windowStart, setWindowStart] = useState('');
  const [items, setItems] = useState<Record<ItemKey, number>>({
    kitchen_knives: 0,
    japanese_knives: 0,
    serrated: 0,
    scissors: 0,
    other: 0,
  });
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  const referralCode = params.get('ref') ?? params.get('rebook') ?? '';
  const isRebook = params.has('rebook');

  useEffect(() => {
    fetch('/api/availability', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { slots: Slot[] }) => {
        setSlots(d.slots);
        const first = d.slots.find((s) => s.remaining > 0);
        if (first) setDay(shopDate(new Date(first.start)));
      })
      .catch(() => setLoadError('We couldn’t load open windows. Please refresh, or text us to book.'));
  }, []);

  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const d = shopDate(new Date(s.start));
      map.set(d, [...(map.get(d) ?? []), s]);
    }
    return [...map.entries()];
  }, [slots]);

  const daySlots = days.find(([d]) => d === day)?.[1] ?? [];
  const totalItems = Object.values(items).reduce((a, b) => a + b, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!windowStart) return setError({ message: 'Please choose a drop-off window.', field: 'windowStart' });
    setSubmitting(true);
    const utm: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k.startsWith('utm_')) utm[k] = v.slice(0, 200);
    });
    try {
      const res = await fetch('/api/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          phone,
          email,
          notes,
          windowStart,
          items,
          marketingOptIn,
          referralCode: isRebook ? '' : referralCode,
          source: isRebook ? 'reminder' : (params.get('utm_source') ?? (referralCode ? 'referral' : '')),
          utm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? 'Something went wrong.', field: data.field });
        setSubmitting(false);
        return;
      }
      router.push(`${data.orderUrl}?new=1`);
    } catch {
      setError({ message: 'Network hiccup — please try again.' });
      setSubmitting(false);
    }
  }

  const fieldError = (f: string) =>
    error?.field === f ? <p className="mt-1.5 text-sm text-danger">{error.message}</p> : null;

  return (
    <form onSubmit={submit} className="mt-8 space-y-10" noValidate>
      {referralCode && !isRebook && (
        <div className="rounded-lg border border-bronze/40 bg-bronze/10 px-4 py-3 text-sm">
          Referral code <strong>{referralCode}</strong> applied — your friend’s discount will be taken off at pickup.
        </div>
      )}

      {/* 1. Window */}
      <section aria-labelledby="w">
        <h2 id="w" className="text-lg font-semibold">
          1. Drop-off window
        </h2>
        {loadError && <p className="mt-3 text-danger">{loadError}</p>}
        {!slots && !loadError && <p className="mt-3 text-ink-soft">Loading open windows…</p>}
        {slots && days.length === 0 && (
          <p className="mt-3 text-ink-soft">No open windows in the next few weeks. Please text us and we’ll fit you in.</p>
        )}
        {days.length > 0 && (
          <>
            <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Day">
              {days.map(([d, list]) => {
                const open = list.some((s) => s.remaining > 0);
                const active = d === day;
                return (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={!open}
                    onClick={() => {
                      setDay(d);
                      setWindowStart('');
                    }}
                    className={`min-w-[84px] shrink-0 rounded-lg border px-3 py-2.5 text-center text-sm transition ${
                      active ? 'border-carbon bg-carbon text-cream' : 'border-line bg-white hover:border-carbon'
                    } disabled:opacity-40`}
                  >
                    <span className="block font-semibold">{fmtDay(list[0]!.start).split(',')[0]}</span>
                    <span className="block text-xs opacity-80">{fmtDay(list[0]!.start).split(', ')[1]}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {daySlots.map((s) => {
                const active = s.start === windowStart;
                const full = s.remaining <= 0;
                return (
                  <button
                    key={s.start}
                    type="button"
                    disabled={full}
                    onClick={() => setWindowStart(s.start)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-3 text-left transition ${
                      active ? 'border-aogami bg-aogami text-cream' : 'border-line bg-white hover:border-carbon'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="block font-semibold">{fmtWindow(s.start, s.end)}</span>
                    <span className="block text-xs opacity-80">
                      {full ? 'Full' : s.remaining === 1 ? '1 spot left' : `${s.remaining} spots`}
                    </span>
                  </button>
                );
              })}
            </div>
            {fieldError('windowStart')}
          </>
        )}
      </section>

      {/* 2. Items */}
      <section aria-labelledby="i">
        <h2 id="i" className="text-lg font-semibold">
          2. What are you bringing?
        </h2>
        <p className="mt-1 text-sm text-ink-soft">A rough count is fine — we confirm at check-in.</p>
        <ul className="card mt-4 divide-y divide-line">
          {(Object.keys(ITEM_TYPES) as ItemKey[]).map((k) => (
            <li key={k} className="flex items-center justify-between px-4 py-2.5">
              <span>{ITEM_TYPES[k]}</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost !min-h-[38px] !w-[38px] !p-0"
                  aria-label={`Fewer ${ITEM_TYPES[k]}`}
                  onClick={() => setItems((p) => ({ ...p, [k]: Math.max(0, p[k] - 1) }))}
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold" aria-live="polite">
                  {items[k]}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost !min-h-[38px] !w-[38px] !p-0"
                  aria-label={`More ${ITEM_TYPES[k]}`}
                  onClick={() => setItems((p) => ({ ...p, [k]: Math.min(99, p[k] + 1) }))}
                >
                  +
                </button>
              </span>
            </li>
          ))}
        </ul>
        {totalItems > 0 && <p className="mt-2 text-sm text-ink-soft">{totalItems} items total</p>}
      </section>

      {/* 3. Contact */}
      <section aria-labelledby="c" className="space-y-4">
        <h2 id="c" className="text-lg font-semibold">
          3. Your details
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Name</span>
          <input className="field" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          {fieldError('fullName')}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Mobile</span>
          <input
            className="field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(612) 555-0100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <span className="mt-1 block text-xs text-ink-soft">We text your confirmation and when your knives are ready.</span>
          {fieldError('phone')}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Email <span className="font-normal text-ink-soft">(optional)</span>
          </span>
          <input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {fieldError('email')}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Notes <span className="font-normal text-ink-soft">(optional)</span>
          </span>
          <textarea
            className="field min-h-[80px]"
            placeholder="Chips, broken tips, a favorite knife we should know about…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-line bg-white p-3.5">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-aogami"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
          />
          <span className="text-sm leading-relaxed">
            Text me a reminder when it’s time for my next sharpening, plus the occasional seasonal offer.
            <span className="block text-xs text-ink-soft">A few messages a year. Reply STOP anytime.</span>
          </span>
        </label>
      </section>

      {error && !error.field && <p className="text-danger">{error.message}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur">
        <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
          {submitting
            ? 'Booking…'
            : windowStart
              ? `Book ${fmtDay(windowStart)} · ${fmtWindow(windowStart, daySlots.find((s) => s.start === windowStart)?.end ?? windowStart)}`
              : 'Book my drop-off'}
        </button>
      </div>
    </form>
  );
}
