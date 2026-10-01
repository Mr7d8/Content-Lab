'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/library', label: 'Library' },
  { href: '/collect', label: 'Collect' },
];

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <header className="app-nav sticky top-0 z-40 px-4 pt-4">
      <nav className="glass mx-auto flex max-w-6xl items-center gap-2 rounded-full py-2 pl-5 pr-2">
        <Link href="/library" className="mr-3 text-sm font-semibold tracking-tight">
          Content Lab
        </Link>
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className={`chip ${pathname.startsWith(link.href) ? 'active' : ''}`}>
            {link.label}
          </Link>
        ))}
        <span className="ml-auto hidden truncate text-xs text-faint sm:inline">{email}</span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn-secondary !px-3 !py-1.5 text-xs">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
