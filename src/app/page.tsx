import Link from 'next/link';
import { SiteHeader } from '@/components/Brand';

const steps = [
  { n: '01', title: 'Pick a 2-hour window', body: 'Choose a drop-off window that fits your day. Takes about a minute — no account needed.' },
  { n: '02', title: 'Drop off your knives', body: 'Wrap them in a towel or sleeve. We text you the moment they’re checked in.' },
  { n: '03', title: 'We sharpen', body: 'Each blade goes to the right station — whetstones for Japanese steel, precision belts for German.' },
  { n: '04', title: 'Pay ahead, grab & go', body: 'You get a text when they’re ready, with a secure link to pay before you arrive.' },
  { n: '05', title: 'Stay sharp', body: 'Care tips after pickup, and a friendly reminder when it’s time for a touch-up.' },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4">
        <section className="py-14 sm:py-20">
          <p className="eyebrow">Maple Grove · Twin Cities</p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Sharp knives,
            <br />
            <span className="text-aogami">without the hassle.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
            Professional sharpening for home cooks and pros. Book a drop-off window, and we handle every step from there.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/reserve" className="btn btn-primary">
              Book a drop-off
            </Link>
          </div>
        </section>

        <section className="border-t border-line py-12" aria-labelledby="how">
          <h2 id="how" className="eyebrow">
            How it works
          </h2>
          <ol className="mt-6 space-y-6">
            {steps.map((s) => (
              <li key={s.n} className="flex gap-5">
                <span className="w-8 shrink-0 pt-0.5 text-sm font-bold text-bronze">{s.n}</span>
                <div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1 leading-relaxed text-ink-soft">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="mt-10 border-t border-line">
        <div className="mx-auto flex max-w-3xl justify-between px-4 py-6 text-xs text-ink-soft">
          <span>© {new Date().getFullYear()} Chef KnifeWorks LLC</span>
          <Link href="/staff" className="hover:text-carbon">
            Staff
          </Link>
        </div>
      </footer>
    </>
  );
}
