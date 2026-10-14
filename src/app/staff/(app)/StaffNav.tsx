'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/staff', label: 'Board' },
  { href: '/staff/customers', label: 'Customers' },
  { href: '/staff/journey', label: 'Journey' },
  { href: '/staff/campaigns', label: 'Campaigns' },
];

export function StaffNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label="Staff">
      {NAV.map((n) => {
        const active = n.href === '/staff' ? path === '/staff' : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              active ? 'bg-cream text-carbon' : 'text-cream/70 hover:text-cream'
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
