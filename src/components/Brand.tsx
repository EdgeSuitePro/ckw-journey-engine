import Link from 'next/link';

/** Hexagon C|K|W mark, drawn inline so it works everywhere without assets. */
export function Mark({ size = 34, inverted = false }: { size?: number; inverted?: boolean }) {
  const fg = inverted ? '#FAF9F5' : '#111111';
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 2 36 11v18L20 38 4 29V11z" fill="none" stroke="#C6925B" strokeWidth="2" />
      <text x="20" y="24.5" textAnchor="middle" fontFamily="Montserrat, sans-serif" fontWeight="700" fontSize="9.5" fill={fg} letterSpacing="0.5">
        C|K|W
      </text>
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-sm font-bold tracking-[0.18em]">CHEF KNIFEWORKS</span>
        </Link>
        <Link href="/reserve" className="btn btn-primary !min-h-[38px] !px-3.5 text-sm">
          Book
        </Link>
      </div>
    </header>
  );
}
